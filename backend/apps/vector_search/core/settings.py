"""
Vector Search settings — reads from environment variables.
No separate .env loader; reuses the project-wide backend/.env via Django's settings.
"""

import os


OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")

EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIMENSIONS = 1536
LLM_MODEL = os.environ.get("OPENAI_RECRUITER_MODEL", "gpt-4o-mini")

LOCAL_EMBEDDING_MODEL = "all-MiniLM-L6-v2"
LOCAL_EMBEDDING_DIMENSIONS = 384

CHROMA_COLLECTION_RESUMES = "employee_resumes"

ALLOW_DUMMY_EMBEDDINGS = os.environ.get("ALLOW_DUMMY_EMBEDDINGS", "0") == "1"

_mode = os.environ.get("EMBEDDING_MODE", "openai").lower()
EMBEDDING_MODE = _mode if _mode in ("openai", "local", "auto") else "openai"

TOP_K_RESULTS = 5
SIMILARITY_THRESHOLD = 0.60

COMPOSITE_WEIGHTS = {
    "vector_similarity": 0.50,
    "skill_coverage": 0.25,
    "competency_fit": 0.15,
    "tier_bonus": 0.10,
}


def get_chroma_dir():
    """Return the ChromaDB persistent storage path."""
    from pathlib import Path
    return Path(__file__).resolve().parent.parent / "chroma_store"
