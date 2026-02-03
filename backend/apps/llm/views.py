import logging
from typing import Any, Dict, List

from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.cv.models import CV
from apps.cv.services import read_cv_file
from apps.interview.models import CompetencePaper
from apps.llm.services import generate_recruiter_next_question, generate_ai_voice, transcribe_audio_whisper

logger = logging.getLogger(__name__)


class RecruiterAssistantQuestionView(APIView):
    """
    Generate the next spoken verification question for the recruiter assistant.

    This view:
    - Loads the CV text and competence paper content for the given IDs.
    - Uses gpt-4o-mini (via generate_recruiter_next_question) to decide
      the next question in a structured verification flow.
    - Enforces that questions are strictly based on CV/competence content.

    The frontend (voice agent) handles speech-to-text / text-to-speech and
    passes the conversation history as plain text.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request, *args, **kwargs):
        data: Dict[str, Any] = request.data or {}

        cv_id = data.get("cv_id")
        paper_id = data.get("paper_id")
        history: List[Dict[str, str]] = data.get("history") or []
        section = data.get("section") or "core_skills"

        logger.info(
            f"[RecruiterAssistantQuestionView] 📥 Request: cv_id={cv_id}, paper_id={paper_id}, "
            f"section={section}, history_length={len(history)}"
        )

        if not isinstance(cv_id, int) or not isinstance(paper_id, int):
            logger.warning(f"[RecruiterAssistantQuestionView] ❌ Invalid request: cv_id={cv_id}, paper_id={paper_id}")
            return Response(
                {"detail": "cv_id (int) and paper_id (int) are required."},
                status=400,
            )

        # Admins can access any CV; regular users only their own
        if getattr(request.user, 'is_staff', False):
            cv_instance = get_object_or_404(CV, pk=cv_id)
        else:
            cv_instance = get_object_or_404(CV, pk=cv_id, user=request.user)
        competence_paper = get_object_or_404(CompetencePaper, pk=paper_id, cv=cv_instance)

        # Extract plain text for the CV – this is the primary source of truth.
        try:
            file_obj = cv_instance.file
            content_type = getattr(getattr(file_obj, "file", None), "content_type", None)
            cv_text = read_cv_file(
                file_obj,
                name=cv_instance.original_filename,
                content_type=content_type,
            )
        except FileNotFoundError:
            logger.error(f"[RecruiterAssistantQuestionView] ❌ CV file not found: {cv_instance.original_filename}")
            return Response(
                {"detail": "CV file not found. Please re-upload your CV."},
                status=404,
            )
        except Exception as e:
            logger.error(f"[RecruiterAssistantQuestionView] ❌ Error reading CV file: {str(e)}", exc_info=True)
            return Response(
                {"detail": f"Error reading CV file: {str(e)}"},
                status=500,
            )

        competence_text = competence_paper.content or ""
        
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


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def voice_to_question(request):
    """
    🚀 SUPER ENDPOINT: Transcribe audio AND generate next question in ONE request.
    This eliminates network round-trip latency between transcription and question generation.
    
    Expects multipart/form-data with:
    - audio: Audio file (webm format)
    - cv_id: CV ID (integer)
    - paper_id: Competence Paper ID (integer)
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
    import json
    
    if 'audio' not in request.FILES:
        return Response({"detail": "Audio file is required."}, status=400)
    
    cv_id = request.data.get("cv_id")
    paper_id = request.data.get("paper_id")
    history_str = request.data.get("history", "[]")
    section = request.data.get("section", "core_skills")
    
    # Parse history
    try:
        history = json.loads(history_str) if isinstance(history_str, str) else history_str
    except:
        history = []
    
    # Validate IDs
    try:
        cv_id = int(cv_id)
        paper_id = int(paper_id)
    except (ValueError, TypeError):
        return Response({"detail": "cv_id and paper_id must be integers."}, status=400)
    
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
    
    # Step 2: Load CV/Paper and generate question
    if getattr(request.user, 'is_staff', False):
        cv_instance = get_object_or_404(CV, pk=cv_id)
    else:
        cv_instance = get_object_or_404(CV, pk=cv_id, user=request.user)
    competence_paper = get_object_or_404(CompetencePaper, pk=paper_id, cv=cv_instance)
    
    try:
        file_obj = cv_instance.file
        content_type = getattr(getattr(file_obj, "file", None), "content_type", None)
        cv_text = read_cv_file(file_obj, name=cv_instance.original_filename, content_type=content_type)
        competence_text = competence_paper.content or ""
        
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
