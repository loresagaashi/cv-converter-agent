import json
import os
from typing import Any, Dict, List

import requests


OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434/api/generate")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "llama3:8b")


def _ollama(prompt: str, *, model: str = OLLAMA_MODEL) -> str:
    """
    Minimal Ollama client, adapted from the original cv_converter project.

    Streams tokens from the Ollama HTTP API and concatenates them into a single
    string response.
    """
    response = requests.post(
        OLLAMA_URL,
        json={"model": model, "prompt": prompt},
        stream=True,
        timeout=300,
    )
    response.raise_for_status()

    full_out = ""
    for line in response.iter_lines():
        if not line:
            continue
        try:
            data = json.loads(line.decode("utf-8"))
        except json.JSONDecodeError:
            continue
        full_out += data.get("response", "")
    return full_out


def _extract_first_json_object(raw: str) -> Dict[str, Any]:
    """
    Helper to extract the first JSON object from a raw LLM string response.

    If extraction fails, returns an empty dict.
    """
    try:
        start = raw.index("{")
        end = raw.rindex("}") + 1
        json_str = raw[start:end]
        return json.loads(json_str)
    except Exception:
        return {}


def _build_competence_prompt(cv_text: str) -> str:
    """
    Build a compact prompt that asks the LLM for:
    - a competence summary (third-person, professional)
    - a flat list of extracted skills

    The model is instructed to return a single JSON object so it can be parsed
    robustly by the caller.
    """
    return f"""
You are an AI CV Converter specialized in generating competence summaries.

TASK:
- Analyze the following CV text.
- Write a detailed third-person competence summary of the candidate.
- Extract a comprehensive list of skills, tools, technologies, and soft skills.

OUTPUT FORMAT (JSON ONLY, NO MARKDOWN, NO EXTRA TEXT):
{{
  "competence_summary": "Long, detailed, third-person summary of the candidate's competencies, scope of experience, and typical responsibilities.",
  "skills": [
    "Skill or technology 1",
    "Skill or technology 2"
  ]
}}

RULES:
- Always write in third person (\"She\", \"He\", or \"They\").
- Do not invent facts that are not supported by the CV text.
- The "skills" list must be flat (no nested objects) and deduplicated.
- Return exactly ONE JSON object and nothing else.

CV TEXT:
{cv_text}
""".strip()


def generate_competence_cv(cv_text: str) -> Dict[str, object]:
    """
    Call the LLaMA model with the given CV text and return:

    - competence_summary: str
    - skills: List[str]
    """
    if not cv_text or not cv_text.strip():
        return {"competence_summary": "", "skills": []}

    prompt = _build_competence_prompt(cv_text)
    try:
        raw = _ollama(prompt)
    except Exception:
        # If the LLM backend is unavailable, degrade gracefully instead of
        # surfacing a 500 to the client.
        return {"competence_summary": "", "skills": []}

    # Attempt to extract the first JSON object from the response.
    data: Dict[str, Any] = _extract_first_json_object(raw)
    if not data:
        # Fallback: treat the whole response as a free-form summary.
        data = {}

    summary = data.get("competence_summary") or raw.strip()
    skills = data.get("skills") or []

    if not isinstance(skills, list):
        skills = []

    # Normalize skills to a list of non-empty strings
    normalized_skills: List[str] = []
    for s in skills:
        if isinstance(s, str):
            s_clean = s.strip()
            if s_clean:
                normalized_skills.append(s_clean)

    return {
        "competence_summary": str(summary).strip(),
        "skills": normalized_skills,
    }


# ---------------------------------------------------------------------------
# Structured CV generation (for formatted PDF output)
# ---------------------------------------------------------------------------

_STRUCTURED_CV_SCHEMA_EXAMPLE: Dict[str, Any] = {
    "profile": "Short professional summary...",
    "languages": [
        {"name": "English", "level": "C1"},
        {"name": "Albanian", "level": "C2"},
    ],
    "skills": ["Python", "TypeScript", "React", "SCRUM", "Kanban"],
    "work_experience": [
        {
            "from": "2025-02",
            "to": "Present",
            "title": "Product Owner",
            "company": "Company Name",
            "location": "City",
            "bullets": [
                "Achievement or responsibility",
                "Another responsibility",
            ],
        }
    ],
    "education": [
        {
            "from": "2021-09",
            "to": "2024-06",
            "degree": "BSc – Business Information Technology",
            "institution": "University Name",
        }
    ],
    "courses": ["Course or certification description"],
}


def _build_structured_cv_prompt(cv_text: str) -> str:
    """
    Prompt for generating a normalized CV JSON that will be used to render a
    formatted PDF (Ajlla-style template).
    """
    example_json = json.dumps(_STRUCTURED_CV_SCHEMA_EXAMPLE, indent=2)
    return f"""
You are an AI CV formatter.

TASK:
- Read the following raw CV text.
- Extract the candidate's professional competence summary and skills.
- Map them into the JSON schema shown below so the result can be rendered
  directly into a formatted CV PDF.

JSON SCHEMA EXAMPLE (THIS IS A FORMAT EXAMPLE, NOT REAL DATA):
{example_json}

REQUIREMENTS:
- You MUST NOT return an empty profile if the CV contains any competence-
  related information (experience, responsibilities, achievements, etc.).
- You MUST NOT return an empty skills list if the CV clearly lists skills,
  tools, technologies, or methodologies.
- Only use information that is clearly present in the CV text.
- Do NOT invent additional jobs, education entries, dates, or skills.
- Do NOT copy text verbatim; rewrite it so it sounds polished, concise, and
  professional, in a neutral or third-person tone (no "I", "my").
- Dates must be human-readable in the form "YYYY-MM" or "Present".
- If a section is missing in the CV, use an empty string or empty list for it.
  - Example: "profile": "" if no clear profile/summary is available.
  - Example: "courses": [] if no courses are mentioned.
- The "languages" field must be a list of objects with keys "name" and "level".
- The "skills" list must be flat (no nested structures).
- The "work_experience" and "education" lists must contain objects following
  the example schema.

OUTPUT FORMAT:
- Return exactly ONE JSON object.
- Do NOT include any markdown, comments, or additional text.

CV TEXT:
{cv_text}
""".strip()


def _simple_structured_cv_from_text(cv_text: str) -> Dict[str, Any]:
    """
    Heuristic fallback used when the LLM backend is unavailable.

    - Builds a short profile from the first non-empty lines.
    - Attempts to extract a flat skills list from a "Skills" section or
      comma-separated lines.
    """
    lines = [line.strip() for line in cv_text.splitlines()]
    non_empty = [line for line in lines if line]

    # Profile: join first 2–3 non-empty lines, truncated.
    profile_source = " ".join(non_empty[:3])
    profile = profile_source[:600].strip()

    # Skills: look for a section starting with "skills" and grab following lines
    # until the next blank line. Fallback to any line with many commas.
    skills: List[str] = []

    # 1) Explicit "skills" heading
    idx_skills = next(
        (i for i, l in enumerate(lines) if "skills" in l.lower()), None  # type: ignore[arg-type]
    )
    skill_lines: List[str] = []
    if idx_skills is not None:
        for l in lines[idx_skills + 1 :]:
            if not l.strip():
                break
            skill_lines.append(l)
    else:
        # 2) Fallback: any line with multiple commas is likely a skill list
        for l in lines:
            if l.count(",") >= 3:
                skill_lines.append(l)

    raw_tokens: List[str] = []
    separators = [",", ";", "/", "|"]
    for l in skill_lines:
        token_line = l
        for sep in separators[1:]:
            token_line = token_line.replace(sep, separators[0])
        raw_tokens.extend(token_line.split(separators[0]))

    seen = set()
    for token in raw_tokens:
        t = token.strip()
        if len(t) < 2:
            continue
        key = t.lower()
        if key in seen:
            continue
        seen.add(key)
        skills.append(t)

    return {
        "profile": profile,
        "languages": [],  # heuristics omitted for fallback
        "skills": skills,
        "work_experience": [],
        "education": [],
        "courses": [],
    }


def generate_structured_cv(cv_text: str) -> Dict[str, Any]:
    """
    Generate a normalized structured CV representation suitable for feeding
    into the PDF renderer.

    The returned dict follows (approximately) the `_STRUCTURED_CV_SCHEMA_EXAMPLE`
    shape. Missing sections are represented as empty strings/lists.
    """
    if not cv_text or not cv_text.strip():
        return {
            "profile": "",
            "languages": [],
            "skills": [],
            "work_experience": [],
            "education": [],
            "courses": [],
        }

    prompt = _build_structured_cv_prompt(cv_text)
    try:
        raw = _ollama(prompt)
        data = _extract_first_json_object(raw)
    except Exception:
        # If the LLM backend is unavailable or times out, fall back to a
        # heuristic parser so the formatted CV is not blank.
        return _simple_structured_cv_from_text(cv_text)


    if not isinstance(data, dict):
        # Fallback to an empty, but correctly shaped, structure.
        return {
            "profile": "",
            "languages": [],
            "skills": [],
            "work_experience": [],
            "education": [],
            "courses": [],
        }

    # Normalize keys and types defensively.
    profile = str(data.get("profile") or "").strip()
    languages = data.get("languages") or []
    skills = data.get("skills") or []
    work_experience = data.get("work_experience") or []
    education = data.get("education") or []
    courses = data.get("courses") or []

    if not isinstance(languages, list):
        languages = []
    if not isinstance(skills, list):
        skills = []
    if not isinstance(work_experience, list):
        work_experience = []
    if not isinstance(education, list):
        education = []
    if not isinstance(courses, list):
        courses = []

    # Ensure skills are a flat list of strings.
    normalized_skills: List[str] = []
    for s in skills:
        if isinstance(s, str):
            s_clean = s.strip()
            if s_clean:
                normalized_skills.append(s_clean)

    # If both profile and skills are still empty, apply the heuristic fallback.
    if not profile and not normalized_skills:
        return _simple_structured_cv_from_text(cv_text)

    return {
        "profile": profile,
        "languages": languages,
        "skills": normalized_skills,
        "work_experience": work_experience,
        "education": education,
        "courses": courses,
    }


