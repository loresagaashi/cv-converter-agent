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

# OpenAI config for recruiter assistant (gpt-4o-mini).
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions"
OPENAI_RECRUITER_MODEL = os.environ.get("OPENAI_RECRUITER_MODEL", "gpt-4o-mini")


# ---------------------------------------------------------------------------
# Recruiter voice assistant prompt (for realtime or chat usage)
# ---------------------------------------------------------------------------

RECRUITER_ASSISTANT_SYSTEM_PROMPT = """
AI Interview Assistant Prompt

You are an AI assistant helping a recruiter confirm and validate a candidate’s skills and experience during a voice-only conversation.

⚠️ Source of truth:
You MUST use ONLY the competence paper as the source of skills, technologies, experience, and items to ask about.

Do NOT extract skills from the CV.

Do NOT infer, assume, or add items.

Do NOT invent or merge skills from any other source.

Your role is confirmation only, not interviewing or evaluation.

Core Objective

Confirm whether the skills and information listed in the competence paper are accurate and reflect real work by the candidate.

Ask only high-level confirmation questions (e.g., “Is this correct?”, “Has the candidate worked with this?”).

Do NOT ask technical, detailed, or “how/why” questions.

Conversation Style

Professional, friendly, neutral tone

Short, spoken-friendly sentences

One question per turn

Never repeat a question

Never wait indefinitely

Always move forward after a response

Section Order (STRICT — no skipping, no returning)

Core Skills

Soft Skills

Languages

Education

Trainings & Certifications

Technical Competencies

Project Experience

Overall / Additional Skills

Recommendation

Item Handling Rules (CRITICAL)

For each item listed in the competence paper (EXCEPT soft skills):

- Always refer to the specific item by name in the question (e.g., the exact training title,
  certification name, project name, role title, or skill as written). Do NOT ask generic questions
  like "Was this training completed?" without naming the training.

- Ask one simple confirmation question

- Treat any recruiter response as final input

- Immediately mark the item as DONE and move on

Soft Skills SPECIAL RULE:

- You MUST NOT ask individual questions for each soft skill in the Soft Skills section.
- When the current section is soft_skills, you should internally mark the section as completed
  and advance to the next section (languages) without emitting any soft-skills-specific question.
- Later, in the Overall / Additional Skills section, you MUST ask exactly one combined question
  that confirms all soft skills and general traits together (see example below).

Allowed outcomes:

Confirmed → item done

Not confirmed → item done

Unclear → item still done (do NOT retry)

🚫 You MUST NOT:

Ask technical or detailed questions

Ask follow-ups by default

Ask about the same item twice

Rephrase or retry a question

Ask about items not present in the competence paper

Once an item is mentioned in a question, it is locked and completed permanently.

Section Completion (MANDATORY)

When all items in the current section are covered:

Set "complete_section": true

Automatically continue to the next section

Never return to a completed section

Question Examples (Confirmation-Only)

Core Skills

“The competence paper lists Java. Is it correct that the candidate has worked with this?”

Soft Skills

“(No individual questions for each soft skill; this section is confirmed later in a single combined question.)”

Languages

“English is listed at C1 level. Is this accurate for professional use?”

Education

“Is the listed degree completed and correct?”

Trainings & Certifications

“The competence paper lists the training ‘AWS Cloud Practitioner’. Was this training completed and relevant to the candidate’s work?”

Technical Competencies

“Has the candidate worked with Spring Boot as listed?”

Project Experience

“The competence paper mentions the project ‘Customer Portal Redesign’ at Company X. Did the candidate actively contribute to this project?”

Overall / Additional Skills

“The competence paper mentions a strong sense of ownership and teamwork. Does this accurately reflect the candidate overall, and is there anything important missing?”

Recommendation

“Based on this competence paper, what type of role would you recommend for this candidate?”

Introduction (Recruiter-Facing)

“Hello. I’ll ask a few short questions to confirm whether the information listed in the competence paper is accurate.”

Pause briefly, then continue automatically.

JSON OUTPUT ONLY
{
  "question": "The next short confirmation question, or empty string if finished",
  "section": "introduction | core_skills | soft_skills | languages | education | trainings_certifications | technical_competencies | project_experience | overall | recommendation",
  "complete_section": true or false,
  "done": true or false
}

JSON RULES (STRICT)

"question" MUST NOT be empty while "done" is false

"complete_section" MUST be true only when all items in that section are covered

"done" MUST be true ONLY after:

All sections are completed, AND

The recommendation question is asked

No repeated questions

No loops

Always progress forward
""".strip()


def classify_recruiter_answer(
    question_text: str,
    answer_text: str,
    section: str,
) -> Dict[str, Any]:
    """
    Classify a single recruiter answer for a given question/section.

    Returns a small dict with:
    - status: "confirmed" | "partially_confirmed" | "not_confirmed" | "new_skill"
    - confidence_level: "high" | "medium" | "low"
    - extracted_skills: List[str]
    - notes: str (optional explanation)

    If OpenAI is not configured or the call fails, we fall back to a very
    simple heuristic based on yes/no style answers.
    """
    question = (question_text or "").strip()
    answer = (answer_text or "").strip()
    section_key = (section or "").strip().lower()

    # Basic fallback if no answer is present at all.
    if not answer:
        return {
            "status": "not_confirmed",
            "confidence_level": "low",
            "extracted_skills": [],
            "notes": "Empty or missing answer.",
        }

    # If OpenAI is not available, use rule-based heuristics.
    if not OPENAI_API_KEY:
        lowered = answer.lower()
        status = "partially_confirmed"
        if any(x in lowered for x in ["no", "not really", "don't think so", "do not think so"]):
            status = "not_confirmed"
        elif any(x in lowered for x in ["yes", "yeah", "yep", "they do", "they have", "correct"]):
            status = "confirmed"

        # For discovery/overall sections, treat any non-empty answer as new_skill.
        if section_key in {"overall"}:
            status = "new_skill"

        return {
            "status": status,
            "confidence_level": "medium",
            "extracted_skills": [],
            "notes": "Rule-based classification (no OpenAI API).",
        }

    system_prompt = """
You are an assistant that classifies recruiter answers about a candidate's CV.

You must return a single JSON object with:
- "status": one of "confirmed", "partially_confirmed", "not_confirmed", "new_skill"
- "confidence_level": one of "high", "medium", "low"
- "extracted_skills": a list of short strings for any concrete skills, tools, technologies, or competencies mentioned
- "notes": short free-text justification

Use "new_skill" when the recruiter clearly adds information that was not explicitly in the original CV/competence paper or when the section is for additional/discovery information.
Return JSON only.
""".strip()

    user_payload: Dict[str, Any] = {
        "question": question,
        "answer": answer,
        "section": section_key,
    }

    try:
        resp = requests.post(
            OPENAI_CHAT_COMPLETIONS_URL,
            headers={
                "Authorization": f"Bearer {OPENAI_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": OPENAI_RECRUITER_MODEL,
                "temperature": 0.1,
                "response_format": {"type": "json_object"},
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {
                        "role": "user",
                        "content": json.dumps(user_payload, ensure_ascii=False),
                    },
                ],
            },
            timeout=60,
        )
        resp.raise_for_status()
        data = resp.json()
        content_raw = data["choices"][0]["message"]["content"]
        parsed = json.loads(content_raw)
    except Exception:
        # On any error, fall back to heuristic classification.
        lowered = answer.lower()
        status = "partially_confirmed"
        if any(x in lowered for x in ["no", "not really", "don't think so", "do not think so"]):
            status = "not_confirmed"
        elif any(x in lowered for x in ["yes", "yeah", "yep", "they do", "they have", "correct"]):
            status = "confirmed"
        if section_key in {"overall"}:
            status = "new_skill"

        return {
            "status": status,
            "confidence_level": "medium",
            "extracted_skills": [],
            "notes": "Heuristic classification after OpenAI failure.",
        }

    status = str(parsed.get("status") or "").strip() or "partially_confirmed"
    if status not in {"confirmed", "partially_confirmed", "not_confirmed", "new_skill"}:
        status = "partially_confirmed"

    confidence = str(parsed.get("confidence_level") or "").strip().lower()
    if confidence not in {"high", "medium", "low"}:
        confidence = "medium"

    extracted = parsed.get("extracted_skills") or []
    if not isinstance(extracted, list):
        extracted = []
    cleaned_skills: List[str] = []
    for s in extracted:
        if isinstance(s, str):
            s_clean = s.strip()
            if s_clean:
                cleaned_skills.append(s_clean)

    notes = str(parsed.get("notes") or "").strip()

    # For discovery/overall sections, bias status towards new_skill if we have
    # at least one extracted skill.
    if section_key in {"overall"} and cleaned_skills and status != "not_confirmed":
        status = "new_skill"

    return {
        "status": status,
        "confidence_level": confidence,
        "extracted_skills": cleaned_skills,
        "notes": notes,
    }


def generate_recruiter_next_question(
    cv_text: str,
    competence_text: str,
    history: List[Dict[str, str]],
    section: str,
) -> Dict[str, Any]:
    """
    Use gpt-4o-mini to drive the recruiter verification flow.

    The model receives:
    - The raw CV text (sole source of truth about the CV).
    - The competence letter text (exported summary with structured fields).
    - A list of prior exchanges between assistant and recruiter.
    - The current logical section (e.g., core_skills, professional_experience, training_certifications, etc.).

    Returns a small JSON object:
    - question: the next short spoken question.
    - section: the (possibly updated) current section name.
    - complete_section: bool indicating whether this section is done.
    - done: bool indicating whether the entire verification flow is complete.
    """
    # Defensive fallback if OpenAI is not configured.
    if not OPENAI_API_KEY:
        return {
            "question": "",
            "section": section,
            "complete_section": True,
            "done": True,
        }

    # Normalize history into a safe, compact structure.
    safe_history: List[Dict[str, str]] = []
    for item in history or []:
        role = str(item.get("role", "")).strip().lower()
        content = str(item.get("content", "")).strip()
        if role not in ("assistant", "recruiter") or not content:
            continue
        safe_history.append({"role": role, "content": content})

    # The assistant is responsible for managing its own section progression,
    # but we still pass through the current section for context.
    user_payload: Dict[str, Any] = {
        "cv_text": cv_text or "",
        "competence_letter": competence_text or "",
        "current_section": section,
        "history": safe_history,
    }

    try:
        resp = requests.post(
            OPENAI_CHAT_COMPLETIONS_URL,
            headers={
                "Authorization": f"Bearer {OPENAI_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": OPENAI_RECRUITER_MODEL,
                "temperature": 0.2,
                "response_format": {"type": "json_object"},
                "messages": [
                    {"role": "system", "content": RECRUITER_ASSISTANT_SYSTEM_PROMPT},
                    {
                        "role": "user",
                        "content": json.dumps(user_payload, ensure_ascii=False),
                    },
                ],
            },
            timeout=60,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        # Fail gracefully – end the flow rather than erroring on the client.
        return {
            "question": "",
            "section": section,
            "complete_section": True,
            "done": True,
        }

    try:
        content_raw = data["choices"][0]["message"]["content"]
    except Exception:
        return {
            "question": "",
            "section": section,
            "complete_section": True,
            "done": True,
        }

    try:
        parsed = json.loads(content_raw)
    except Exception:
        parsed = {}

    question = str(parsed.get("question") or "").strip()
    next_section = str(parsed.get("section") or section).strip()
    complete_section = bool(parsed.get("complete_section"))
    done = bool(parsed.get("done"))

    # Server-side safety guardrails:
    # - Enforce strict section order progression.
    # - Never allow the flow to be marked done unless we're in the final "recommendation" section.
    # - Never treat an empty question as a normal intermediate step if more sections remain.

    section_order = [
        "introduction",
        "core_skills",
        "soft_skills",
        "languages",
        "education",
        "trainings_certifications",
        "technical_competencies",
        "project_experience",
        "overall",
        "recommendation",
    ]

    if section not in section_order:
        section = "core_skills"

    # If the model says the current section is complete, always advance
    # to the next section in our fixed order.
    if complete_section:
        try:
            idx = section_order.index(section)
        except ValueError:
            idx = 0
        if idx < len(section_order) - 1:
            next_section = section_order[idx + 1]
        else:
            next_section = "recommendation"

    # Do not allow "done" to be true outside the final recommendation section.
    if next_section != "recommendation":
        done = False

    # If the model failed to provide a question but we are not truly done yet,
    # synthesize a simple, section-specific question so the flow can continue.
    if not question and not done:
        fallback_by_section = {
            "core_skills": "Let’s talk about the candidate’s core skills. Which core skill from the competence paper would you like to confirm next?",
            "soft_skills": "Now let’s move to soft skills. Which soft skills from the competence paper should we confirm for this candidate?",
            "languages": "Let’s talk about languages. Which languages from the competence paper should we confirm for this candidate?",
            "education": "Now let’s move to education. Which degree or education entry from the competence paper should we confirm?",
            "trainings_certifications": "Let’s cover trainings and certifications. Which training or certification from the competence paper should we confirm?",
            "technical_competencies": "Now let’s move to technical competencies. Which tools or technologies from the competence paper should we confirm next?",
            "project_experience": "Let’s discuss project experience. Which project or role from the competence paper should we confirm now?",
            "overall": "Before we move to the recommendation, is there anything important about this candidate we haven’t covered yet?",
            "recommendation": "Based on everything we discussed, what type of role would you recommend for this candidate?",
        }

        question = fallback_by_section.get(next_section) or fallback_by_section.get(section, "")

        if question:
            # We keep complete_section/done as they were, but since done is False here,
            # this will produce one more turn in the current or next section.
            pass
        else:
            # No sensible fallback; terminate gracefully.
            complete_section = True
            done = True

    return {
        "question": question,
        "section": next_section or section,
        "complete_section": complete_section,
        "done": done,
    }


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
- Extract ALL work experience entries (jobs, internships, contracts). If descriptions/bullets exist in the original CV, you MUST REWRITE and SUMMARIZE them into concise bullets - rephrase the content in your own words, do NOT copy sentences directly from the source. Create **2-3 sentences total** with bullets that are **1 line each**. If no descriptions exist, include only the basic info (title, company, dates, location) with an empty bullets array. NEVER create or generate descriptions when the source has none.
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
- For work_experience entries: If descriptions/bullets exist in the original CV, you MUST REWRITE and SUMMARIZE them - rephrase the content in your own words, condense into concise bullets (do NOT copy sentences verbatim from the source). If a work experience entry has no description or bullets in the source text, leave the "bullets" array empty. NEVER generate, invent, or create descriptions when none are present in the source CV.
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


