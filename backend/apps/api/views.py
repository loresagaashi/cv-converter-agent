from django.conf import settings
from django.http import Http404
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework import serializers
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.cv.models import CV
from apps.cv.services import read_cv_file
from apps.llm.services import generate_competence_cv
from apps.interview.models import CompetencePaper


class SchemaFallbackSerializer(serializers.Serializer):
    pass


class DocumentedAPIView(APIView):
    serializer_class = SchemaFallbackSerializer


class ConvertCVView(DocumentedAPIView):
    """
    Conversion endpoint:

    - Accepts either a stored CV id (`cv_id`) or a directly uploaded file (`file`).
    - Uses existing CV parsing helpers to extract plain text.
    - Calls the LLM service to generate a competence summary and skills.
    """

    permission_classes = [IsAuthenticated]
    parser_classes = (JSONParser, MultiPartParser, FormParser)

    def post(self, request, *args, **kwargs):
        cv_id = request.data.get("cv_id")
        uploaded_file = request.FILES.get("file")

        if not cv_id and not uploaded_file:
            return Response(
                {"detail": "Provide either 'cv_id' or upload a 'file'."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        cv_instance = None
        original_filename = None

        if cv_id:
            # Admins can access any CV; regular users only their own
            if getattr(request.user, 'is_staff', False):
                cv_instance = get_object_or_404(CV, pk=cv_id)
            else:
                cv_instance = get_object_or_404(CV, pk=cv_id, user=request.user)
            file_obj = cv_instance.file
            original_filename = cv_instance.original_filename
            # For stored files, extension is usually enough for type detection.
            cv_text = read_cv_file(file_obj, name=original_filename)
        else:
            file_obj = uploaded_file
            original_filename = getattr(uploaded_file, "name", None)
            content_type = getattr(uploaded_file, "content_type", None)
            cv_text = read_cv_file(
                file_obj,
                name=original_filename,
                content_type=content_type,
            )

        llm_result = generate_competence_cv(cv_text)
        competence_summary = llm_result.get("competence_summary", "")
        skills = llm_result.get("skills", [])

        # Don't store on generate - only return the data for preview
        # Storage will happen when user exports after editing

        response_data = {
            "source": {
                "cv_id": cv_instance.id if cv_instance else None,
                "original_filename": original_filename,
            },
            "competence_summary": competence_summary,
            "skills": skills,
        }

        return Response(response_data, status=status.HTTP_200_OK)


class ProxyDebugHeadersView(APIView):
    """Temporary endpoint to inspect proxy forwarding headers for throttle tuning."""

    permission_classes = [AllowAny]
    authentication_classes: list = []

    def get(self, request, *args, **kwargs):
        if not settings.DEBUG:
            raise Http404()

        raw_x_forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR", "")
        forwarded_chain = [
            part.strip() for part in raw_x_forwarded_for.split(",") if part.strip()
        ]

        return Response(
            {
                "http_x_forwarded_for": raw_x_forwarded_for,
                "remote_addr": request.META.get("REMOTE_ADDR"),
                "forwarded_chain": forwarded_chain,
                "forwarded_chain_count": len(forwarded_chain),
            },
            status=status.HTTP_200_OK,
        )
