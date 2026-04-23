"""
Thin orchestration layer between the Django views and the core matching engine.
"""

import logging

from apps.cv.models import CV
from apps.interview.models import CompetencePaper

from .core.embeddings import embed_text
from .core.parsing import build_embedding_text
from .core.vector_db import (
    upsert_profile,
    remove_profile,
    get_collection_count,
    is_vector_db_ready,
)
from .core.search import (
    search_for_candidates,
    parse_jd_live,
    _extract_skills_by_keyword,
)
from .core.gap_analysis import enrich_results_with_gap_analysis
from .core.skill_training_recommendations import generate_skill_training_recommendations

logger = logging.getLogger(__name__)


# Section headers in the Competence Paper that contain skill-like bullets.
# Everything outside these sections (Work Experience, Languages, Education,
# Training & Certifications, Recommendation, ...) is ignored so we don't
# pollute the skills metadata with job titles, degrees, or language levels.
_CP_SKILL_SECTIONS = {
    "soft skills",
    "core skills",
    "tech competencies",
    "technical competencies",
}

_CP_KNOWN_SECTIONS = _CP_SKILL_SECTIONS | {
    "name",
    "seniority",
    "recommendation",
    "work experience",
    "languages",
    "education",
    "training & certifications",
    "trainings & certifications",
}


def _parse_competence_metadata(content: str) -> dict:
    """
    Extract structured metadata (skills, seniority) from competence paper content.

    Scans the CP line-by-line and only treats bullets inside the skill-carrying
    sections as skills. Supports both single-item (`• Frontend: React`) and
    multi-item (`• Backend: Python, Node.js`) tech-competency rows.
    """
    skills: list[str] = []
    seniority = "mid"
    current_section: str | None = None

    for line in content.splitlines():
        stripped = line.strip()
        if not stripped:
            continue

        if stripped.lower().startswith("seniority:"):
            raw = stripped.split(":", 1)[1].strip().lower()
            for level in ("junior", "mid", "senior", "lead", "principal", "director"):
                if level in raw:
                    seniority = level
                    break
            continue

        # Section header detection: an unbulleted line ending with ":" whose
        # label matches a known CP section switches context.
        if not stripped.startswith("•") and not stripped.startswith("-") and stripped.endswith(":"):
            header = stripped[:-1].strip().lower()
            if header in _CP_KNOWN_SECTIONS:
                current_section = header
            else:
                current_section = None
            continue

        if current_section not in _CP_SKILL_SECTIONS:
            continue

        if not stripped.startswith("• "):
            continue

        body = stripped[2:].strip()
        if not body:
            continue

        if ":" in body:
            after_colon = body.split(":", 1)[1]
            skills.extend(s.strip() for s in after_colon.split(",") if s.strip())
        else:
            if len(body) < 60:
                skills.append(body)

    return {
        "seniority": seniority,
        "skills": ", ".join(dict.fromkeys(skills)),
    }


def _merge_skills(*sources: str | list[str]) -> str:
    """Merge multiple skill sources into a case-insensitive de-duplicated list."""
    seen: dict[str, str] = {}
    for src in sources:
        if isinstance(src, str):
            items = [s.strip() for s in src.split(",")]
        else:
            items = [str(s).strip() for s in (src or [])]
        for item in items:
            if not item:
                continue
            key = item.lower()
            if key not in seen:
                seen[key] = item
    return ", ".join(seen.values())


def index_cv(cv_instance: CV) -> dict:
    """
    Embed and upsert a single CV into the vector DB.
    Prefers the competence paper content (structured, LLM-processed) when
    available; falls back to raw extracted text otherwise.
    """
    cp = (
        CompetencePaper.objects
        .filter(cv=cv_instance)
        .order_by("-created_at")
        .first()
    )

    if cp and cp.content.strip():
        embedding_text = cp.content.strip()
        source = "competence_paper"
    else:
        raw_text = cv_instance.extracted_text or ""
        if not raw_text.strip():
            return {"indexed": False, "error": "No extracted text or competence paper available"}

        name = ""
        if hasattr(cv_instance, "user") and cv_instance.user:
            u = cv_instance.user
            name = f"{u.first_name} {u.last_name}".strip() or u.email

        embedding_text = build_embedding_text(raw_text, name=name, title=cv_instance.original_filename)
        source = "extracted_text"

    embedding = embed_text(embedding_text)
    if embedding is None:
        return {"indexed": False, "error": "Embedding generation failed"}

    profile_id = f"cv-{cv_instance.id}"

    name = ""
    if hasattr(cv_instance, "user") and cv_instance.user:
        u = cv_instance.user
        name = f"{u.first_name} {u.last_name}".strip() or u.email

    raw_text_for_keywords = cv_instance.extracted_text or ""

    if source == "competence_paper":
        parsed = _parse_competence_metadata(embedding_text)
        # Supplement the regex-parsed skills with a keyword sweep over both
        # the CP content and the raw CV text, so the metadata is robust to
        # CP formatting variations (single-item groups, missing sections, ...).
        keyword_skills = _extract_skills_by_keyword(
            embedding_text + "\n" + raw_text_for_keywords
        )
        merged_skills = _merge_skills(parsed["skills"], keyword_skills)
        metadata = {
            "name": name or "Unknown",
            "current_title": cv_instance.original_filename,
            "seniority": parsed["seniority"],
            "years_of_experience": 0.0,
            "skills": merged_skills,
            "source_file": cv_instance.original_filename,
        }
    else:
        keyword_skills = _extract_skills_by_keyword(raw_text_for_keywords)
        metadata = {
            "name": name or "Unknown",
            "current_title": cv_instance.original_filename,
            "seniority": "mid",
            "years_of_experience": 0.0,
            "skills": _merge_skills(keyword_skills),
            "source_file": cv_instance.original_filename,
        }

    upsert_profile(
        profile_id=profile_id,
        embedding=embedding,
        document=embedding_text,
        metadata=metadata,
    )

    skill_count = len([s for s in metadata["skills"].split(",") if s.strip()])
    logger.info(
        "Indexed CV %s as %s (source=%s, seniority=%s, skills=%d)",
        cv_instance.id, profile_id, source, metadata["seniority"], skill_count,
    )
    return {"indexed": True, "profile_id": profile_id, "source": source}


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
    Training plans are always generated for candidates with missing skills.
    """
    parsed_jd, results = search_for_candidates(job_description, top_k=top_k)

    if include_gap_analysis and results:
        candidates = enrich_results_with_gap_analysis(results, parsed_jd, max_to_analyze=top_k)
    else:
        candidates = [r.to_dict() for r in results]

    for i, result in enumerate(results[:len(candidates)]):
        training_plan = generate_skill_training_recommendations(result, parsed_jd)
        candidates[i]["training_plan"] = training_plan

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
    from django.db.models import Q, Exists, OuterRef

    has_cp = Exists(CompetencePaper.objects.filter(cv=OuterRef("pk")))
    has_text = Q(extracted_text__isnull=False) & ~Q(extracted_text="")
    indexable = has_text | Q(pk__in=CV.objects.filter(has_cp).values("pk"))

    if user and getattr(user, "is_staff", False):
        total_cvs = CV.objects.filter(indexable).distinct().count()
    elif user:
        total_cvs = CV.objects.filter(user=user).filter(indexable).distinct().count()
    else:
        total_cvs = 0

    return {
        "indexed_count": get_collection_count(),
        "total_cvs": total_cvs,
        "vector_db_ready": is_vector_db_ready(),
    }
