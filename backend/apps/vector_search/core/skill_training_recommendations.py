"""
Skill Gap & Training Plan Generator
=====================================
For each missing required skill, estimates how long a *specific* candidate
would need to become job-ready, based on their existing skills, years of
experience, seniority, and known skill adjacencies.

Two paths:
  1. LLM path  — personalised estimates via OpenAI chat completions (JSON mode)
  2. Rule path — deterministic fallback when the API key is missing or the call fails
"""

import json
import re
from typing import Optional

from .settings import OPENAI_API_KEY, LLM_MODEL
from .smart_matcher import MatchCandidate, SENIORITY_LEVELS

# ── Skill adjacency map (bidirectional) ─────────────────────

_ADJACENCY_PAIRS: list[tuple[str, str]] = [
    # Cloud platforms
    ("aws", "google cloud"), ("aws", "microsoft azure"), ("google cloud", "microsoft azure"),
    # Containers / orchestration
    ("docker", "kubernetes"), ("docker", "container services"), ("kubernetes", "container services"),
    # Frontend frameworks
    ("react", "vue.js"), ("react", "angular"), ("vue.js", "angular"),
    ("react", "nextjs"), ("react", "react native"),
    # Backend / Python web
    ("django", "fastapi"), ("django", "flask"), ("fastapi", "flask"),
    ("express.js", "nestjs"), ("node.js", "express.js"), ("node.js", "nestjs"),
    # Languages
    ("python", "python data stack"), ("python", "python ai stack"),
    ("java", "spring boot"), ("c# .net", "asp.net core"),
    ("typescript", "javascript"),
    # Data / ML
    ("tensorflow", "pytorch"), ("machine learning basics", "machine learning fundamentals"),
    ("machine learning fundamentals", "deep learning"),
    ("natural language processing (nlp)", "deep learning"),
    ("etl pipelines", "data warehousing"), ("data modeling", "database design"),
    # Databases
    ("postgresql", "mysql"), ("postgresql", "sql server"), ("mysql", "sql server"),
    ("mongodb", "redis"),
    # CI/CD
    ("github actions", "gitlab ci"), ("github actions", "jenkins"), ("gitlab ci", "jenkins"),
    ("ci/cd pipelines", "github actions"), ("ci/cd pipelines", "gitlab ci"), ("ci/cd pipelines", "jenkins"),
    # Testing
    ("selenium", "cypress"), ("selenium", "playwright"), ("cypress", "playwright"),
    ("unit testing", "test automation"), ("integration testing", "test automation"),
    # DevOps / IaC
    ("infrastructure as code", "serverless"),
    # Design
    ("figma", "graphic design"),
    # Mobile
    ("android (kotlin)", "ios (swift)"), ("flutter", "react native"),
    # PM
    ("scrum framework", "kanban"), ("scrum framework", "agile methodology"),
    ("kanban", "agile methodology"),
    # BI
    ("power bi", "tableau"),
    # Security
    ("application security", "network security"), ("firewall management", "network security"),
    # CSS / styling
    ("css3", "tailwindcss"), ("css3", "bootstrap"), ("tailwindcss", "bootstrap"),
]

ADJACENCY_MAP: dict[str, set[str]] = {}
for _a, _b in _ADJACENCY_PAIRS:
    ADJACENCY_MAP.setdefault(_a, set()).add(_b)
    ADJACENCY_MAP.setdefault(_b, set()).add(_a)


# ── Experience estimation ────────────────────────────────────

def _estimate_experience_years(candidate: MatchCandidate) -> float:
    """Return a usable years-of-experience figure.

    When ``years_of_experience`` is 0 we approximate from the candidate's
    ``embedding_text`` by looking for date ranges, or fall back to a
    conservative seniority-based default.  Never hallucinated.
    """
    if candidate.years_of_experience and candidate.years_of_experience > 0:
        return candidate.years_of_experience

    text = (candidate.embedding_text or "").lower()
    year_matches = [int(y) for y in re.findall(r'\b(19[89]\d|20[0-2]\d)\b', text)]
    if len(year_matches) >= 2:
        span = max(year_matches) - min(year_matches)
        if 1 <= span <= 40:
            return float(span)

    seniority_defaults = {
        "junior": 1.0, "mid": 3.0, "senior": 6.0, "lead": 9.0,
        "principal": 13.0, "director": 16.0, "vp": 18.0, "c_level": 20.0,
    }
    return seniority_defaults.get(candidate.stated_seniority.lower(), 3.0)


# ── Rule-based fallback ─────────────────────────────────────

_BASE_WEEKS_PER_SKILL = 8


def _rule_based_estimate(
    missing_skill: str,
    candidate: MatchCandidate,
    experience_years: float,
) -> dict:
    """Produce a single-skill estimate using the adjacency map + experience."""
    skill_lower = missing_skill.lower()
    matched_lower = {s.lower() for s in candidate.skill_overlap.get("matched_required", [])}
    all_cand_skills_lower = matched_lower | {
        s.lower() for s in candidate.skill_overlap.get("matched_preferred", [])
    }

    has_adjacent = bool(ADJACENCY_MAP.get(skill_lower, set()) & all_cand_skills_lower)
    adjacent_names = sorted(ADJACENCY_MAP.get(skill_lower, set()) & all_cand_skills_lower)

    weeks = _BASE_WEEKS_PER_SKILL

    if has_adjacent:
        weeks = max(2, weeks // 2)

    if experience_years >= 8:
        weeks = max(1, int(weeks * 0.6))
    elif experience_years >= 5:
        weeks = max(1, int(weeks * 0.75))
    elif experience_years < 2:
        weeks = int(weeks * 1.3)

    if has_adjacent:
        reason = f"Already knows {', '.join(adjacent_names)} which are closely related."
        first_step = (
            f"Start a hands-on side project migrating a small "
            f"{adjacent_names[0]} workflow to {missing_skill}."
        )
    else:
        reason = "No closely related skill on their profile — will need a structured learning path."
        first_step = f"Complete an introductory course or certification for {missing_skill}."

    return {
        "skill": missing_skill,
        "estimated_weeks": weeks,
        "reason": reason,
        "first_step": first_step,
    }


def _rule_based_recommendations(
    candidate: MatchCandidate,
    parsed_jd: dict,
) -> dict:
    """Full fallback: build the entire response dict from rules."""
    missing = candidate.skill_overlap.get("missing_required", [])
    experience_years = _estimate_experience_years(candidate)

    per_skill = [
        _rule_based_estimate(skill, candidate, experience_years)
        for skill in missing
    ]

    max_weeks = max((s["estimated_weeks"] for s in per_skill), default=0)
    if max_weeks <= 4:
        ramp_up = "~1 month to role-ready"
    elif max_weeks <= 8:
        ramp_up = "~2 months to role-ready"
    elif max_weeks <= 13:
        ramp_up = "~3 months to role-ready"
    elif max_weeks <= 26:
        ramp_up = "~6 months to role-ready"
    else:
        ramp_up = f"~{(max_weeks + 3) // 4} months to role-ready"

    if max_weeks <= 6:
        verdict = "Gap is small and easily bridgeable with a short onboarding plan."
    elif max_weeks <= 13:
        verdict = "Gap is moderate — bridgeable with a focused training plan alongside the role."
    elif max_weeks <= 26:
        verdict = "Significant gap — candidate would need a dedicated ramp-up period before being fully productive."
    else:
        verdict = "Large gap — training plan is feasible but requires substantial investment."

    return {
        "skills": per_skill,
        "aggregate_ramp_up": ramp_up,
        "verdict": verdict,
        "experience_years_used": experience_years,
    }


# ── LLM prompt ──────────────────────────────────────────────

_TRAINING_PROMPT = """\
You are a technical learning-path advisor for a recruiting team.

Given a candidate's profile and the skills they are MISSING for a target role,
estimate how long THIS SPECIFIC candidate would need to learn each missing skill
to a job-ready level. Base your estimate on their existing skills, years of
experience, and how transferable their background is.

IMPORTANT RULES:
- A candidate who already knows a closely related technology (e.g. GCP when
  missing AWS, React when missing Vue, PostgreSQL when missing MySQL) should
  get a SHORT estimate (1-4 weeks). Transferable knowledge matters.
- A candidate with many years of experience learns new tools faster than a
  junior. Factor this in.
- Estimates should assume parallel learning — the candidate works on all gaps
  at the same time. The aggregate ramp-up equals the LONGEST single skill, not
  the sum.
- "estimated_weeks" must be a positive integer.
- Be realistic: if a backend dev with zero ML background needs Deep Learning,
  that is 3-6 months, not 2 weeks.
- If the candidate has 0 listed years of experience, look at their career
  history dates to calculate approximate years. Do NOT assume 0 years literally.

TARGET ROLE:
  Title: {jd_title}
  Seniority: {jd_seniority}
  Role summary: {jd_summary}

CANDIDATE:
  Name: {cand_name}
  Current title: {cand_title}
  Stated seniority: {cand_seniority}
  Years of experience: {cand_years}
  Skills they DO have (matched required): {matched_skills}
  Skills they DO have (matched preferred): {matched_preferred}
  Career summary: {cand_summary}

MISSING REQUIRED SKILLS TO ESTIMATE:
{missing_skills_list}

Return a JSON object with EXACTLY this schema (no markdown, no extra keys):
{{
  "skills": [
    {{
      "skill": "<exact skill name from the list above>",
      "estimated_weeks": <integer>,
      "reason": "<1 sentence explaining why this estimate>",
      "first_step": "<1 concrete first action to start learning>"
    }}
  ],
  "aggregate_ramp_up": "<e.g. '~3 months to role-ready'>",
  "verdict": "<1 sentence: is the gap bridgeable with a training plan?>"
}}

You MUST include an entry for EVERY skill in the missing list. Do not skip any.
"""


# ── Public API ──────────────────────────────────────────────

def generate_skill_training_recommendations(
    candidate: MatchCandidate,
    parsed_jd: dict,
) -> Optional[dict]:
    """Return a training-plan dict, or ``None`` when there are no gaps."""
    missing = candidate.skill_overlap.get("missing_required", [])
    if not missing:
        return None

    fallback = _rule_based_recommendations(candidate, parsed_jd)

    if not OPENAI_API_KEY:
        return fallback

    experience_years = _estimate_experience_years(candidate)

    try:
        from openai import OpenAI
        client = OpenAI(api_key=OPENAI_API_KEY)

        inferred_name = list(SENIORITY_LEVELS.keys())[
            min(candidate.inferred_level - 1, len(SENIORITY_LEVELS) - 1)
        ]

        prompt = _TRAINING_PROMPT.format(
            jd_title=parsed_jd.get("title", "Unknown"),
            jd_seniority=parsed_jd.get("seniority", "mid"),
            jd_summary=parsed_jd.get("embedding_text", "")[:1500],
            cand_name=candidate.name,
            cand_title=candidate.current_title,
            cand_seniority=f"{candidate.stated_seniority} (inferred: {inferred_name})",
            cand_years=experience_years,
            matched_skills=", ".join(candidate.skill_overlap.get("matched_required", [])) or "none",
            matched_preferred=", ".join(candidate.skill_overlap.get("matched_preferred", [])) or "none",
            cand_summary=candidate.embedding_text[:1500],
            missing_skills_list="\n".join(f"  - {s}" for s in missing),
        )

        response = client.chat.completions.create(
            model=LLM_MODEL,
            temperature=0,
            max_tokens=1500,
            response_format={"type": "json_object"},
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a technical learning-path advisor. "
                        "Return ONLY valid JSON matching the requested schema."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
        )

        raw = response.choices[0].message.content.strip()
        result = json.loads(raw)

        # Patch: ensure every missing skill is present
        llm_skill_names = {
            entry["skill"].lower() for entry in result.get("skills", [])
        }
        for skill in missing:
            if skill.lower() not in llm_skill_names:
                patch = _rule_based_estimate(skill, candidate, experience_years)
                result.setdefault("skills", []).append(patch)

        if "aggregate_ramp_up" not in result:
            result["aggregate_ramp_up"] = fallback["aggregate_ramp_up"]
        if "verdict" not in result:
            result["verdict"] = fallback["verdict"]

        result["experience_years_used"] = experience_years
        return result

    except Exception as e:
        print(f"  Training recommendation LLM call failed for {candidate.name}: {e}")
        return fallback
