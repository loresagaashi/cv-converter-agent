import logging

from drf_spectacular.utils import extend_schema, OpenApiResponse
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .serializers import IndexCVSerializer, BulkIndexSerializer, MatchRequestSerializer
from . import services

logger = logging.getLogger(__name__)


class IndexCVView(APIView):
    """Index a single CV into the vector database."""
    permission_classes = [IsAuthenticated]

    @extend_schema(
        request=IndexCVSerializer,
        responses={200: OpenApiResponse(description="CV indexed successfully")},
        tags=["Vector Search"],
    )
    def post(self, request):
        serializer = IndexCVSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        from apps.cv.models import CV
        cv_id = serializer.validated_data["cv_id"]

        try:
            if getattr(request.user, "is_staff", False):
                cv = CV.objects.get(id=cv_id)
            else:
                cv = CV.objects.get(id=cv_id, user=request.user)
        except CV.DoesNotExist:
            return Response(
                {"detail": "CV not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        result = services.index_cv(cv)
        return Response(result, status=status.HTTP_200_OK)


class BulkIndexView(APIView):
    """Bulk-index multiple CVs into the vector database."""
    permission_classes = [IsAuthenticated]

    @extend_schema(
        request=BulkIndexSerializer,
        responses={200: OpenApiResponse(description="Bulk indexing result")},
        tags=["Vector Search"],
    )
    def post(self, request):
        serializer = BulkIndexSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        cv_ids = serializer.validated_data.get("cv_ids")
        index_all = serializer.validated_data.get("all", False)

        if index_all:
            cv_ids = None

        result = services.bulk_index_cvs(cv_ids=cv_ids, user=request.user)
        return Response(result, status=status.HTTP_200_OK)


class MatchView(APIView):
    """Search for matching candidates given a job description."""
    permission_classes = [IsAuthenticated]

    @extend_schema(
        request=MatchRequestSerializer,
        responses={200: OpenApiResponse(description="Matching candidates")},
        tags=["Vector Search"],
    )
    def post(self, request):
        serializer = MatchRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        result = services.match_candidates(
            job_description=serializer.validated_data["job_description"],
            top_k=serializer.validated_data["top_k"],
            include_gap_analysis=serializer.validated_data["include_gap_analysis"],
        )
        return Response(result, status=status.HTTP_200_OK)


class StatusView(APIView):
    """Return vector search index status."""
    permission_classes = [IsAuthenticated]

    @extend_schema(
        responses={200: OpenApiResponse(description="Index status")},
        tags=["Vector Search"],
    )
    def get(self, request):
        result = services.get_index_status(user=request.user)
        return Response(result, status=status.HTTP_200_OK)


class RemoveIndexView(APIView):
    """Remove a single CV from the vector index."""
    permission_classes = [IsAuthenticated]

    @extend_schema(
        responses={200: OpenApiResponse(description="CV removed from index")},
        tags=["Vector Search"],
    )
    def delete(self, request, cv_id):
        from apps.cv.models import CV
        try:
            if getattr(request.user, "is_staff", False):
                CV.objects.get(id=cv_id)
            else:
                CV.objects.get(id=cv_id, user=request.user)
        except CV.DoesNotExist:
            return Response(
                {"detail": "CV not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        services.remove_cv_from_index(cv_id)
        return Response({"removed": True}, status=status.HTTP_200_OK)
