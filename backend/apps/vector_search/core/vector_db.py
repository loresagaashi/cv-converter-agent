"""
ChromaDB setup — ported from vector-search MVP (05_vector_db_setup.py).

Provides get_chroma_client() and helpers for upserting/removing CV profiles.
"""

import logging
from typing import Optional

from .settings import CHROMA_COLLECTION_RESUMES, get_chroma_dir

logger = logging.getLogger(__name__)


def get_chroma_client():
    """Create a persistent ChromaDB client."""
    import chromadb
    from chromadb.config import Settings

    chroma_dir = get_chroma_dir()
    chroma_dir.mkdir(parents=True, exist_ok=True)

    return chromadb.PersistentClient(
        path=str(chroma_dir),
        settings=Settings(anonymized_telemetry=False),
    )


def get_or_create_collection(client=None, name: str = CHROMA_COLLECTION_RESUMES):
    """Get or create the resume collection with cosine similarity."""
    if client is None:
        client = get_chroma_client()

    return client.get_or_create_collection(
        name=name,
        metadata={"hnsw:space": "cosine"},
    )


def upsert_profile(
    profile_id: str,
    embedding: list[float],
    document: str,
    metadata: dict,
    client=None,
) -> None:
    """Upsert a single profile into the ChromaDB collection."""
    collection = get_or_create_collection(client)
    collection.upsert(
        ids=[profile_id],
        embeddings=[embedding],
        metadatas=[metadata],
        documents=[document],
    )


def remove_profile(profile_id: str, client=None) -> None:
    """Remove a single profile from the ChromaDB collection."""
    try:
        collection = get_or_create_collection(client)
        collection.delete(ids=[profile_id])
    except Exception as e:
        logger.warning(f"Failed to remove profile {profile_id} from ChromaDB: {e}")


def get_collection_count(client=None) -> int:
    """Return the number of documents in the resume collection."""
    try:
        collection = get_or_create_collection(client)
        return collection.count()
    except Exception:
        return 0


def is_chroma_ready() -> bool:
    """Check whether ChromaDB can be initialized."""
    try:
        get_chroma_client()
        return True
    except Exception:
        return False
