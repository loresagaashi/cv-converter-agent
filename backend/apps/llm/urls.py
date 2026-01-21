from django.urls import path

from .views import RecruiterAssistantQuestionView

app_name = "llm"

urlpatterns = [
    path(
        "recruiter-assistant/question/",
        RecruiterAssistantQuestionView.as_view(),
        name="recruiter-assistant-question",
    ),
]


