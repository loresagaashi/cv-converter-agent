"""
Gap Analysis — ported from vector-search MVP.

Generates natural-language explanations for each candidate match,
explaining fit level, skill alignment, gaps, and recommendations.
"""

import time

from .settings import OPENAI_API_KEY, LLM_MODEL
from .smart_matcher import MatchCandidate, SENIORITY_LEVELS


GAP_ANALYSIS_PROMPT = """You are a senior recruiter writing a brief assessment of a candidate's fit for a specific role. Be honest, specific, and actionable.

JOB DESCRIPTION:
Title: {jd_title}
Seniority required: {jd_seniority}
Required skills: {required_skills}
Preferred skills: {preferred_skills}
Min years: {min_years}
Role summary: {jd_embedding_text}

CANDIDATE:
Name: {cand_name}
Current title: {cand_title}
Stated seniority: {cand_seniority} (inferred competency: {inferred_level})
Years of experience: {cand_years}
Matched required skills: {matched_required}
Missing required skills: {missing_required}
Matched preferred skills: {matched_preferred}
Similarity score: {vector_sim:.0%}
Candidate summary: {cand_embedding_text}

Write a 3-4 sentence gap analysis that:
1. States the overall fit level (strong match / good match / stretch candidate)
2. Highlights what aligns well (be specific — mention actual skills and experience)
3. Identifies gaps and whether they're bridgeable
4. Ends with a clear recommendation (proceed / discuss gap in screening / consider only if no better candidates)

If the candidate's title is lower than required but their inferred competency matches, explain why.

Write in a professional but direct tone. No bullet points — flowing sentences only.
Return ONLY the analysis text, no labels or JSON."""


def generate_gap_analysis(
    candidate: MatchCandidate,
    parsed_jd: dict,
) -> str:
    fallback = _generate_rule_based_analysis(candidate, parsed_jd)

    if not OPENAI_API_KEY:
        return fallback

    try:
        from openai import OpenAI
        client = OpenAI(api_key=OPENAI_API_KEY)

        inferred_name = list(SENIORITY_LEVELS.keys())[
            min(candidate.inferred_level - 1, len(SENIORITY_LEVELS) - 1)
        ]

        prompt = GAP_ANALYSIS_PROMPT.format(
            jd_title=parsed_jd.get("title", "Unknown"),
            jd_seniority=parsed_jd.get("seniority", "mid"),
            required_skills=", ".join(parsed_jd.get("required_skills", [])) or "none specified",
            preferred_skills=", ".join(parsed_jd.get("preferred_skills", [])) or "none specified",
            min_years=parsed_jd.get("min_years_experience", "not specified"),
            jd_embedding_text=parsed_jd.get("embedding_text", "")[:1500],
            cand_name=candidate.name,
            cand_title=candidate.current_title,
            cand_seniority=candidate.stated_seniority,
            inferred_level=inferred_name,
            cand_years=candidate.years_of_experience,
            matched_required=", ".join(candidate.skill_overlap.get("matched_required", [])) or "none",
            missing_required=", ".join(candidate.skill_overlap.get("missing_required", [])) or "none",
            matched_preferred=", ".join(candidate.skill_overlap.get("matched_preferred", [])) or "none",
            vector_sim=candidate.vector_similarity,
            cand_embedding_text=candidate.embedding_text[:1500],
        )

        response = client.chat.completions.create(
            model=LLM_MODEL,
            temperature=0,
            max_tokens=400,
            messages=[
                {"role": "system", "content": "You are a senior recruiter writing brief candidate assessments. Return only the analysis text, no labels or JSON."},
                {"role": "user", "content": prompt},
            ],
        )

        analysis = response.choices[0].message.content.strip()

        if analysis.startswith("{") or analysis.startswith("[") or len(analysis) < 50:
            return fallback

        return analysis

    except Exception as e:
        print(f"  Gap analysis LLM call failed for {candidate.name}: {e}")
        return fallback


def _generate_rule_based_analysis(candidate: MatchCandidate, parsed_jd: dict) -> str:
    parts = []
    coverage = candidate.skill_overlap.get("required_coverage", 0)
    matched = candidate.skill_overlap.get("matched_required", [])
    missing = candidate.skill_overlap.get("missing_required", [])

    if candidate.composite_score >= 0.85:
        parts.append("Strong match for this role.")
    elif candidate.composite_score >= 0.70:
        parts.append("Good match with some gaps to discuss.")
    else:
        parts.append("Stretch candidate — partial fit.")

    if matched:
        parts.append(f"Covers {', '.join(matched)}.")
    if missing:
        parts.append(f"Missing: {', '.join(missing)}.")

    inferred_name = list(SENIORITY_LEVELS.keys())[
        min(candidate.inferred_level - 1, len(SENIORITY_LEVELS) - 1)
    ]
    jd_seniority = parsed_jd.get("seniority", "mid")

    if candidate.stated_seniority != inferred_name:
        parts.append(
            f"Title says '{candidate.stated_seniority}' but "
            f"{candidate.years_of_experience:.0f} years of experience "
            f"indicate {inferred_name}-level competency."
        )

    if candidate.search_tier == 1 and coverage >= 0.75:
        parts.append("Recommend proceeding to client submission.")
    elif candidate.search_tier == 1:
        parts.append("Discuss skill gaps in screening call.")
    elif candidate.search_tier == 2:
        parts.append("Consider if stronger candidates are unavailable.")
    else:
        parts.append("Include only if candidate pool is limited.")

    return " ".join(parts)


def enrich_results_with_gap_analysis(
    results: list[MatchCandidate],
    parsed_jd: dict,
    max_to_analyze: int = 5,
) -> list[dict]:
    enriched = []

    for i, candidate in enumerate(results[:max_to_analyze]):
        analysis = generate_gap_analysis(candidate, parsed_jd)
        result_dict = candidate.to_dict()
        result_dict["gap_analysis"] = analysis
        enriched.append(result_dict)

        if OPENAI_API_KEY and i < len(results) - 1:
            time.sleep(0.3)

    return enriched
