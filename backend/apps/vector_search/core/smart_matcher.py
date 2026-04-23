"""
Smart Matching Engine — ported from vector-search MVP.

Implements competency scoring, tiered fallback search, and
skill overlap scoring to surface the best candidates even when
their title doesn't exactly match the JD.
"""

from dataclasses import dataclass

from .settings import (
    TOP_K_RESULTS,
    SIMILARITY_THRESHOLD, OPENAI_API_KEY, EMBEDDING_MODEL,
    EMBEDDING_DIMENSIONS, ALLOW_DUMMY_EMBEDDINGS,
    COMPOSITE_WEIGHTS, EMBEDDING_MODE,
    LOCAL_EMBEDDING_MODEL, LOCAL_EMBEDDING_DIMENSIONS,
)
from .vector_db import query_similar, get_collection_count

# ── Seniority ladder ──

SENIORITY_LEVELS = {
    "junior":    1,
    "mid":       2,
    "senior":    3,
    "lead":      4,
    "principal": 5,
    "director":  6,
    "vp":        7,
    "c_level":   8,
}

YEARS_TO_LEVEL = {
    1: (0, 1.9),
    2: (2, 4.9),
    3: (5, 7.9),
    4: (8, 11.9),
    5: (12, 15.9),
    6: (16, 99),
}


def infer_competency_level(stated_seniority: str, years_of_experience: float) -> int:
    stated_level = SENIORITY_LEVELS.get(stated_seniority, 2)
    years_level = 1
    for level, (min_yr, max_yr) in YEARS_TO_LEVEL.items():
        if min_yr <= years_of_experience <= max_yr:
            years_level = level
            break
        elif years_of_experience > max_yr:
            years_level = level
    return max(stated_level, years_level)


# ── Skill matching ──

SKILL_SYNONYMS = {
    "c# .net": {"c#", "c# .net", ".net", "dotnet", "c-sharp"},
    "asp.net core": {"asp.net", "asp.net core", "aspnet"},
    "java": {"java"},
    "python": {"python", "py"},
    "typescript": {"typescript", "ts"},
    "node.js": {"node", "node.js", "nodejs", "node js"},
    "nestjs": {"nestjs", "nest.js", "nest"},
    "react": {"react", "react.js", "reactjs"},
    "react native": {"react native", "react-native"},
    "angular": {"angular", "angular.js", "angularjs"},
    "vue.js": {"vue", "vue.js", "vuejs"},
    "nextjs": {"next", "nextjs", "next.js"},
    "express.js": {"express", "express.js", "expressjs"},
    "spring boot": {"spring", "spring boot", "springboot"},
    "django": {"django"},
    "fastapi": {"fastapi", "fast api"},
    "html5": {"html", "html5"},
    "css3": {"css", "css3"},
    "bootstrap": {"bootstrap"},
    "tailwindcss": {"tailwind", "tailwindcss", "tailwind css"},
    "rest apis": {"rest", "rest api", "rest apis", "restful"},
    "graphql": {"graphql", "graph ql"},
    "soap": {"soap"},
    "webhooks": {"webhook", "webhooks"},
    "api gateway": {"api gateway"},
    "microservices": {"microservice", "microservices"},
    "docker": {"docker", "containers", "containerization"},
    "kubernetes": {"kubernetes", "k8s"},
    "ci/cd pipelines": {"ci/cd", "cicd", "ci cd", "ci/cd pipelines", "continuous integration", "continuous deployment"},
    "github actions": {"github actions", "gh actions"},
    "gitlab ci": {"gitlab ci", "gitlab-ci"},
    "jenkins": {"jenkins"},
    "aws": {"aws", "amazon web services"},
    "google cloud": {"gcp", "google cloud", "google cloud platform"},
    "microsoft azure": {"azure", "microsoft azure"},
    "postgresql": {"postgresql", "postgres", "psql"},
    "mysql": {"mysql"},
    "mongodb": {"mongodb", "mongo"},
    "sql server": {"sql server", "mssql", "ms sql"},
    "redis": {"redis"},
    "prisma": {"prisma"},
    "machine learning fundamentals": {"machine learning", "ml", "machine learning fundamentals"},
    "machine learning basics": {"ml basics", "machine learning basics"},
    "deep learning": {"deep learning", "dl"},
    "natural language processing (nlp)": {"nlp", "natural language processing", "natural language processing (nlp)"},
    "llm integration": {"llm", "llm integration", "large language model"},
    "prompt engineering": {"prompt engineering", "prompting"},
    "rag (retrieval augmented generation)": {"rag", "retrieval augmented generation", "rag (retrieval augmented generation)"},
    "vector databases": {"vector database", "vector databases", "vector db"},
    "ai apis": {"ai api", "ai apis", "openai api"},
    "ai data preparation": {"ai data prep", "ai data preparation"},
    "computer vision": {"computer vision", "cv"},
    "tensorflow": {"tensorflow", "tf"},
    "pytorch": {"pytorch", "torch"},
    "python ai stack": {"python ai stack"},
    "python data stack": {"python data stack", "pandas", "numpy"},
    "power bi": {"power bi", "powerbi"},
    "tableau": {"tableau"},
    "data modeling": {"data modeling", "data modelling"},
    "data migration": {"data migration"},
    "data warehousing": {"data warehouse", "data warehousing"},
    "etl pipelines": {"etl", "etl pipelines"},
    "database design": {"database design", "db design"},
    "query optimization": {"query optimization", "sql optimization"},
    "indexing": {"indexing", "db indexing"},
    "stored procedures": {"stored procedures", "stored procs"},
    "infrastructure as code": {"iac", "infrastructure as code", "terraform"},
    "linux administration": {"linux", "linux administration", "linux admin"},
    "virtualization": {"virtualization", "vmware", "virtual machines"},
    "monitoring": {"monitoring", "observability"},
    "logging": {"logging"},
    "selenium": {"selenium"},
    "cypress": {"cypress"},
    "playwright": {"playwright"},
    "unit testing": {"unit testing", "unit tests"},
    "integration testing": {"integration testing", "integration tests"},
    "api testing": {"api testing"},
    "test automation": {"test automation", "automated testing"},
    "performance testing": {"performance testing", "load testing"},
    "agile methodology": {"agile", "agile methodology"},
    "scrum framework": {"scrum", "scrum framework"},
    "kanban": {"kanban"},
    "sprint planning": {"sprint planning"},
    "jira / issue tracking": {"jira", "jira / issue tracking", "issue tracking"},
    "backlog management": {"backlog management", "backlog grooming"},
    "user story writing": {"user stories", "user story writing"},
    "stakeholder management": {"stakeholder management"},
    "product roadmapping": {"product roadmap", "product roadmapping"},
    "project planning": {"project planning", "project management"},
    "requirements engineering": {"requirements engineering", "requirements gathering"},
    "risk management": {"risk management"},
    "responsive design": {"responsive design", "responsive"},
    "state management": {"state management", "redux", "zustand"},
    "webpack/vite": {"webpack", "vite", "webpack/vite", "bundler"},
    "web accessibility": {"accessibility", "web accessibility", "a11y", "wcag"},
    "seo": {"seo", "search engine optimization"},
    "application security": {"appsec", "application security"},
    "encryption": {"encryption"},
    "firewall management": {"firewall", "firewall management"},
    "network security": {"network security"},
    "vulnerability management": {"vulnerability management", "vulnerability scanning"},
    "security monitoring": {"security monitoring", "siem"},
    "tcp/ip": {"tcp/ip", "tcp", "networking"},
    "dns": {"dns"},
    "vpn": {"vpn"},
    "routing & switching": {"routing", "switching", "routing & switching"},
    "android (kotlin)": {"android", "kotlin", "android (kotlin)"},
    "ios (swift)": {"ios", "swift", "ios (swift)"},
    "flutter": {"flutter"},
    "mobile ui/ux": {"mobile ui", "mobile ux", "mobile ui/ux"},
    "figma": {"figma"},
    "graphic design": {"graphic design"},
    "uipath": {"uipath"},
    "blueprism": {"blueprism", "blue prism"},
    "event streaming": {"kafka", "event streaming", "rabbitmq"},
    "message queues": {"message queue", "message queues", "mq"},
    "serverless": {"serverless", "lambda", "cloud functions"},
    "english": {"english"},
    "german": {"german", "deutsch"},
}


def normalize_skill(skill: str) -> str:
    lower = skill.strip().lower()
    for canonical, aliases in SKILL_SYNONYMS.items():
        if lower in aliases:
            return canonical
    return lower


def compute_skill_overlap(
    candidate_skills: list[str],
    required_skills: list[str],
    preferred_skills: list[str] | None = None,
) -> dict:
    cand_normalized = {normalize_skill(s) for s in candidate_skills}
    req_normalized = {normalize_skill(s) for s in required_skills}
    pref_normalized = {normalize_skill(s) for s in (preferred_skills or [])}

    matched_required = cand_normalized & req_normalized
    missing_required = req_normalized - cand_normalized
    matched_preferred = cand_normalized & pref_normalized

    req_count = max(len(req_normalized), 1)
    required_coverage = len(matched_required) / req_count

    total_score = (len(matched_required) * 2 + len(matched_preferred)) / max(
        req_count * 2 + len(pref_normalized), 1
    )

    return {
        "matched_required": sorted(matched_required),
        "missing_required": sorted(missing_required),
        "matched_preferred": sorted(matched_preferred),
        "required_coverage": round(required_coverage, 3),
        "total_score": round(total_score, 3),
    }


# ── Match result dataclass ──

@dataclass
class MatchCandidate:
    id: str
    name: str
    current_title: str
    stated_seniority: str
    inferred_level: int
    years_of_experience: float
    vector_similarity: float
    skill_overlap: dict
    composite_score: float = 0.0
    search_tier: int = 1
    competency_note: str = ""
    embedding_text: str = ""

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "current_title": self.current_title,
            "stated_seniority": self.stated_seniority,
            "inferred_competency": list(SENIORITY_LEVELS.keys())[
                min(self.inferred_level - 1, len(SENIORITY_LEVELS) - 1)
            ],
            "years_of_experience": self.years_of_experience,
            "vector_similarity": round(self.vector_similarity, 4),
            "skill_overlap": self.skill_overlap,
            "composite_score": round(self.composite_score, 4),
            "search_tier": self.search_tier,
            "competency_note": self.competency_note,
        }


# ── Composite scoring ──

def compute_composite_score(
    candidate: MatchCandidate,
    required_level: int,
    min_years: float = 0,
) -> float:
    vec_score = candidate.vector_similarity
    # Use required_coverage so the scoring matches the "Skill coverage %"
    # shown to the user on each result card.
    skill_score = candidate.skill_overlap.get("required_coverage", 0)

    level_diff = candidate.inferred_level - required_level
    if level_diff >= 0:
        competency_score = 1.0
    elif level_diff == -1:
        competency_score = 0.7
    elif level_diff == -2:
        competency_score = 0.3
    else:
        competency_score = 0.1

    tier_scores = {1: 1.0, 2: 0.7, 3: 0.4}
    tier_score = tier_scores.get(candidate.search_tier, 0.4)

    composite = (
        COMPOSITE_WEIGHTS["vector_similarity"] * vec_score +
        COMPOSITE_WEIGHTS["skill_coverage"] * skill_score +
        COMPOSITE_WEIGHTS["competency_fit"] * competency_score +
        COMPOSITE_WEIGHTS["tier_bonus"] * tier_score
    )

    # Only apply the experience penalty when we actually have candidate years
    # of experience. With the current indexing pipeline this is hardcoded to
    # 0.0, so without this guard every candidate would receive a blanket -5%
    # whenever the JD specified a min_years, flattening the distribution.
    if (
        min_years > 0
        and candidate.years_of_experience > 0
        and candidate.years_of_experience < min_years
    ):
        shortfall = (min_years - candidate.years_of_experience) / min_years
        composite -= 0.05 * min(shortfall, 1.0)

    return round(max(composite, 0.0), 4)


# ── Smart Matcher ──

class SmartMatcher:
    def __init__(self):
        self._local_model = None

    def _get_local_model(self):
        if self._local_model is None:
            from sentence_transformers import SentenceTransformer
            self._local_model = SentenceTransformer(LOCAL_EMBEDDING_MODEL)
        return self._local_model

    def _embed_query(self, text: str) -> list[float]:
        use_openai = EMBEDDING_MODE == "openai" or (
            EMBEDDING_MODE == "auto" and OPENAI_API_KEY
        )

        if use_openai and OPENAI_API_KEY:
            try:
                from openai import OpenAI
                client = OpenAI(api_key=OPENAI_API_KEY)
                response = client.embeddings.create(
                    model=EMBEDDING_MODEL,
                    input=text,
                )
                return response.data[0].embedding
            except Exception as e:
                print(f"  OpenAI embedding failed: {e}")
                if EMBEDDING_MODE == "openai" and not ALLOW_DUMMY_EMBEDDINGS:
                    raise RuntimeError(
                        f"OpenAI embedding failed and no fallback is configured. "
                        f"Set EMBEDDING_MODE=local or ALLOW_DUMMY_EMBEDDINGS=1 in .env"
                    ) from e

        use_local = EMBEDDING_MODE == "local" or EMBEDDING_MODE == "auto" or (
            use_openai and ALLOW_DUMMY_EMBEDDINGS
        )

        if use_local:
            try:
                model = self._get_local_model()
                vector = model.encode([text], show_progress_bar=False)
                return vector[0].tolist()
            except Exception as e:
                print(f"  Local embedding failed: {e}")
                if not ALLOW_DUMMY_EMBEDDINGS:
                    raise

        import hashlib
        dims = LOCAL_EMBEDDING_DIMENSIONS if EMBEDDING_MODE == "local" else EMBEDDING_DIMENSIONS
        hash_bytes = hashlib.sha512(text.encode()).digest()
        while len(hash_bytes) < dims * 4:
            hash_bytes += hashlib.sha512(hash_bytes).digest()
        vector = [(hash_bytes[i % len(hash_bytes)] / 127.5) - 1.0 for i in range(dims)]
        magnitude = sum(v ** 2 for v in vector) ** 0.5
        return [v / magnitude for v in vector]

    def search(
        self,
        query_text: str,
        jd_metadata: dict | None = None,
        top_k: int = TOP_K_RESULTS,
        min_results: int = 3,
    ) -> list[MatchCandidate]:
        jd_metadata = jd_metadata or {}
        query_embedding = self._embed_query(query_text)

        required_seniority = jd_metadata.get("seniority", "mid")
        required_level = SENIORITY_LEVELS.get(required_seniority, 2)
        required_skills = jd_metadata.get("required_skills", [])
        preferred_skills = jd_metadata.get("preferred_skills", [])
        min_years = jd_metadata.get("min_years_experience", 0)

        all_candidates: dict[str, MatchCandidate] = {}

        pool_size = min(max(top_k * 50, 200), get_collection_count())
        if pool_size == 0:
            return []

        rows = query_similar(query_embedding, n_results=pool_size)

        for row in rows:
            id_ = row["id"]
            meta = row["metadata"]
            doc = row["document"]
            similarity = row["similarity"]

            if similarity < SIMILARITY_THRESHOLD * 0.5:
                continue

            stated = meta.get("seniority", "mid")
            years = float(meta.get("years_of_experience", 0))
            inferred = infer_competency_level(stated, years)
            cand_skills = [s.strip() for s in meta.get("skills", "").split(",") if s.strip()]

            skill_result = compute_skill_overlap(cand_skills, required_skills, preferred_skills)

            if inferred >= required_level:
                tier = 1
                if stated != required_seniority and inferred >= required_level:
                    note = (
                        f"Title says '{stated}' but {years:.0f} years of experience "
                        f"and skill profile indicate {list(SENIORITY_LEVELS.keys())[inferred - 1]}-level competency"
                    )
                else:
                    note = f"Matches required {required_seniority} level"
            elif inferred >= required_level - 1:
                tier = 2
                note = (
                    f"One level below target ({stated}, {years:.0f}yr) — "
                    f"strong stretch candidate with {skill_result['required_coverage']:.0%} skill coverage"
                )
            else:
                tier = 3
                note = f"Below target seniority but included as best available match"

            candidate = MatchCandidate(
                id=id_,
                name=meta.get("name", "Unknown"),
                current_title=meta.get("current_title", "Unknown"),
                stated_seniority=stated,
                inferred_level=inferred,
                years_of_experience=years,
                vector_similarity=similarity,
                skill_overlap=skill_result,
                search_tier=tier,
                competency_note=note,
                embedding_text=doc,
            )

            candidate.composite_score = compute_composite_score(
                candidate, required_level, min_years=min_years,
            )
            all_candidates[id_] = candidate

        sorted_candidates = sorted(
            all_candidates.values(),
            key=lambda c: c.composite_score,
            reverse=True,
        )

        return sorted_candidates[:max(top_k, min_results)]
