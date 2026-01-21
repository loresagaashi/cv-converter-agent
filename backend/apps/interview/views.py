from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.cv.models import CV
from apps.interview.models import (
    CompetencePaper,
    ConversationCompetencePaper,
    ConversationQuestion,
    ConversationResponse,
    ConversationSession,
)
from apps.interview.pdf_utils import render_conversation_paper_to_pdf
from apps.interview.serializers import (
    CompetencePaperListSerializer,
    CompetencePaperSerializer,
    ConversationCompetencePaperSerializer,
)
from apps.interview.services import (
    can_user_access_conversation_paper,
    can_user_access_paper,
    can_user_delete_conversation_paper,
    can_user_delete_paper,
    get_competence_papers_for_user,
    get_conversation_competence_papers_for_user,
)
from apps.llm.services import classify_recruiter_answer


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


class ConversationSessionStartView(APIView):
    """
    Ensure there is a ConversationSession for the given CV + original competence paper.

    Returns an existing pending/in-progress session or creates a new one.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        cv_id = request.data.get("cv_id")
        paper_id = request.data.get("paper_id")

        if not isinstance(cv_id, int) or not isinstance(paper_id, int):
            return Response(
                {"detail": "cv_id (int) and paper_id (int) are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        cv_instance = get_object_or_404(CV, pk=cv_id, user=request.user)
        competence_paper = get_object_or_404(CompetencePaper, pk=paper_id, cv=cv_instance)

        session = (
            ConversationSession.objects.filter(
                cv=cv_instance,
                original_competence_paper=competence_paper,
            )
            .exclude(status="completed")
            .order_by("-created_at")
            .first()
        )

        if session is None:
            session = ConversationSession.objects.create(
                cv=cv_instance,
                original_competence_paper=competence_paper,
                status="in_progress",
            )
        else:
            if session.status != "in_progress":
                session.status = "in_progress"
                session.completed_at = None
                session.save(update_fields=["status", "completed_at"])

        return Response(
            {
                "session_id": session.id,
                "status": session.status,
            },
            status=status.HTTP_200_OK,
        )


class ConversationTurnView(APIView):
    """
    Store a single conversation turn (question + answer) for a session,
    and classify the recruiter answer.

    Payload:
    - session_id: int
    - section: str (e.g., "core_skills", "soft_skills", ...)
    - phase: "validation" | "discovery" (default: "validation")
    - question_text: str
    - answer_text: str
    """

    permission_classes = [IsAuthenticated]

    SECTION_CATEGORY_MAP = {
        "core_skills": "skill",
        "soft_skills": "skill",
        "languages": "language",
        "education": "education",
        "trainings_certifications": "training",
        "technical_competencies": "skill",
        "project_experience": "project",
        "overall": "discovery",
        "recommendation": "other",
    }

    def post(self, request):
        data = request.data or {}
        session_id = data.get("session_id")
        section = (data.get("section") or "").strip()
        phase = (data.get("phase") or "validation").strip()
        question_text = (data.get("question_text") or "").strip()
        answer_text = (data.get("answer_text") or "").strip()

        if not isinstance(session_id, int):
            return Response(
                {"detail": "session_id (int) is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not section:
            return Response(
                {"detail": "section is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        session = get_object_or_404(ConversationSession, pk=session_id)

        # Permission check: only owner (or staff via standard DRF auth) can write.
        if session.cv.user != request.user and not getattr(request.user, "is_staff", False):
            return Response(
                {"detail": "You don't have permission to modify this conversation session."},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Derive category from section.
        category = self.SECTION_CATEGORY_MAP.get(section, "other")

        # Compute next question_order.
        last_q = (
            ConversationQuestion.objects.filter(session=session)
            .order_by("-question_order")
            .first()
        )
        next_order = 1 if last_q is None else (last_q.question_order + 1)

        # Topic: short identifier of what is being asked about.
        topic = question_text[:255]

        # Classify the answer using the LLM helper with safe fallback.
        classification = classify_recruiter_answer(
            question_text=question_text,
            answer_text=answer_text,
            section=section,
        )

        status_value = classification.get("status") or "partially_confirmed"
        confidence_level = classification.get("confidence_level")
        extracted_skills = classification.get("extracted_skills") or []
        notes = classification.get("notes") or ""

        # Create question + response records.
        question = ConversationQuestion.objects.create(
            session=session,
            section=section,
            category=category,
            topic=topic,
            question_text=question_text,
            question_order=next_order,
            phase="discovery" if phase == "discovery" else "validation",
        )

        response = ConversationResponse.objects.create(
            question=question,
            answer_text=answer_text,
            status=status_value,
            confidence_level=confidence_level or None,
            extracted_skills=extracted_skills,
            notes=notes,
        )

        return Response(
            {
                "question_id": question.id,
                "response_id": response.id,
                "status": response.status,
                "confidence_level": response.confidence_level,
                "extracted_skills": response.extracted_skills,
            },
            status=status.HTTP_201_CREATED,
        )


class ConversationSessionGeneratePaperView(APIView):
    """
    Generate a conversation-based competence paper for a session.

    Includes only:
    - Items confirmed during interview (status = confirmed / partially_confirmed)
    - Items added during interview (status = new_skill, including discovery phase)

    Excludes:
    - Items explicitly marked not_confirmed
    """

    permission_classes = [IsAuthenticated]

    SECTION_LABELS = {
        "core_skills": "Core Skills",
        "soft_skills": "Soft Skills",
        "languages": "Languages",
        "education": "Education",
        "trainings_certifications": "Trainings & Certifications",
        "technical_competencies": "Technical Competencies",
        "project_experience": "Project Experience",
    }

    def post(self, request, session_id):
        session = get_object_or_404(ConversationSession, pk=session_id)

        # Permission
        if session.cv.user != request.user and not getattr(request.user, "is_staff", False):
            return Response(
                {"detail": "You don't have permission to generate a paper for this session."},
                status=status.HTTP_403_FORBIDDEN,
            )

        questions = (
            ConversationQuestion.objects.filter(session=session)
            .select_related("response")
            .order_by("question_order")
        )

        # Aggregate by section.
        section_items = {key: [] for key in self.SECTION_LABELS.keys()}
        additional_notes = []

        for q in questions:
            resp = getattr(q, "response", None)
            if resp is None:
                continue

            status_value = resp.status
            if status_value == "not_confirmed":
                continue

            # Determine target section.
            section_key = q.section
            if section_key not in section_items and section_key != "overall":
                continue

            summary_line = resp.answer_text.strip() or q.question_text.strip()

            if section_key in section_items:
                section_items[section_key].append(summary_line)
            else:
                # overall / discovery-style information goes into additional notes.
                additional_notes.append(summary_line)

        # Build text content.
        lines = []

        # Our Recommendation – simple summary from confirmed/new items.
        all_skill_lines = section_items.get("core_skills", []) + section_items.get(
            "technical_competencies", []
        )
        all_project_lines = section_items.get("project_experience", [])
        rec_parts = []
        if all_skill_lines:
            rec_parts.append("The candidate has confirmed core and technical skills such as:")
            rec_parts.append("- " + "; ".join(all_skill_lines[:5]))
        if all_project_lines:
            rec_parts.append("They have relevant project experience, including:")
            rec_parts.append("- " + "; ".join(all_project_lines[:3]))
        if additional_notes:
            rec_parts.append("Additional strengths and context from the interview:")
            rec_parts.append("- " + "; ".join(additional_notes[:5]))

        if rec_parts:
            lines.append("Our Recommendation")
            lines.append("------------------")
            lines.extend(rec_parts)
            lines.append("")

        # Structured sections in fixed order.
        for key, label in self.SECTION_LABELS.items():
            items = section_items.get(key) or []
            if not items:
                continue
            lines.append(label)
            lines.append("-" * len(label))
            for item in items:
                lines.append(f"- {item}")
            lines.append("")

        # Additional information section (from discovery / overall).
        if additional_notes:
            lines.append("Additional Information from Interview")
            lines.append("------------------------------------")
            for note in additional_notes:
                lines.append(f"- {note}")
            lines.append("")

        full_content = "\n".join(lines).strip()

        if not full_content:
            return Response(
                {
                    "detail": "No confirmed or new items were found for this session. Cannot generate a competence paper."
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Create or update the conversation-based competence paper.
        conversation_paper = session.conversation_competence_paper
        if conversation_paper is None:
            conversation_paper = ConversationCompetencePaper.objects.create(
                conversation_session=session,
                content=full_content,
            )
            session.conversation_competence_paper = conversation_paper
        else:
            conversation_paper.content = full_content
            conversation_paper.save(update_fields=["content"])

        session.status = "completed"
        session.completed_at = timezone.now()
        session.save(update_fields=["status", "completed_at", "conversation_competence_paper"])

        serializer = ConversationCompetencePaperSerializer(conversation_paper)
        return Response(serializer.data, status=status.HTTP_200_OK)


class ConversationCompetencePaperUpdateView(APIView):
    """
    Allow editing of a conversation-based competence paper's content.
    """

    permission_classes = [IsAuthenticated]

    def patch(self, request, paper_id):
        conversation_paper = get_object_or_404(ConversationCompetencePaper, pk=paper_id)

        if not can_user_access_conversation_paper(request.user, conversation_paper):
            return Response(
                {"detail": "You don't have permission to edit this competence paper."},
                status=status.HTTP_403_FORBIDDEN,
            )

        content = (request.data.get("content") or "").strip()
        if not content:
            return Response(
                {"detail": "content must not be empty."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        conversation_paper.content = content
        conversation_paper.save(update_fields=["content"])

        serializer = ConversationCompetencePaperSerializer(conversation_paper)
        return Response(serializer.data, status=status.HTTP_200_OK)


class ConversationCompetencePaperPDFView(APIView):
    """
    Generate a simple PDF from the stored ConversationCompetencePaper content.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, paper_id):
        conversation_paper = get_object_or_404(ConversationCompetencePaper, pk=paper_id)

        if not can_user_access_conversation_paper(request.user, conversation_paper):
            return Response(
                {"detail": "You don't have permission to access this competence paper."},
                status=status.HTTP_403_FORBIDDEN,
            )

        from pathlib import Path
        from django.conf import settings
        from django.http import HttpResponse

        session = conversation_paper.conversation_session
        cv_instance = session.cv

        output_dir = Path(settings.MEDIA_ROOT) / "conversation_papers"
        safe_name = cv_instance.original_filename.replace("/", "_").replace("\\", "_")
        output_path = output_dir / f"conversation_paper_{conversation_paper.id}_{safe_name}"
        if not output_path.suffix.lower().endswith(".pdf"):
            output_path = output_path.with_suffix(".pdf")

        pdf_path = render_conversation_paper_to_pdf(
            conversation_paper.content,
            output_path=output_path,
            title="Conversation Competence Paper",
        )

        with open(pdf_path, "rb") as f:
            pdf_bytes = f.read()

        response = HttpResponse(
            pdf_bytes,
            content_type="application/pdf",
        )
        response["Content-Disposition"] = (
            f'attachment; filename="{cv_instance.original_filename.rsplit(".", 1)[0]}_conversation_paper.pdf"'
        )
        return response

