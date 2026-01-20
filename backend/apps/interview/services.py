from typing import List

from django.contrib.auth import get_user_model
from django.db.models import QuerySet

from apps.interview.models import CompetencePaper, ConversationCompetencePaper

User = get_user_model()


def get_competence_papers_for_user(user: User) -> QuerySet[CompetencePaper]:
    """
    Get all competence papers accessible to the user.
    
    - Admins (is_staff=True) can see all papers
    - Regular users can only see papers from their own CVs
    
    Returns a QuerySet with select_related optimizations.
    """
    if getattr(user, 'is_staff', False):
        return CompetencePaper.objects.all().select_related('cv', 'cv__user').order_by('-created_at')
    else:
        return CompetencePaper.objects.filter(
            cv__user=user
        ).select_related('cv', 'cv__user').order_by('-created_at')


def can_user_access_paper(user: User, paper: CompetencePaper) -> bool:
    """
    Check if a user has permission to access a competence paper.
    
    - Admins can access any paper
    - Regular users can only access papers from their own CVs
    """
    if getattr(user, 'is_staff', False):
        return True
    return paper.cv.user == user


def can_user_delete_paper(user: User, paper: CompetencePaper) -> bool:
    """
    Check if a user has permission to delete a competence paper.
    
    - Admins can delete any paper
    - Regular users can only delete papers from their own CVs
    """
    return can_user_access_paper(user, paper)


def get_conversation_competence_papers_for_user(user: User) -> QuerySet[ConversationCompetencePaper]:
    """
    Get all conversation-based competence papers accessible to the user.
    
    - Admins (is_staff=True) can see all papers
    - Regular users can only see papers from their own CVs
    
    Returns a QuerySet with select_related optimizations.
    """
    if getattr(user, 'is_staff', False):
        return ConversationCompetencePaper.objects.all().select_related(
            'conversation_session', 'conversation_session__cv', 'conversation_session__cv__user'
        ).order_by('-created_at')
    else:
        return ConversationCompetencePaper.objects.filter(
            conversation_session__cv__user=user
        ).select_related(
            'conversation_session', 'conversation_session__cv', 'conversation_session__cv__user'
        ).order_by('-created_at')


def can_user_access_conversation_paper(user: User, paper: ConversationCompetencePaper) -> bool:
    """
    Check if a user has permission to access a conversation-based competence paper.
    
    - Admins can access any paper
    - Regular users can only access papers from their own CVs
    """
    if getattr(user, 'is_staff', False):
        return True
    return paper.conversation_session.cv.user == user


def can_user_delete_conversation_paper(user: User, paper: ConversationCompetencePaper) -> bool:
    """
    Check if a user has permission to delete a conversation-based competence paper.
    
    - Admins can delete any paper
    - Regular users can only delete papers from their own CVs
    """
    return can_user_access_conversation_paper(user, paper)

