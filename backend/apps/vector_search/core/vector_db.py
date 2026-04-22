"""
Vector DB operations backed by pgvector in Postgres (via Django ORM).

Provides helpers for upserting, removing, counting, and querying CV embeddings.
"""

import logging

from ..models import CvEmbedding

logger = logging.getLogger(__name__)


def upsert_profile(
    profile_id: str,
    embedding: list[float],
    document: str,
    metadata: dict,
) -> None:
    """Upsert a single profile into the cv_embeddings table."""
    CvEmbedding.objects.update_or_create(
        profile_id=profile_id,
        defaults={
            "embedding": embedding,
            "document": document,
            "metadata": metadata,
        },
    )


def remove_profile(profile_id: str) -> None:
    """Remove a single profile from the cv_embeddings table."""
    try:
        CvEmbedding.objects.filter(profile_id=profile_id).delete()
    except Exception as e:
        logger.warning(f"Failed to remove profile {profile_id}: {e}")


def get_collection_count() -> int:
    """Return the number of documents in the cv_embeddings table."""
    try:
        return CvEmbedding.objects.count()
    except Exception:
        return 0


def is_vector_db_ready() -> bool:
    """Check whether the cv_embeddings table is accessible."""
    try:
        CvEmbedding.objects.count()
        return True
    except Exception:
        return False


def query_similar(
    query_embedding: list[float],
    n_results: int = 200,
) -> list[dict]:
    """
    Return the top-N most similar embeddings using pgvector cosine distance.

    Each result dict contains: id, document, metadata, similarity (float 0..1).
    """
    from pgvector.django import CosineDistance

    results = (
        CvEmbedding.objects
        .annotate(distance=CosineDistance("embedding", query_embedding))
        .order_by("distance")[:n_results]
    )

    return [
        {
            "id": row.profile_id,
            "document": row.document,
            "metadata": row.metadata,
            "similarity": 1 - row.distance,
        }
        for row in results
    ]
