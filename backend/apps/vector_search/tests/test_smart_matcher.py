"""
Unit tests for the smart matcher scoring logic.
Ported from vector-search MVP — exercises pure functions only.
"""

import pytest
from apps.vector_search.core.smart_matcher import (
    infer_competency_level,
    normalize_skill,
    compute_skill_overlap,
    compute_composite_score,
    MatchCandidate,
)


class TestInferCompetencyLevel:
    def test_stated_matches_years(self):
        assert infer_competency_level("mid", 3) == 2

    def test_years_override_title(self):
        assert infer_competency_level("mid", 7) == 3

    def test_title_overrides_low_years(self):
        assert infer_competency_level("senior", 1) == 3

    def test_junior_with_zero_years(self):
        assert infer_competency_level("junior", 0) == 1

    def test_unknown_seniority_defaults_to_mid(self):
        assert infer_competency_level("intern", 0) == 2

    def test_very_experienced(self):
        level = infer_competency_level("mid", 20)
        assert level >= 5


class TestNormalizeSkill:
    def test_known_alias(self):
        assert normalize_skill("k8s") == "kubernetes"
        assert normalize_skill("postgres") == "postgresql"
        assert normalize_skill("azure") == "microsoft azure"

    def test_case_insensitive(self):
        assert normalize_skill("Python") == "python"
        assert normalize_skill("DOCKER") == "docker"

    def test_unknown_skill_lowered(self):
        assert normalize_skill("Foobar") == "foobar"

    def test_whitespace_stripped(self):
        assert normalize_skill("  React  ") == "react"


class TestComputeSkillOverlap:
    def test_full_overlap(self):
        result = compute_skill_overlap(
            ["Python", "SQL", "AWS"],
            ["Python", "SQL", "AWS"],
        )
        assert result["required_coverage"] == 1.0
        assert result["missing_required"] == []

    def test_partial_overlap(self):
        result = compute_skill_overlap(
            ["Python", "SQL"],
            ["Python", "SQL", "Spark"],
        )
        assert 0.5 <= result["required_coverage"] <= 0.7
        assert "spark" in [s.lower() for s in result["missing_required"]]

    def test_no_overlap(self):
        result = compute_skill_overlap(["Go", "Rust"], ["Python", "Java"])
        assert result["required_coverage"] == 0.0

    def test_synonym_match(self):
        result = compute_skill_overlap(["k8s"], ["Kubernetes"])
        assert result["required_coverage"] == 1.0

    def test_preferred_skills(self):
        result = compute_skill_overlap(
            ["Python", "Docker"],
            ["Python"],
            preferred_skills=["Docker", "Terraform"],
        )
        assert "docker" in result["matched_preferred"]

    def test_empty_required(self):
        result = compute_skill_overlap(["Python"], [])
        assert result["required_coverage"] == 0.0


def _make_candidate(**overrides) -> MatchCandidate:
    defaults = dict(
        id="EMP-TEST",
        name="Test Candidate",
        current_title="Software Engineer",
        stated_seniority="mid",
        inferred_level=2,
        years_of_experience=3.0,
        vector_similarity=0.85,
        skill_overlap={"required_coverage": 0.8, "matched_required": ["python"]},
        composite_score=0.0,
        search_tier=1,
        competency_note="test",
    )
    defaults.update(overrides)
    return MatchCandidate(**defaults)


class TestCompositeScore:
    def test_perfect_candidate(self):
        c = _make_candidate(
            vector_similarity=1.0,
            skill_overlap={"required_coverage": 1.0},
            inferred_level=3,
            search_tier=1,
        )
        score = compute_composite_score(c, required_level=3)
        assert score == 1.0

    def test_score_in_range(self):
        c = _make_candidate()
        score = compute_composite_score(c, required_level=3)
        assert 0.0 <= score <= 1.0

    def test_higher_similarity_higher_score(self):
        c_low = _make_candidate(vector_similarity=0.4)
        c_high = _make_candidate(vector_similarity=0.95)
        assert compute_composite_score(c_high, 2) > compute_composite_score(c_low, 2)

    def test_tier1_beats_tier3(self):
        c1 = _make_candidate(search_tier=1)
        c3 = _make_candidate(search_tier=3)
        assert compute_composite_score(c1, 2) > compute_composite_score(c3, 2)

    def test_min_years_penalty(self):
        c = _make_candidate(years_of_experience=2.0)
        no_penalty = compute_composite_score(c, required_level=2, min_years=0)
        with_penalty = compute_composite_score(c, required_level=2, min_years=5)
        assert with_penalty < no_penalty

    def test_min_years_no_penalty_when_met(self):
        c = _make_candidate(years_of_experience=6.0)
        score_a = compute_composite_score(c, required_level=2, min_years=5)
        score_b = compute_composite_score(c, required_level=2, min_years=0)
        assert score_a == score_b

    def test_score_never_negative(self):
        c = _make_candidate(
            vector_similarity=0.0,
            skill_overlap={"required_coverage": 0.0},
            inferred_level=1,
            search_tier=3,
            years_of_experience=0,
        )
        score = compute_composite_score(c, required_level=8, min_years=20)
        assert score >= 0.0
