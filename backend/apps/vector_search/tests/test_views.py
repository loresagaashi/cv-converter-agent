"""
Integration tests for vector search API endpoints.
Uses unittest.mock.patch to stub the OpenAI and ChromaDB calls.
"""

from unittest.mock import patch, MagicMock

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.users.models import User


@override_settings(
    REST_FRAMEWORK={
        "DEFAULT_AUTHENTICATION_CLASSES": [
            "apps.users.authentication.JWTAuthentication",
        ],
        "DEFAULT_PERMISSION_CLASSES": [
            "rest_framework.permissions.IsAuthenticated",
        ],
    }
)
class TestMatchView(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email="test@example.com",
            password="testpass123",
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    @patch("apps.vector_search.services.search_for_candidates")
    def test_match_returns_expected_shape(self, mock_search):
        """Verify the response shape of POST /api/vector-search/match/."""
        mock_candidate = MagicMock()
        mock_candidate.to_dict.return_value = {
            "id": "cv-1",
            "name": "Test Candidate",
            "current_title": "Software Engineer",
            "stated_seniority": "mid",
            "inferred_competency": "senior",
            "years_of_experience": 5.0,
            "vector_similarity": 0.89,
            "skill_overlap": {
                "matched_required": ["python", "django"],
                "missing_required": ["aws"],
                "matched_preferred": [],
                "required_coverage": 0.667,
                "total_score": 0.5,
            },
            "composite_score": 0.82,
            "search_tier": 1,
            "competency_note": "Matches required senior level",
        }

        mock_search.return_value = (
            {
                "title": "Senior Python Developer",
                "seniority": "senior",
                "required_skills": ["Python", "Django", "AWS"],
                "preferred_skills": [],
                "min_years_experience": 5,
                "embedding_text": "test",
            },
            [mock_candidate],
        )

        response = self.client.post(
            "/api/vector-search/match/",
            data={
                "job_description": "Looking for a senior Python developer with Django and AWS.",
                "top_k": 5,
                "include_gap_analysis": False,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("parsed_jd", data)
        self.assertIn("candidates", data)
        self.assertIn("total_results", data)
        self.assertEqual(data["total_results"], 1)

        candidate = data["candidates"][0]
        self.assertEqual(candidate["name"], "Test Candidate")
        self.assertIn("composite_score", candidate)
        self.assertIn("skill_overlap", candidate)

    @patch("apps.vector_search.services.search_for_candidates")
    def test_match_requires_auth(self, mock_search):
        """Unauthenticated requests should be rejected."""
        unauth_client = APIClient()
        response = unauth_client.post(
            "/api/vector-search/match/",
            data={"job_description": "test", "top_k": 5, "include_gap_analysis": False},
            format="json",
        )
        self.assertEqual(response.status_code, 401)

    def test_match_validates_input(self):
        """Missing job_description should return 400."""
        response = self.client.post(
            "/api/vector-search/match/",
            data={"top_k": 5},
            format="json",
        )
        self.assertEqual(response.status_code, 400)


class TestStatusView(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email="test2@example.com",
            password="testpass123",
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    @patch("apps.vector_search.services.get_collection_count", return_value=42)
    @patch("apps.vector_search.services.is_chroma_ready", return_value=True)
    def test_status_returns_expected_shape(self, mock_ready, mock_count):
        response = self.client.get("/api/vector-search/status/")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("indexed_count", data)
        self.assertIn("total_cvs", data)
        self.assertIn("chroma_ready", data)
