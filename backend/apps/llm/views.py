from typing import Any, Dict, List

from django.shortcuts import get_object_or_404
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.cv.models import CV
from apps.cv.services import read_cv_file
from apps.interview.models import CompetencePaper
from apps.llm.services import generate_recruiter_next_question


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

        if not isinstance(cv_id, int) or not isinstance(paper_id, int):
            return Response(
                {"detail": "cv_id (int) and paper_id (int) are required."},
                status=400,
            )

        # Ensure the CV and competence paper belong to the authenticated user.
        cv_instance = get_object_or_404(CV, pk=cv_id, user=request.user)
        competence_paper = get_object_or_404(CompetencePaper, pk=paper_id, cv=cv_instance)

        # Extract plain text for the CV – this is the primary source of truth.
        file_obj = cv_instance.file
        content_type = getattr(getattr(file_obj, "file", None), "content_type", None)
        cv_text = read_cv_file(
            file_obj,
            name=cv_instance.original_filename,
            content_type=content_type,
        )

        competence_text = competence_paper.content or ""

        try:
            result = generate_recruiter_next_question(
                cv_text=cv_text or "",
                competence_text=competence_text,
                history=history,
                section=section,
            )
        except Exception:
            return Response(
                {"detail": "Failed to generate next question. Please try again."},
                status=500,
            )

        return Response(result, status=200)
