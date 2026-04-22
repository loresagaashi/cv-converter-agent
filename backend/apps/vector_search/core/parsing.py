"""
Text parsing utilities — ported from vector-search MVP (03_parsing_pipeline.py).

Provides clean_text() and build_embedding_text() for preparing CV text
before embedding.
"""

import re
from collections import Counter


def clean_text(raw: str) -> str:
    """Basic text cleanup: removes noise, normalizes whitespace."""
    if not raw:
        return ""

    text = raw
    text = re.sub(r'\n{3,}', '\n\n', text)
    text = re.sub(r'[ \t]{2,}', ' ', text)
    text = re.sub(r'Page \d+ of \d+', '', text)
    text = re.sub(r'\x0c', '', text)

    lines = text.split('\n')
    if len(lines) > 20:
        line_counts = Counter(line.strip() for line in lines if line.strip())
        repeated = {line for line, count in line_counts.items() if count >= 3 and len(line) < 80}
        lines = [line for line in lines if line.strip() not in repeated]
        text = '\n'.join(lines)

    text = re.sub(r'https?://\S+', '', text)
    text = text.replace('\u2018', "'").replace('\u2019', "'")
    text = text.replace('\u201c', '"').replace('\u201d', '"')
    text = text.replace('\u2013', '-').replace('\u2014', '-')
    text = text.strip()

    return text


def build_embedding_text(cv_text: str, name: str = "", title: str = "") -> str:
    """
    Build a dense embedding-ready text from a CV's extracted text.
    Prepends name/title context if available.
    """
    cleaned = clean_text(cv_text)
    if not cleaned:
        return ""

    parts = []
    if name:
        parts.append(f"{name}.")
    if title:
        parts.append(f"Current role: {title}.")
    # Use the first ~3000 chars of the cleaned CV text as the embedding input
    parts.append(cleaned[:3000])

    return " ".join(parts)
