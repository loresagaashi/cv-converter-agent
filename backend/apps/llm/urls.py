from django.urls import path

from .views import (
    RecruiterAssistantQuestionView,
    VoiceToQuestionStreamView,
    text_to_speech,
    transcribe_audio,
    voice_to_question,
)

app_name = "llm"

urlpatterns = [
    path(
        "recruiter-assistant/question/",
        RecruiterAssistantQuestionView.as_view(),
        name="recruiter-assistant-question",
    ),
    path(
        "tts/",
        text_to_speech,
        name="text-to-speech",
    ),
    path(
        "transcribe-audio/",
        transcribe_audio,
        name="transcribe-audio",
    ),
    path(
        "voice-to-question/",
        voice_to_question,
        name="voice-to-question",
    ),
    path(
        "voice-to-question-stream/",
        VoiceToQuestionStreamView.as_view(),
        name="voice-to-question-stream",
    ),
]

