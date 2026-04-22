"""
Embedding generation — ported from vector-search MVP (04_generate_embeddings.py).

Provides embed_text() for single-text embedding, used when indexing a CV.
"""

from typing import Optional

from .settings import (
    OPENAI_API_KEY, EMBEDDING_MODEL, EMBEDDING_DIMENSIONS,
    EMBEDDING_MODE, LOCAL_EMBEDDING_MODEL, LOCAL_EMBEDDING_DIMENSIONS,
)


def embed_text(text: str) -> Optional[list[float]]:
    """Generate an embedding vector for a single text string."""
    if not text or not text.strip():
        return None

    use_openai = EMBEDDING_MODE == "openai" or (
        EMBEDDING_MODE == "auto" and OPENAI_API_KEY
    )

    if use_openai and OPENAI_API_KEY:
        try:
            from openai import OpenAI
            client = OpenAI(api_key=OPENAI_API_KEY)
            response = client.embeddings.create(
                model=EMBEDDING_MODEL,
                input=text.strip(),
            )
            return response.data[0].embedding
        except Exception as e:
            print(f"  OpenAI embedding failed: {e}")
            if EMBEDDING_MODE == "openai":
                return None

    if EMBEDDING_MODE in ("local", "auto"):
        try:
            from sentence_transformers import SentenceTransformer
            model = SentenceTransformer(LOCAL_EMBEDDING_MODEL)
            vector = model.encode([text.strip()], show_progress_bar=False)
            return vector[0].tolist()
        except Exception as e:
            print(f"  Local embedding failed: {e}")

    return None
