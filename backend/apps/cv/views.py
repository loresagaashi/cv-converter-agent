from pathlib import Path

from django.conf import settings
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework import generics, status
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import CV
from .pdf_renderer import render_structured_cv_to_pdf
from .serializers import CVSerializer
from .services import read_cv_file
from apps.llm.services import generate_competence_cv, generate_structured_cv


class CVUploadView(generics.ListCreateAPIView):
    serializer_class = CVSerializer
    permission_classes = [IsAuthenticated]
    parser_classes = (MultiPartParser, FormParser)

    def get_queryset(self):
        return CV.objects.filter(user=self.request.user)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        cv_instance = serializer.save()

        competence_summary = ""
        skills = []

        uploaded_file = request.FILES.get("file")
        try:
            # Use existing parsing helpers to extract text from the uploaded CV
            file_obj = cv_instance.file
            content_type = getattr(uploaded_file, "content_type", None)
            cv_text = read_cv_file(
                file_obj,
                name=cv_instance.original_filename,
                content_type=content_type,
            )

            llm_result = generate_competence_cv(cv_text)
            competence_summary = llm_result.get("competence_summary", "")
            skills = llm_result.get("skills", [])
        except Exception:
            # In case of any failure, still return the created CV without LLM data.
            competence_summary = ""
            skills = []

        headers = self.get_success_headers(serializer.data)
        response_data = {
            **serializer.data,
            "competence_summary": competence_summary,
            "skills": skills,
        }
        return Response(response_data, status=status.HTTP_201_CREATED, headers=headers)


class CVDetailView(generics.DestroyAPIView):
    """
    Allow a user to delete one of their own uploaded CVs.
    """

    serializer_class = CVSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return CV.objects.filter(user=self.request.user)


class CVTextView(APIView):
    """
    Read-only endpoint returning the extracted plain text for a single CV.

    This leverages the existing `read_cv_file` helper to ensure consistent
    parsing behavior between the API and internal usages.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        try:
            cv_instance = CV.objects.get(pk=pk, user=request.user)
        except CV.DoesNotExist:
            return Response(
                {"detail": "Not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        file_obj = cv_instance.file
        # Try to infer content type if available; it's safe to pass None.
        content_type = getattr(getattr(file_obj, "file", None), "content_type", None)
        cv_text = read_cv_file(
            file_obj,
            name=cv_instance.original_filename,
            content_type=content_type,
        )

        return Response(
            {
                "id": cv_instance.id,
                "original_filename": cv_instance.original_filename,
                "uploaded_at": cv_instance.uploaded_at,
                "text": cv_text,
            },
            status=status.HTTP_200_OK,
        )


class FormattedCVView(APIView):
    """
    Generate and return a formatted CV PDF for a given uploaded CV.

    Flow:
    - Load the user's CV.
    - Extract plain text from the stored file.
    - Ask the LLM for a normalized structured CV JSON.
    - Render a new PDF using the Ajlla-style template.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        cv_instance = get_object_or_404(CV, pk=pk, user=request.user)

        # Extract text from the stored CV file.
        file_obj = cv_instance.file
        content_type = getattr(getattr(file_obj, "file", None), "content_type", None)
        cv_text = read_cv_file(
            file_obj,
            name=cv_instance.original_filename,
            content_type=content_type,
        )

        # Generate structured JSON via LLM.
        structured_cv = generate_structured_cv(cv_text)

        # Render PDF using a deterministic template.
        output_dir = Path(settings.MEDIA_ROOT) / "formatted_cvs"
        safe_name = cv_instance.original_filename.replace("/", "_").replace("\\", "_")
        output_path = output_dir / f"cv_{cv_instance.id}_{safe_name}"
        if not output_path.suffix.lower().endswith(".pdf"):
            output_path = output_path.with_suffix(".pdf")

        pdf_path = render_structured_cv_to_pdf(structured_cv, output_path=output_path)

        with open(pdf_path, "rb") as f:
            pdf_bytes = f.read()

        response = HttpResponse(
            pdf_bytes,
            content_type="application/pdf",
        )
        # Suggest a friendly download filename.
        response["Content-Disposition"] = (
            f'attachment; filename="{cv_instance.original_filename.rsplit(".", 1)[0]}_formatted.pdf"'
        )
        return response
