from django.urls import path

from .views import (
    AllCompetencePapersView,
    AllConversationCompetencePapersView,
    CompetencePaperDeleteView,
    CompetencePaperDetailView,
    CompetencePaperListView,
    ConversationCompetencePaperDeleteView,
    ConversationCompetencePaperDetailView,
    ConversationCompetencePaperPDFView,
    ConversationCompetencePaperUpdateView,
    ConversationSessionEndView,
    ConversationSessionGeneratePaperView,
    ConversationSessionStartView,
    ConversationTurnView,
)

app_name = "interview"

urlpatterns = [
    path(
        "competence-papers/<int:cv_id>/",
        CompetencePaperListView.as_view(),
        name="competence-paper-list",
    ),
    path(
        "competence-paper/<int:paper_id>/",
        CompetencePaperDetailView.as_view(),
        name="competence-paper-detail",
    ),
    path(
        "competence-paper/<int:paper_id>/delete/",
        CompetencePaperDeleteView.as_view(),
        name="competence-paper-delete",
    ),
    path(
        "competence-papers/",
        AllCompetencePapersView.as_view(),
        name="all-competence-papers",
    ),
    path(
        "conversation-competence-papers/",
        AllConversationCompetencePapersView.as_view(),
        name="all-conversation-competence-papers",
    ),
    path(
        "conversation-competence-paper/<int:paper_id>/",
        ConversationCompetencePaperDetailView.as_view(),
        name="conversation-competence-paper-detail",
    ),
    path(
        "conversation-competence-paper/<int:paper_id>/delete/",
        ConversationCompetencePaperDeleteView.as_view(),
        name="conversation-competence-paper-delete",
    ),
    path(
        "conversation-competence-paper/<int:paper_id>/edit/",
        ConversationCompetencePaperUpdateView.as_view(),
        name="conversation-competence-paper-edit",
    ),
    path(
        "conversation-competence-paper/<int:paper_id>/pdf/",
        ConversationCompetencePaperPDFView.as_view(),
        name="conversation-competence-paper-pdf",
    ),
    path(
        "conversation-session/start/",
        ConversationSessionStartView.as_view(),
        name="conversation-session-start",
    ),
    path(
        "conversation-session/turn/",
        ConversationTurnView.as_view(),
        name="conversation-session-turn",
    ),
    path(
        "conversation-session/<int:session_id>/generate-paper/",
        ConversationSessionGeneratePaperView.as_view(),
        name="conversation-session-generate-paper",
    ),
    path(
        "conversation-session/<int:session_id>/end/",
        ConversationSessionEndView.as_view(),
        name="conversation-session-end",
    ),
]


