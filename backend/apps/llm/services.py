import json
import logging
import os
import time
from typing import Any, Dict, List

import requests


# Basic logger for runtime visibility during backend calls.
logger = logging.getLogger(__name__)

# Use Ollama Cloud host by default; can be overridden with OLLAMA_URL.
OLLAMA_URL = os.environ.get("OLLAMA_URL", "https://ollama.com/api/generate")
# Default cloud model as requested.
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "gpt-oss:120b-cloud")
# API key must come from env; no hardcoded fallback.
OLLAMA_API_KEY = os.environ.get("OLLAMA_API_KEY", "")


def _ollama(prompt: str, *, model: str = OLLAMA_MODEL) -> str:
    """
    Minimal Ollama client, adapted from the original cv_converter project.

    Streams tokens from the Ollama HTTP API and concatenates them into a single
    string response.
    """
    headers = {}
    if OLLAMA_API_KEY:
        headers["Authorization"] = f"Bearer {OLLAMA_API_KEY}"

    start = time.monotonic()
    logger.info("Calling Ollama", extra={"model": model, "url": OLLAMA_URL})
    print(f"[LLM] start model={model} url={OLLAMA_URL}")

    response = requests.post(
        OLLAMA_URL,
        json={"model": model, "prompt": prompt},
        headers=headers,
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

    elapsed = time.monotonic() - start
    logger.info(
        "Ollama call completed",
        extra={"model": model, "url": OLLAMA_URL, "chars": len(full_out), "seconds": round(elapsed, 3)},
    )
    print(
        f"[LLM] done model={model} url={OLLAMA_URL} seconds={elapsed:.3f} chars={len(full_out)}"
    )
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
        Very concise competence summary prompt.
    """
    return f"""
You are an AI CV Converter specialized in generating competence summaries.

TASK:
- Analyze the CV text and write a VERY CONCISE third-person competence summary.
- Start with the candidate's full name (from the CV) and use gender-neutral phrasing (repeat the name or "They").
- Summary must be at most 3 sentences total (1-2 lines each) covering: experience/projects together; education/certifications together; key competencies/skills.
- Extract a comprehensive list of skills, tools, technologies, and soft skills.

IMPORTANT: Keep it brief; do NOT miss major info, but compress into max 3 sentences.

OUTPUT FORMAT (JSON ONLY, NO MARKDOWN, NO EXTRA TEXT):
{{
    "competence_summary": "Max 3 sentences, third-person, very concise.",
  "skills": [
    "Skill or technology 1",
    "Skill or technology 2"
  ]
}}

RULES:
- Always write in third person; start with the candidate's name and use gender-neutral references (repeat the name or "They").
- Do not invent facts that are not supported by the CV text.
- Be EXTREMELY concise (max 3 sentences total) while mentioning experience/projects, education/certifications, and key competencies.
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
    "certifications": ["Certification or credential"],
    "education": [
        {
            "from": "2021-09",
            "to": "2024-06",
            "degree": "BSc – Business Information Technology",
            "institution": "University Name",
        }
    ],
    "projects": [
        {
            "from": "2025-02",
            "to": "Present",
            "title": "Project Name",
            "company": "Personal Project",
            "location": "Remote",
            "bullets": [
                "Outcome or responsibility",
                "Tech stack or impact",
            ],
        }
    ],
    "skills": ["Python", "TypeScript", "React", "SCRUM", "Kanban"],
    "courses": ["Course description"],
    "languages": [
        {"name": "English", "level": "C1"},
        {"name": "Albanian", "level": "C2"},
    ],
}


def _build_skill_grouping_prompt(skills: List[str]) -> str:
        """
        Prompt to group a flat skills list into up to 5 human-readable categories, each with up to 5 skills.

        The model should not invent new skills; it should only reorganize and label the input list.
        """
        skills_str = ", ".join(sorted(set(s.strip() for s in skills if s.strip())))
        return f"""
You are an AI assistant that groups technical skills into high-level competence areas.

TASK:
- Take the provided flat list of skills and group them into at most 5 meaningful categories.
- Each category name should be short and human-readable (e.g. "Backend Development", "Frontend & UI", "Cloud & DevOps").
- Assign each input skill to exactly one category that best fits it.
- Do not invent or add skills that are not in the input list.
- Merge near-duplicates (e.g. "React" and "React.js") under the same category.
- Each category MUST have at most 5 skills. If there are more, keep only the most important/relevant ones.

OUTPUT FORMAT (JSON ONLY, NO MARKDOWN, NO EXTRA TEXT):
{{
    "groups": [
        {{
            "name": "Category name 1",
            "skills": ["skill from input 1", "skill from input 2"]
        }},
        {{
            "name": "Category name 2",
            "skills": ["skill from input 3"]
        }}
    ]
}}

RULES:
- The top-level JSON object MUST contain exactly one key: "groups".
- "groups" MUST be a list with at most 5 items.
- Each "skills" list MUST contain only skills from the input list (no made up skills) and have at most 5 items.
- Return exactly ONE JSON object and nothing else.

INPUT SKILLS:
{skills_str}
""".strip()


def group_skills_into_categories(skills: List[str]) -> Dict[str, List[str]]:
    """
    Use the LLM to group a flat list of skills into at most 5 named categories, each with at most 5 skills.

    Returns a mapping: {category_name: [skill, ...], ...}
    On any error, returns an empty dict.
    """
    # Normalize and deduplicate early.
    clean_skills = [s.strip() for s in skills if isinstance(s, str) and s.strip()]
    seen = set()
    unique_skills: List[str] = []
    for s in clean_skills:
        key = s.lower()
        if key in seen:
            continue
        seen.add(key)
        unique_skills.append(s)

    if not unique_skills:
        return {}

    prompt = _build_skill_grouping_prompt(unique_skills)
    try:
        raw = _ollama(prompt)
    except Exception:
        return {}

    data = _extract_first_json_object(raw)
    if not isinstance(data, dict):
        return {}

    groups_raw = data.get("groups") or []
    if not isinstance(groups_raw, list):
        return {}

    grouped: Dict[str, List[str]] = {}
    # Enforce max 5 groups, each with max 5 skills, defensively.
    for group in groups_raw[:5]:
        if not isinstance(group, dict):
            continue
        name = str(group.get("name") or "").strip()
        if not name:
            continue
        skills_list = group.get("skills") or []
        if not isinstance(skills_list, list):
            continue
        final_skills: List[str] = []
        for s in skills_list[:5]:
            if not isinstance(s, str):
                continue
            s_clean = s.strip()
            if not s_clean:
                continue
            # Only keep skills that were in the original list (case-insensitive).
            if s_clean.lower() not in seen:
                continue
            final_skills.append(s_clean)
        if final_skills:
            grouped[name] = final_skills

    return grouped


def _build_structured_cv_prompt(cv_text: str) -> str:
    """
    Prompt for generating a normalized CV JSON that will be used to render a
    formatted PDF (Ajlla-style template).
    """
    example_json = json.dumps(_STRUCTURED_CV_SCHEMA_EXAMPLE, indent=2)
    return f"""
You are an AI CV formatter.

TASK:
- Read the raw CV text carefully and extract ALL information.
- Build a profile that merges the "About me"/header statement with key personal info (name, location/country if present) in **2-3 sentences max**.
- Extract ALL work experience entries (jobs, internships, contracts) with **2-3 sentences total** and bullets that are **1 line each**.
- Extract ALL certifications as their own list (1 line each entry) and place them after work_experience.
- Extract ALL education items (degrees, diplomas) with **1-2 sentences**.
- Extract ALL projects as their own list (do NOT merge into work_experience); include project name, context (e.g., Personal Project, client), dates, and **1-line bullets**, max **2-3 sentences total** per project.
- Extract a flat skills list (no nesting).
- Extract ALL courses as their own list (1 line each entry).
- Keep languages if present and place them last in the JSON order.
- Map everything into the JSON schema below so it can render directly into a formatted CV PDF.

JSON SCHEMA EXAMPLE (THIS IS A FORMAT EXAMPLE, NOT REAL DATA):
{example_json}

REQUIREMENTS:
- Order keys exactly as: profile, work_experience, certifications, education, projects, skills, courses, languages (languages last).
- NEVER leave profile empty if any info exists; include the header/about in 2-3 sentences max with name and (if present) location/country.
- Skills list must not be empty if skills are present in text.
- Do NOT miss any sections: all work experience, all projects, all education, all certifications/courses, all languages.
- Projects stay in "projects" (not work_experience). Use company/context "Personal Project" if missing.
- Keep every major section short: profile 2-3 sentences; each work_experience and project entry max 2-3 sentences (bullets 1 line each); education/certifications/courses entries 1-2 sentences.
- Only use information present in CV; do not invent entries or dates.
- Rewrite concisely and professionally (neutral/third-person, no "I").
- Dates must be "YYYY-MM" or "Present".
- The "skills" list must be flat (no nested structures).
- The "work_experience", "education", and "projects" lists must follow the example schema.

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

    # Static skill grouping is now handled in pdf_renderer.py (no AI call needed)
    skills_grouped: Dict[str, List[str]] = {}

    return {
        "profile": profile,
        "languages": [],  # heuristics omitted for fallback
        "skills": skills,
        "skills_grouped": skills_grouped,
        "work_experience": [],
        "education": [],
        "projects": [],
        "courses": [],
        "certifications": [],
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
            "skills_grouped": {},
            "work_experience": [],
            "education": [],
            "projects": [],
            "courses": [],
            "certifications": [],
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
            "skills_grouped": {},
            "work_experience": [],
            "education": [],
            "projects": [],
            "courses": [],
            "certifications": [],
        }

    # Normalize keys and types defensively.
    profile = str(data.get("profile") or "").strip()
    languages = data.get("languages") or []
    skills = data.get("skills") or []
    work_experience = data.get("work_experience") or []
    education = data.get("education") or []
    projects = data.get("projects") or []
    courses = data.get("courses") or []
    certifications = data.get("certifications") or []

    if not isinstance(languages, list):
        languages = []
    if not isinstance(skills, list):
        skills = []
    if not isinstance(work_experience, list):
        work_experience = []
    if not isinstance(education, list):
        education = []
    if not isinstance(projects, list):
        projects = []
    if not isinstance(courses, list):
        courses = []
    if not isinstance(certifications, list):
        certifications = []

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

    # Static skill grouping is now handled in pdf_renderer.py (no AI call needed)
    # This avoids extra LLM calls during preview for better performance
    skills_grouped: Dict[str, List[str]] = {}

    return {
        "profile": profile,
        "languages": languages,
        "skills": normalized_skills,
        "skills_grouped": skills_grouped,  # Empty; pdf_renderer handles static grouping
        "work_experience": work_experience,
        "education": education,
        "projects": projects,
        "courses": courses,
        "certifications": certifications,
    }


