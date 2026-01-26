from django.urls import path

from .views import RecruiterAssistantQuestionView, text_to_speech

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
]


