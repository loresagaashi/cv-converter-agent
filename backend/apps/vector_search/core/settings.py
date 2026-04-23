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

ALLOW_DUMMY_EMBEDDINGS = os.environ.get("ALLOW_DUMMY_EMBEDDINGS", "0") == "1"

_mode = os.environ.get("EMBEDDING_MODE", "openai").lower()
EMBEDDING_MODE = _mode if _mode in ("openai", "local", "auto") else "openai"

TOP_K_RESULTS = 5
SIMILARITY_THRESHOLD = 0.60

COMPOSITE_WEIGHTS = {
    "skill_coverage": 0.45,
    "vector_similarity": 0.35,
    "competency_fit": 0.15,
    "tier_bonus": 0.05,
}
