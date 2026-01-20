from django.urls import path
from .views import (
    CompetencePaperListView, 
    CompetencePaperDetailView, 
    AllCompetencePapersView, 
    CompetencePaperDeleteView,
    AllConversationCompetencePapersView,
    ConversationCompetencePaperDetailView,
    ConversationCompetencePaperDeleteView,
)

app_name = 'interview'

urlpatterns = [
    path('competence-papers/<int:cv_id>/', CompetencePaperListView.as_view(), name='competence-paper-list'),
    path('competence-paper/<int:paper_id>/', CompetencePaperDetailView.as_view(), name='competence-paper-detail'),
    path('competence-paper/<int:paper_id>/delete/', CompetencePaperDeleteView.as_view(), name='competence-paper-delete'),
    path('competence-papers/', AllCompetencePapersView.as_view(), name='all-competence-papers'),
    path('conversation-competence-papers/', AllConversationCompetencePapersView.as_view(), name='all-conversation-competence-papers'),
    path('conversation-competence-paper/<int:paper_id>/', ConversationCompetencePaperDetailView.as_view(), name='conversation-competence-paper-detail'),
    path('conversation-competence-paper/<int:paper_id>/delete/', ConversationCompetencePaperDeleteView.as_view(), name='conversation-competence-paper-delete'),
]

