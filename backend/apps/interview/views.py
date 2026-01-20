from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.cv.models import CV
from apps.interview.models import CompetencePaper, ConversationCompetencePaper
from apps.interview.serializers import (
    CompetencePaperSerializer, 
    CompetencePaperListSerializer,
    ConversationCompetencePaperSerializer,
)
from apps.interview.services import (
    get_competence_papers_for_user,
    can_user_access_paper,
    can_user_delete_paper,
    get_conversation_competence_papers_for_user,
    can_user_access_conversation_paper,
    can_user_delete_conversation_paper,
)
from django.shortcuts import get_object_or_404


class CompetencePaperListView(APIView):
    """
    List all stored competence papers for a CV.
    """
    
    permission_classes = [IsAuthenticated]
    
    def get(self, request, cv_id):
        cv_instance = get_object_or_404(CV, pk=cv_id, user=request.user)
        
        # Get all original competence papers for this CV
        competence_papers = CompetencePaper.objects.filter(
            cv=cv_instance
        ).order_by('-created_at')
        
        serializer = CompetencePaperListSerializer(competence_papers, many=True)
        
        return Response({
            "cv_id": cv_instance.id,
            "papers": serializer.data,
            "count": len(serializer.data),
        }, status=status.HTTP_200_OK)


class CompetencePaperDetailView(APIView):
    """
    Retrieve a specific stored competence paper by ID.
    """
    
    permission_classes = [IsAuthenticated]
    
    def get(self, request, paper_id):
        competence_paper = get_object_or_404(CompetencePaper, pk=paper_id)
        
        # Verify the user has permission to access this paper
        if not can_user_access_paper(request.user, competence_paper):
            return Response(
                {"detail": "You don't have permission to access this competence paper."},
                status=status.HTTP_403_FORBIDDEN,
            )
        
        serializer = CompetencePaperListSerializer(competence_paper)
        return Response(serializer.data, status=status.HTTP_200_OK)


class AllCompetencePapersView(APIView):
    """
    List all stored competence papers for the authenticated user (across all CVs).
    """
    
    permission_classes = [IsAuthenticated]
    
    def get(self, request):
        # Get original competence papers using service function
        competence_papers = get_competence_papers_for_user(request.user)
        
        # Serialize with full information (including CV and user details)
        serializer = CompetencePaperSerializer(competence_papers, many=True)
        
        return Response({
            "papers": serializer.data,
            "count": len(serializer.data),
        }, status=status.HTTP_200_OK)


class CompetencePaperDeleteView(APIView):
    """
    Delete a specific stored competence paper by ID.
    """
    
    permission_classes = [IsAuthenticated]
    
    def delete(self, request, paper_id):
        competence_paper = get_object_or_404(CompetencePaper, pk=paper_id)
        
        # Verify the user has permission to delete this paper
        if not can_user_delete_paper(request.user, competence_paper):
            return Response(
                {"detail": "You don't have permission to delete this competence paper."},
                status=status.HTTP_403_FORBIDDEN,
            )
        
        competence_paper.delete()
        
        return Response(
            {"detail": "Competence paper deleted successfully."},
            status=status.HTTP_200_OK
        )


class AllConversationCompetencePapersView(APIView):
    """
    List all conversation-based competence papers for the authenticated user (across all CVs).
    """
    
    permission_classes = [IsAuthenticated]
    
    def get(self, request):
        # Get conversation-based competence papers using service function
        conversation_papers = get_conversation_competence_papers_for_user(request.user)
        
        # Serialize with full information (including CV and user details)
        serializer = ConversationCompetencePaperSerializer(conversation_papers, many=True)
        
        return Response({
            "papers": serializer.data,
            "count": len(serializer.data),
        }, status=status.HTTP_200_OK)


class ConversationCompetencePaperDetailView(APIView):
    """
    Retrieve a specific conversation-based competence paper by ID.
    """
    
    permission_classes = [IsAuthenticated]
    
    def get(self, request, paper_id):
        conversation_paper = get_object_or_404(ConversationCompetencePaper, pk=paper_id)
        
        # Verify the user has permission to access this paper
        if not can_user_access_conversation_paper(request.user, conversation_paper):
            return Response(
                {"detail": "You don't have permission to access this competence paper."},
                status=status.HTTP_403_FORBIDDEN,
            )
        
        serializer = ConversationCompetencePaperSerializer(conversation_paper)
        return Response(serializer.data, status=status.HTTP_200_OK)


class ConversationCompetencePaperDeleteView(APIView):
    """
    Delete a specific conversation-based competence paper by ID.
    """
    
    permission_classes = [IsAuthenticated]
    
    def delete(self, request, paper_id):
        conversation_paper = get_object_or_404(ConversationCompetencePaper, pk=paper_id)
        
        # Verify the user has permission to delete this paper
        if not can_user_delete_conversation_paper(request.user, conversation_paper):
            return Response(
                {"detail": "You don't have permission to delete this competence paper."},
                status=status.HTTP_403_FORBIDDEN,
            )
        
        conversation_paper.delete()
        
        return Response(
            {"detail": "Conversation competence paper deleted successfully."},
            status=status.HTTP_200_OK
        )

