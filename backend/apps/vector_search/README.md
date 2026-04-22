# Vector Search Module

Resume ↔ job description matching powered by vector similarity (pgvector + OpenAI embeddings) and smart scoring.

## What It Does

1. **Indexes CVs** — Extracts text from uploaded CVs, generates OpenAI embeddings, and stores them in a pgvector-enabled Postgres table (`cv_embeddings`).
2. **Matches candidates** — Given a job description, parses it with GPT, generates an embedding, and performs tiered fallback search across indexed CVs.
3. **Scores candidates** — Blends vector similarity, exact skill overlap, seniority/competency inference, and tier bonuses into a composite score.
4. **Gap analysis** — Optionally generates AI-powered natural-language screening notes explaining fit, gaps, and recommendations.

## API Surface

All endpoints require JWT authentication. Base path: `/api/vector-search/`

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/index/` | Index a single CV. Body: `{ "cv_id": 123 }` |
| `POST` | `/index/bulk/` | Bulk-index. Body: `{ "all": true }` or `{ "cv_ids": [1,2,3] }` |
| `POST` | `/match/` | Search for candidates. Body: `{ "job_description": "...", "top_k": 5, "include_gap_analysis": true }` |
| `GET` | `/status/` | Index health: `{ "indexed_count", "total_cvs", "vector_db_ready" }` |
| `DELETE` | `/index/<cv_id>/` | Remove a CV from the vector index |

## One-Time Backfill

To index all existing CVs that have extracted text:

```bash
cd backend
python manage.py shell -c "
from apps.vector_search.services import bulk_index_cvs
result = bulk_index_cvs()
print(result)
"
```

## Running Tests

```bash
cd backend
python -m pytest apps/vector_search/tests/ -v
```

## Architecture

```
apps/vector_search/
├── core/                  # Ported matching engine
│   ├── settings.py        # Config from env vars
│   ├── smart_matcher.py   # Tiered search + scoring
│   ├── search.py          # JD parsing + search orchestration
│   ├── gap_analysis.py    # AI screening notes
│   ├── embeddings.py      # OpenAI embedding wrapper
│   ├── parsing.py         # Text cleanup
│   └── vector_db.py       # pgvector operations (upsert, query, delete)
├── models.py              # CvEmbedding Django model (pgvector)
├── services.py            # Django-aware orchestration layer
├── views.py               # DRF API views
├── serializers.py         # Request validation
└── urls.py                # Route definitions
```

## Configuration

Uses existing environment variables from `backend/.env`:

- `OPENAI_API_KEY` — Required for embeddings and JD parsing
- `OPENAI_RECRUITER_MODEL` — LLM model for JD parsing (default: `gpt-4o-mini`)
- `EMBEDDING_MODE` — `openai` (default), `local`, or `auto`
