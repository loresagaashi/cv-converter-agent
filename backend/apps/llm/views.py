import logging
from typing import Any, Dict, List

import json

from django.http import HttpResponse, StreamingHttpResponse
from django.shortcuts import get_object_or_404
from rest_framework.decorators import api_view, permission_classes
from rest_framework import serializers
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from drf_spectacular.utils import OpenApiResponse, extend_schema, extend_schema_view

from apps.interview.models import ConversationSession
from apps.llm.services import (
    generate_ai_voice,
    generate_recruiter_next_question,
    stream_voice_to_question,
    transcribe_audio_whisper,
)

logger = logging.getLogger(__name__)


class VoiceToQuestionRequestSerializer(serializers.Serializer):
    audio = serializers.FileField()
    session_id = serializers.IntegerField()
    history = serializers.CharField(required=False, default="[]")
    section = serializers.CharField(required=False, default="core_skills")


class VoiceToQuestionResponseSerializer(serializers.Serializer):
    transcription = serializers.CharField(allow_blank=True)
    question_data = serializers.JSONField(allow_null=True)


class RecruiterAssistantQuestionRequestSerializer(serializers.Serializer):
    session_id = serializers.IntegerField()
    history = serializers.JSONField(required=False)
    section = serializers.CharField(required=False, default="core_skills")


class TextToSpeechRequestSerializer(serializers.Serializer):
    text = serializers.CharField()


class TranscribeAudioRequestSerializer(serializers.Serializer):
    audio = serializers.FileField()


class TranscribeAudioResponseSerializer(serializers.Serializer):
    text = serializers.CharField()
    language = serializers.CharField()


class SchemaFallbackSerializer(serializers.Serializer):
    pass


class DocumentedAPIView(APIView):
    serializer_class = SchemaFallbackSerializer


@extend_schema_view(
    post=extend_schema(
        summary="Recruiter assistant next question",
        tags=["LLM"],
        request=RecruiterAssistantQuestionRequestSerializer,
        responses={
            200: OpenApiResponse(description="Next question generated."),
            400: OpenApiResponse(description="Validation error."),
            403: OpenApiResponse(description="Permission denied."),
            409: OpenApiResponse(description="Conversation not active."),
            500: OpenApiResponse(description="Generation failed."),
        },
    )
)
class RecruiterAssistantQuestionView(DocumentedAPIView):
    """
    Generate the next spoken verification question for the recruiter assistant.

    This view:
    - Loads stored session text and competence paper content for the given session.
    - Uses gpt-4o-mini (via generate_recruiter_next_question) to decide
      the next question in a structured verification flow.
    - Enforces that questions are strictly based on stored session content.

    The frontend (voice agent) handles speech-to-text / text-to-speech and
    passes the conversation history as plain text.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request, *args, **kwargs):
        data: Dict[str, Any] = request.data or {}

        session_id = data.get("session_id")
        history: List[Dict[str, str]] = data.get("history") or []
        section = data.get("section") or "core_skills"

        logger.info(
            f"[RecruiterAssistantQuestionView] 📥 Request: session_id={session_id}, section={section}, "
            f"history_length={len(history)}"
        )

        if not isinstance(session_id, int):
            logger.warning(
                f"[RecruiterAssistantQuestionView] ❌ Invalid request: session_id={session_id}"
            )
            return Response(
                {"detail": "session_id (int) is required."},
                status=400,
            )

        session = get_object_or_404(ConversationSession, pk=session_id)
        if session.cv.user != request.user and not getattr(request.user, "is_staff", False):
            return Response(
                {"detail": "You don't have permission to access this conversation session."},
                status=403,
            )
        if session.status != "in_progress":
            return Response(
                {"detail": "Conversation session is not active."},
                status=409,
            )

        cv_text = (session.cv_extracted_text or "").strip()
        if not cv_text:
            return Response(
                {"detail": "Conversation session has no stored text. Please restart the session."},
                status=400,
            )

        competence_paper = session.original_competence_paper
        competence_text = competence_paper.content or "" if competence_paper else ""
        
        # Log last exchange for debugging
        if history:
            last_exchange = history[-1]
            logger.info(
                f"[RecruiterAssistantQuestionView] Last exchange: role={last_exchange.get('role')}, "
                f"content_preview='{last_exchange.get('content', '')[:50]}...'"
            )

        try:
            result = generate_recruiter_next_question(
                cv_text=cv_text or "",
                competence_text=competence_text,
                history=history,
                section=section,
            )
            logger.info(
                f"[RecruiterAssistantQuestionView] ✅ Generated result: section={result.get('section')}, "
                f"done={result.get('done')}, complete_section={result.get('complete_section')}, "
                f"question_length={len(result.get('question', ''))}"
            )
        except Exception as e:
            logger.error(f"[RecruiterAssistantQuestionView] ❌ Error generating question: {str(e)}", exc_info=True)
            return Response(
                {"detail": "Failed to generate next question. Please try again."},
                status=500,
            )

        return Response(result, status=200)


@extend_schema(
    summary="Text to speech",
    tags=["LLM"],
    request=TextToSpeechRequestSerializer,
    responses={
        200: OpenApiResponse(description="Audio/mpeg binary response."),
        400: OpenApiResponse(description="Missing text."),
        500: OpenApiResponse(description="TTS generation failed."),
    },
)
@api_view(['POST'])
@permission_classes([IsAuthenticated])
def text_to_speech(request):
    """
    Convert text to speech using OpenAI's emotional TTS (shimmer voice).
    
    Expects JSON payload:
    {
        "text": "The text to convert to speech"
    }
    
    Returns audio/mpeg binary content.
    """
    data: Dict[str, Any] = request.data or {}
    text = data.get("text", "").strip()
    
    if not text:
        return Response(
            {"detail": "Text is required."},
            status=400,
        )
    
    try:
        audio_content = generate_ai_voice(text)
        return HttpResponse(audio_content, content_type="audio/mpeg")
    except Exception as e:
        logger.error(f"[text_to_speech] ❌ Error generating audio: {str(e)}", exc_info=True)
        return Response(
            {"detail": f"Failed to generate audio: {str(e)}"},
            status=500,
        )


@extend_schema(
    summary="Transcribe audio",
    tags=["LLM"],
    request=TranscribeAudioRequestSerializer,
    responses={
        200: TranscribeAudioResponseSerializer,
        400: OpenApiResponse(description="Missing/invalid audio or language validation failed."),
        500: OpenApiResponse(description="Transcription failed."),
    },
)
@api_view(['POST'])
@permission_classes([IsAuthenticated])
def transcribe_audio(request):
    """
    Transcribe audio using OpenAI's Whisper API with English language validation.
    
    Expects multipart/form-data with:
    - audio: Audio file (webm format)
    
    Returns JSON:
    {
        "text": "Transcribed text",
        "language": "en"
    }
    
    Returns 400 if language is not English with error message.
    """
    if 'audio' not in request.FILES:
        return Response(
            {"detail": "Audio file is required."},
            status=400,
        )
    
    audio_file = request.FILES['audio']
    
    try:
        result = transcribe_audio_whisper(audio_file)
        logger.info(f"[transcribe_audio] ✅ Transcription successful: {result['text'][:50]}...")
        return Response(result, status=200)
    except ValueError as e:
        # Language validation error - return 400 with the error message
        error_msg = str(e)
        logger.warning(f"[transcribe_audio] ⚠️ Language validation failed: {error_msg}")
        return Response(
            {"detail": error_msg},
            status=400,
        )
    except Exception as e:
        logger.error(f"[transcribe_audio] ❌ Error transcribing audio: {str(e)}", exc_info=True)
        return Response(
            {"detail": f"Failed to transcribe audio: {str(e)}"},
            status=500,
        )


@extend_schema(
    summary="Voice to question",
    description="Transcribe uploaded audio and generate the next recruiter question.",
    tags=["LLM"],
    request=VoiceToQuestionRequestSerializer,
    responses={
        200: VoiceToQuestionResponseSerializer,
        400: OpenApiResponse(description="Validation or language error."),
        403: OpenApiResponse(description="Permission denied."),
        409: OpenApiResponse(description="Conversation session is not active."),
        500: OpenApiResponse(description="Server processing error."),
    },
)
@api_view(['POST'])
@permission_classes([IsAuthenticated])
def voice_to_question(request):
    """
    🚀 SUPER ENDPOINT: Transcribe audio AND generate next question in ONE request.
    This eliminates network round-trip latency between transcription and question generation.
    
    Expects multipart/form-data with:
    - audio: Audio file (webm format)
    - session_id: Conversation session ID (integer)
    - history: JSON string of conversation history
    - section: Current section (string)
    
    Returns JSON:
    {
        "transcription": "User's spoken text",
        "question_data": {
            "question": "AI's next question",
            "section": "current_section",
            "complete_section": false,
            "done": false
        }
    }
    """
    if 'audio' not in request.FILES:
        return Response({"detail": "Audio file is required."}, status=400)
    
    session_id = request.data.get("session_id")
    history_str = request.data.get("history", "[]")
    section = request.data.get("section", "core_skills")
    
    # Parse history
    try:
        history = json.loads(history_str) if isinstance(history_str, str) else history_str
    except:
        history = []
    
    try:
        session_id = int(session_id)
    except (ValueError, TypeError):
        return Response({"detail": "session_id must be an integer."}, status=400)
    
    # Step 1: Transcribe audio
    audio_file = request.FILES['audio']
    try:
        transcription_result = transcribe_audio_whisper(audio_file)
        transcribed_text = transcription_result.get('text', '').strip()
    except ValueError as e:
        # Language validation error
        return Response({"detail": str(e)}, status=400)
    except Exception as e:
        logger.error(f"[voice_to_question] Transcription failed: {e}")
        return Response({"detail": "Transcription failed"}, status=500)
    
    # If transcription is empty, return early
    if not transcribed_text:
        return Response({"transcription": "", "question_data": None}, status=200)
    
    # Step 2: Load stored session content and generate question
    try:
        session = get_object_or_404(ConversationSession, pk=session_id)
        if session.cv.user != request.user and not getattr(request.user, "is_staff", False):
            return Response(
                {"detail": "You don't have permission to access this conversation session."},
                status=403,
            )
        if session.status != "in_progress":
            return Response(
                {"detail": "Conversation session is not active."},
                status=409,
            )
        cv_text = (session.cv_extracted_text or "").strip()
        if not cv_text:
            return Response(
                {"detail": "Conversation session has no stored text. Please restart the session."},
                status=400,
            )
        competence_paper = session.original_competence_paper
        competence_text = competence_paper.content or "" if competence_paper else ""
        
        # Add user's answer to history
        updated_history = list(history)
        updated_history.append({"role": "recruiter", "content": transcribed_text})
        
        # Generate next question
        question_result = generate_recruiter_next_question(
            cv_text=cv_text,
            competence_text=competence_text,
            history=updated_history,
            section=section
        )
        
        return Response({
            "transcription": transcribed_text,
            "question_data": question_result
        }, status=200)
        
    except Exception as e:
        logger.error(f"[voice_to_question] Error: {e}", exc_info=True)
        return Response({"detail": str(e)}, status=500)


def _stream_voice_to_question_sse(audio_file, cv_text, competence_text, history, section):
    """
    Generator that yields SSE-formatted chunks from stream_voice_to_question.
    Yields "data: {json}\n\n" for each chunk.
    """
    for chunk in stream_voice_to_question(
        audio_file=audio_file,
        cv_text=cv_text or "",
        competence_text=competence_text or "",
        history=history,
        section=section,
    ):
        yield f"data: {json.dumps(chunk)}\n\n"


@extend_schema_view(
    post=extend_schema(
        summary="Voice to question stream",
        tags=["LLM"],
        request=VoiceToQuestionRequestSerializer,
        responses={
            200: OpenApiResponse(description="SSE stream response."),
            400: OpenApiResponse(description="Validation error."),
            403: OpenApiResponse(description="Permission denied."),
            409: OpenApiResponse(description="Conversation not active."),
        },
    )
)
class VoiceToQuestionStreamView(DocumentedAPIView):
    """
    SSE streaming: transcribe audio then generate next question.
    Yields transcription first (so UI can show it and "Thinking" immediately), then question_data.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request, *args, **kwargs):
        if "audio" not in request.FILES:
            return Response({"detail": "Audio file is required."}, status=400)

        try:
            session_id = int(request.data.get("session_id"))
        except (ValueError, TypeError):
            return Response({"detail": "session_id must be an integer."}, status=400)

        history_str = request.data.get("history", "[]")
        section = request.data.get("section", "core_skills")
        try:
            history = json.loads(history_str) if isinstance(history_str, str) else history_str
        except Exception:
            history = []

        session = get_object_or_404(ConversationSession, pk=session_id)
        if session.cv.user != request.user and not getattr(request.user, "is_staff", False):
            return Response(
                {"detail": "You don't have permission to access this conversation session."},
                status=403,
            )
        if session.status != "in_progress":
            return Response(
                {"detail": "Conversation session is not active."},
                status=409,
            )
        cv_text = (session.cv_extracted_text or "").strip()
        if not cv_text:
            return Response(
                {"detail": "Conversation session has no stored text. Please restart the session."},
                status=400,
            )
        competence_paper = session.original_competence_paper
        competence_text = competence_paper.content or "" if competence_paper else ""

        return StreamingHttpResponse(
            _stream_voice_to_question_sse(
                request.FILES["audio"],
                cv_text,
                competence_text,
                history,
                section,
            ),
            content_type="text/event-stream",
        )
