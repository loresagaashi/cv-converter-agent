"""
Thin orchestration layer between the Django views and the core matching engine.
"""

import logging

from apps.cv.models import CV

from .core.embeddings import embed_text
from .core.parsing import build_embedding_text
from .core.vector_db import (
    upsert_profile,
    remove_profile,
    get_collection_count,
    is_vector_db_ready,
)
from .core.search import search_for_candidates, parse_jd_live
from .core.gap_analysis import enrich_results_with_gap_analysis

logger = logging.getLogger(__name__)


def index_cv(cv_instance: CV) -> dict:
    """
    Parse, embed, and upsert a single CV into the vector DB.
    Returns {"indexed": True, "profile_id": "..."} on success.
    """
    extracted_text = cv_instance.extracted_text or ""
    if not extracted_text.strip():
        return {"indexed": False, "error": "No extracted text available"}

    name = ""
    if hasattr(cv_instance, "user") and cv_instance.user:
        u = cv_instance.user
        name = f"{u.first_name} {u.last_name}".strip() or u.email

    embedding_text = build_embedding_text(
        extracted_text,
        name=name,
        title=cv_instance.original_filename,
    )

    embedding = embed_text(embedding_text)
    if embedding is None:
        return {"indexed": False, "error": "Embedding generation failed"}

    profile_id = f"cv-{cv_instance.id}"

    metadata = {
        "name": name or "Unknown",
        "current_title": cv_instance.original_filename,
        "seniority": "mid",
        "years_of_experience": 0.0,
        "skills": "",
        "source_file": cv_instance.original_filename,
    }

    upsert_profile(
        profile_id=profile_id,
        embedding=embedding,
        document=embedding_text,
        metadata=metadata,
    )

    logger.info(f"Indexed CV {cv_instance.id} as {profile_id}")
    return {"indexed": True, "profile_id": profile_id}


def remove_cv_from_index(cv_id: int) -> None:
    """Remove a CV from the vector DB."""
    profile_id = f"cv-{cv_id}"
    remove_profile(profile_id)
    logger.info(f"Removed {profile_id} from vector index")


def bulk_index_cvs(cv_ids: list[int] | None = None, user=None) -> dict:
    """
    Bulk-index CVs. If cv_ids is None and user is admin, index all.
    Otherwise index only the specified IDs (scoped to user ownership).
    """
    if cv_ids:
        qs = CV.objects.filter(id__in=cv_ids)
        if user and not getattr(user, "is_staff", False):
            qs = qs.filter(user=user)
    elif user and getattr(user, "is_staff", False):
        qs = CV.objects.all()
    else:
        qs = CV.objects.filter(user=user) if user else CV.objects.none()

    qs = qs.exclude(extracted_text__isnull=True).exclude(extracted_text="")

    indexed = 0
    failed = 0
    for cv in qs.iterator():
        try:
            result = index_cv(cv)
            if result.get("indexed"):
                indexed += 1
            else:
                failed += 1
        except Exception as e:
            logger.warning(f"Bulk index failed for CV {cv.id}: {e}")
            failed += 1

    return {"indexed": indexed, "failed": failed, "total": indexed + failed}


def match_candidates(
    job_description: str,
    top_k: int = 5,
    include_gap_analysis: bool = False,
) -> dict:
    """
    Run the full search pipeline: parse JD -> search -> optionally enrich with gap analysis.
    """
    parsed_jd, results = search_for_candidates(job_description, top_k=top_k)

    if include_gap_analysis and results:
        candidates = enrich_results_with_gap_analysis(results, parsed_jd, max_to_analyze=top_k)
    else:
        candidates = [r.to_dict() for r in results]

    return {
        "parsed_jd": {
            "title": parsed_jd.get("title", ""),
            "seniority": parsed_jd.get("seniority", ""),
            "required_skills": parsed_jd.get("required_skills", []),
            "preferred_skills": parsed_jd.get("preferred_skills", []),
            "min_years_experience": parsed_jd.get("min_years_experience", 0),
        },
        "candidates": candidates,
        "total_results": len(candidates),
    }


def get_index_status(user=None) -> dict:
    """Return indexing status for the dashboard health card."""
    if user and getattr(user, "is_staff", False):
        total_cvs = CV.objects.exclude(extracted_text__isnull=True).exclude(extracted_text="").count()
    elif user:
        total_cvs = CV.objects.filter(user=user).exclude(extracted_text__isnull=True).exclude(extracted_text="").count()
    else:
        total_cvs = 0

    return {
        "indexed_count": get_collection_count(),
        "total_cvs": total_cvs,
        "vector_db_ready": is_vector_db_ready(),
    }
