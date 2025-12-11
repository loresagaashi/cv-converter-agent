from rest_framework import generics, status
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import CV
from .serializers import CVSerializer
from .services import read_cv_file
from apps.llm.services import generate_competence_cv


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
