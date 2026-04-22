"""
Search interface — ported from vector-search MVP.

Exposes get_matcher() and search_for_candidates() for use by the
Django views/services layer.
"""

import json
from typing import Optional

from .settings import (
    OPENAI_API_KEY, TOP_K_RESULTS, LLM_MODEL,
)
from .smart_matcher import SmartMatcher, MatchCandidate


# ── Allowed skills vocabulary (for JD parsing) ──

DATASET_SKILLS = [
    "3D Design", "AI APIs", "AI Data Preparation", "AI Model Deployment",
    "API Gateway", "API Testing", "ASP.NET Core", "AWS",
    "Agile Methodology", "Android (Kotlin)", "Angular", "Application Security",
    "BPMN 2.0", "Backlog Management", "Backup Systems", "BluePrism",
    "Bootstrap", "Business Process Analysis", "C# .NET", "CI/CD Pipelines",
    "CSS3", "Camunda", "Client Communication", "Cloud Storage",
    "Computer Vision", "Container Services", "Cypress", "DNS",
    "Data Migration", "Data Modeling", "Data Warehousing", "Database Design",
    "Deep Learning", "DialogFlow CX Agent", "Django", "Docker",
    "Documentation", "ETL Pipelines", "Encryption", "English",
    "Event Streaming", "Express.js", "FastAPI", "Figma",
    "Firewall Management", "Flutter", "German", "GitHub Actions",
    "GitLab CI", "Google Cloud", "GraphQL", "Graphic Design",
    "HTML5", "Indexing", "Infrastructure as Code", "Integration Testing",
    "Java", "Jenkins", "Jira / Issue Tracking", "Kanban",
    "Kubernetes", "LLM Integration", "Linux Administration", "Load Balancing",
    "Logging", "Machine Learning Basics", "Machine Learning Fundamentals",
    "Managed Databases", "Message Queues", "Microservices", "Microsoft Azure",
    "Mobile UI/UX", "MongoDB", "Monitoring", "MySQL",
    "Natural Language Processing (NLP)", "NestJS", "Network Security", "NextJS",
    "Node.js", "Oracle", "Performance Testing", "Playwright",
    "PostgreSQL", "Power BI", "Prisma", "Product Roadmapping",
    "Project Planning", "Prompt Engineering", "PyTorch", "Python",
    "Python AI Stack", "Python Data Stack", "Query Optimization",
    "RAG (Retrieval Augmented Generation)", "REST APIs", "React", "React Native",
    "Redis", "Requirements Engineering", "Responsive Design", "Risk Management",
    "Routing & Switching", "SEO", "SOAP", "SQL Server",
    "Scrum Framework", "Security Monitoring", "Selenium", "Serverless",
    "Spring Boot", "Sprint Planning", "Stakeholder Management", "State Management",
    "Storage Systems", "Stored Procedures", "System Automation", "TCP/IP",
    "Tableau", "TailwindCSS", "TensorFlow", "Test Automation",
    "TypeScript", "UiPath", "Unit Testing", "User Story Writing",
    "VPN", "Vector Databases", "Video Editing", "Virtualization",
    "Vue.js", "Vulnerability Management", "Web Accessibility", "Webhooks",
    "Webpack/Vite", "Windows Server", "Workfusion", "iOS (Swift)",
]

DATASET_CATEGORIES = [
    "AI & Machine Learning", "API & Integration", "Automation", "Backend",
    "Cloud Platforms", "Cybersecurity", "Data & Analytics", "Databases",
    "Design & Media", "DevOps & CI/CD", "Frontend", "Infrastructure & Systems",
    "Languages", "Mobile Development", "Networking",
    "Project & Product Management", "Testing & QA",
]

PARSE_JD_PROMPT = """You are a job description parser for an internal recruiting tool. Given the raw text of a job posting, extract structured fields.

CRITICAL: Our employee database uses a FIXED skill vocabulary. You MUST map every skill you detect to the closest match from the list below. Do NOT invent skill names outside this list.

ALLOWED SKILLS (use these exact names):
{allowed_skills}

SKILL CATEGORIES (for reference):
{allowed_categories}

Return ONLY valid JSON with these exact fields (no markdown, no explanation):

{{
  "title": "Job Title",
  "company": "Company Name or null",
  "seniority": "junior|mid|senior|lead|principal|director|vp|c_level",
  "required_skills": ["Skill from list above", "Another skill from list"],
  "preferred_skills": ["Nice-to-have skill from list", "Another"],
  "min_years_experience": 5.0,
  "industry": "Target industry or null",
  "location": "City, State or Remote or null",
  "embedding_text": "A dense 4-6 sentence paragraph summarizing the role, responsibilities, tech stack, and the ideal candidate profile. Write as natural language, not a list."
}}

Rules:
- ONLY use skill names from the ALLOWED SKILLS list above
- Map generic terms to their dataset equivalents (e.g. "React.js" -> "React", "k8s" -> "Kubernetes", "Postgres" -> "PostgreSQL")
- If a JD skill has no close match in the list, skip it rather than inventing a name
- Separate required vs preferred skills carefully
- For seniority, infer from title + experience requirement
- If min years not stated, estimate from seniority level
- embedding_text should read like a recruiter briefing about WHO would be ideal
- Be generous: include related skills from the list that are clearly implied

RAW JOB DESCRIPTION:
{jd_text}
"""


def _extract_skills_by_keyword(raw_text: str) -> list[str]:
    text_lower = raw_text.lower()
    found = []
    for skill in DATASET_SKILLS:
        if skill.lower() in text_lower:
            found.append(skill)
    return found


def parse_jd_live(raw_text: str) -> dict:
    if not OPENAI_API_KEY:
        extracted = _extract_skills_by_keyword(raw_text)
        return {
            "title": "Unparsed JD (no API key)",
            "seniority": "mid",
            "required_skills": extracted,
            "preferred_skills": [],
            "min_years_experience": 0,
            "embedding_text": raw_text[:3000],
        }

    try:
        from openai import OpenAI
        client = OpenAI(api_key=OPENAI_API_KEY)

        prompt = PARSE_JD_PROMPT.format(
            allowed_skills=", ".join(DATASET_SKILLS),
            allowed_categories=", ".join(DATASET_CATEGORIES),
            jd_text=raw_text[:6000],
        )

        response = client.chat.completions.create(
            model=LLM_MODEL,
            temperature=0,
            max_tokens=1500,
            messages=[
                {"role": "system", "content": "You are a job description parser. Return only valid JSON, no markdown fences."},
                {"role": "user", "content": prompt},
            ],
        )

        text = response.choices[0].message.content.strip()
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
            text = text.strip()

        return json.loads(text)

    except Exception as e:
        print(f"  JD parsing via LLM failed: {e} — falling back to keyword extraction")
        extracted = _extract_skills_by_keyword(raw_text)
        return {
            "title": "Parse Error (LLM fallback)",
            "seniority": "mid",
            "required_skills": extracted,
            "preferred_skills": [],
            "min_years_experience": 0,
            "embedding_text": raw_text[:3000],
        }


def get_matcher() -> SmartMatcher:
    return SmartMatcher()


def search_for_candidates(
    jd_text: str,
    top_k: int = TOP_K_RESULTS,
    matcher: Optional[SmartMatcher] = None,
    parsed_jd: Optional[dict] = None,
) -> tuple[dict, list[MatchCandidate]]:
    if parsed_jd is None:
        parsed_jd = parse_jd_live(jd_text)

    if matcher is None:
        matcher = get_matcher()

    results = matcher.search(
        query_text=parsed_jd.get("embedding_text", jd_text),
        jd_metadata={
            "seniority": parsed_jd.get("seniority", "mid"),
            "required_skills": parsed_jd.get("required_skills", []),
            "preferred_skills": parsed_jd.get("preferred_skills", []),
            "min_years_experience": parsed_jd.get("min_years_experience", 0),
        },
        top_k=top_k,
    )

    return parsed_jd, results
