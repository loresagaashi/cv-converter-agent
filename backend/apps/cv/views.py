import json
import logging
import time
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
from apps.llm.services import generate_structured_cv


logger = logging.getLogger(__name__)


class CVUploadView(generics.ListCreateAPIView):
    serializer_class = CVSerializer
    permission_classes = [IsAuthenticated]
    parser_classes = (MultiPartParser, FormParser)

    def get_queryset(self):
        return CV.objects.filter(user=self.request.user)

    def create(self, request, *args, **kwargs):
        req_start = time.monotonic()
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        cv_instance = serializer.save()

        # Do not call LLM on upload; just persist the file and return metadata.
        competence_summary = ""
        skills = []

        headers = self.get_success_headers(serializer.data)
        response_data = {
            **serializer.data,
            "competence_summary": competence_summary,
            "skills": skills,
        }
        total_elapsed = time.monotonic() - req_start
        logger.info(
            "cv_upload_completed",
            extra={"cv_id": cv_instance.id, "seconds": round(total_elapsed, 3)},
        )
        print(f"[REQ] upload done cv_id={cv_instance.id} seconds={total_elapsed:.3f}")
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
        req_start = time.monotonic()
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
        llm_start = time.monotonic()
        print(f"[LLM] structured start cv_id={cv_instance.id}")
        structured_cv = generate_structured_cv(cv_text)
        llm_elapsed = time.monotonic() - llm_start
        logger.info(
            "structured_cv_llm_completed",
            extra={"cv_id": cv_instance.id, "seconds": round(llm_elapsed, 3)},
        )
        print(f"[LLM] structured done cv_id={cv_instance.id} seconds={llm_elapsed:.3f}")

        # Render PDF using a deterministic template.
        output_dir = Path(settings.MEDIA_ROOT) / "formatted_cvs"
        safe_name = cv_instance.original_filename.replace("/", "_").replace("\\", "_")
        output_path = output_dir / f"cv_{cv_instance.id}_{safe_name}"
        if not output_path.suffix.lower().endswith(".pdf"):
            output_path = output_path.with_suffix(".pdf")

        # Prefer the Ajlla HTML template when available; fallback stays FPDF.
        template_path = Path(settings.BASE_DIR).parent / "Ajlla_Product Owner.html"
        pdf_path = render_structured_cv_to_pdf(
            structured_cv,
            output_path=output_path,
            html_template_path=template_path,
        )

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
        total_elapsed = time.monotonic() - req_start
        logger.info(
            "formatted_cv_completed",
            extra={"cv_id": cv_instance.id, "seconds": round(total_elapsed, 3)},
        )
        print(f"[REQ] formatted done cv_id={cv_instance.id} seconds={total_elapsed:.3f}")
        return response


class StructuredCVView(APIView):
    """
    Return the LLM-generated structured CV for a given CV.
    This allows the frontend to show an editable preview and POST back with edits.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        req_start = time.monotonic()
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
        llm_start = time.monotonic()
        print(f"[LLM] structured start cv_id={cv_instance.id}")
        structured_cv = generate_structured_cv(cv_text)
        llm_elapsed = time.monotonic() - llm_start
        logger.info(
            "structured_cv_llm_completed",
            extra={"cv_id": cv_instance.id, "seconds": round(llm_elapsed, 3)},
        )
        print(f"[LLM] structured done cv_id={cv_instance.id} seconds={llm_elapsed:.3f}")

        total_elapsed = time.monotonic() - req_start
        logger.info(
            "structured_cv_get_completed",
            extra={"cv_id": cv_instance.id, "seconds": round(total_elapsed, 3)},
        )
        print(f"[REQ] structured get done cv_id={cv_instance.id} seconds={total_elapsed:.3f}")
        return Response(structured_cv, status=status.HTTP_200_OK)

    def post(self, request, pk):
        """
        Accept edited structured CV data and render a PDF with the edits applied.
        
        Expected payload:
        {
          "structured_cv": { ... edited CV structure ... },
          "section_order": ["profile", "work_experience", ...] (optional)
        }
        """
        req_start = time.monotonic()
        cv_instance = get_object_or_404(CV, pk=pk, user=request.user)

        try:
            structured_cv = request.data.get("structured_cv", {})
            section_order = request.data.get("section_order")
        except Exception as e:
            return Response(
                {"detail": f"Invalid payload: {str(e)}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Render PDF using the edited structured CV.
        output_dir = Path(settings.MEDIA_ROOT) / "formatted_cvs"
        safe_name = cv_instance.original_filename.replace("/", "_").replace("\\", "_")
        output_path = output_dir / f"cv_{cv_instance.id}_{safe_name}"
        if not output_path.suffix.lower().endswith(".pdf"):
            output_path = output_path.with_suffix(".pdf")

        # Prefer the Ajlla HTML template when available; fallback stays FPDF.
        template_path = Path(settings.BASE_DIR).parent / "Ajlla_Product Owner.html"
        pdf_path = render_structured_cv_to_pdf(
            structured_cv,
            output_path=output_path,
            html_template_path=template_path,
            section_order=section_order,
        )

        with open(pdf_path, "rb") as f:
            pdf_bytes = f.read()

        response = HttpResponse(
            pdf_bytes,
            content_type="application/pdf",
        )
        # Suggest a friendly download filename.
        response["Content-Disposition"] = (
            f'attachment; filename="{cv_instance.original_filename.rsplit(".", 1)[0]}_edited.pdf"'
        )
        total_elapsed = time.monotonic() - req_start
        logger.info(
            "structured_cv_post_completed",
            extra={"cv_id": cv_instance.id, "seconds": round(total_elapsed, 3)},
        )
        print(f"[REQ] structured post done cv_id={cv_instance.id} seconds={total_elapsed:.3f}")
        return response
