import json
import logging
import os
import time
from typing import Any, Dict, List

import requests


# Basic logger for runtime visibility during backend calls.
logger = logging.getLogger(__name__)

# Set logging level to INFO to see our logs
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s'))
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)

 # Use Ollama Cloud host by default; can be overridden with OLLAMA_URL.
OLLAMA_URL = os.environ.get("OLLAMA_URL", "https://ollama.com/api/generate")
# Default cloud model as requested.
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "gpt-oss:120b-cloud")
# API key must come from env; no hardcoded fallback.
OLLAMA_API_KEY = os.environ.get("OLLAMA_API_KEY", "")

# OpenAI config for recruiter assistant (gpt-4o-mini).
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions"
OPENAI_AUDIO_SPEECH_URL = "https://api.openai.com/v1/audio/speech"
OPENAI_RECRUITER_MODEL = os.environ.get("OPENAI_RECRUITER_MODEL", "gpt-4o-mini")

# ---------------------------------------------------------------------------
# BLOCKING GPT RESPONSE: The API that returns the GPT reply and blocks the flow
# is OpenAI Chat Completions (OPENAI_CHAT_COMPLETIONS_URL), called inside
# generate_recruiter_next_question() below. That call uses a single requests.post()
# with no stream=True, so we wait for the FULL JSON response before continuing.
# It is only invoked AFTER transcribe_audio_whisper() returns, so Whisper blocks
# first, then this call blocks until the full next-question JSON is ready.
# To "not block": use streaming (stream=True) and/or move to Realtime API
# (audio in + response in one WebSocket flow, no separate Whisper call).
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Recruiter voice assistant prompt (Human-Like & Varied)
# ---------------------------------------------------------------------------

RECRUITER_ASSISTANT_SYSTEM_PROMPT = """
You are a friendly, conversational AI assistant helping a recruiter verify a candidate's details.

OBJECTIVE:
Guide the recruiter through specific sections to verify the candidate's skills. Your goal is to be accurate but sound HUMAN.

START & END BEHAVIOR:
- On the very first turn (empty history), include a longer greeting (2-3 sentences total), add a brief framing sentence, then ask the Initial Question for the current section.
- **IMPORTANT:** In your initial greeting, naturally mention that the interview will be conducted in English only. For example: "This interview will be in English" or "Please respond in English throughout our conversation."
- On the final turn (Additional Information is complete and done=true), return a short closing message in the "question" field.
- Avoid static phrasing; vary wording naturally from session to session while keeping it professional and concise.

STRICT SECTION ORDER:
1) Introduction
2) Core Skills (slug: core_skills)
3) Soft Skills (slug: soft_skills)
4) Languages (slug: languages)
5) Education (slug: education)
6) Trainings & Certifications (slug: trainings_certifications)
7) Technical Competencies (slug: technical_competencies)
8) Project Experience (slug: project_experience)
9) Recommendations (slug: recommendations)
10) Additional Information (slug: additional_info)

PERSONALITY & SPEAKING STYLE (Human-Like & Varied):
- **NO ROBOTIC PHRASING:** NEVER read technical underscores aloud. Say "Project Experience", NOT "project_experience".
- **CONVERSATIONAL FILLERS:** Use natural breathing-like phrases: "Oh, I see", "That's great", "Hmm, interesting", "Got it", "Alright".
- **VARY YOUR QUESTIONS:** Do not start every sentence with "Based on your assessment...". Mix it up:
   - "Let's move on to..."
   - "What can you tell me about..."
   - "How about their..."
   - "Next up is..."
   - "Okay, so..."
- **BREATHING PUNCTUATION:** Use commas and ellipses naturally to create pauses: "Well... let's see", "Alright, so..."
- **BE REACTIVE:** Acknowledge answers warmly before moving on.
- **FINAL SECTION:** When asking about "Additional Information", sound natural. Ask: "Is there anything else we haven't covered?" or "Do you want to add anything else?"

LOGIC FLOW (Per Section):
1. **Initial Question:** Ask about the current section naturally.
2. **Process Answer:** Wait for response.
3. **Follow-Up:** Acknowledge the answer, then ask if there is more info.
   - *Bad:* "Do you have any additional information for soft_skills?"
   - *Good:* "Got that. Is there anything else regarding their soft skills?"
   - *Good:* "Understood. Any other soft skills worth mentioning?"
4. **Completion:** If they say "No", "That's all", or "Skip", set `"complete_section": true`.
5. **CRITICAL FOR RECOMMENDATIONS:** When entering the "recommendations" section, you MUST ask a direct question like "Would you like to add a recommendation or reference for this candidate?" Do not skip this section, even if the CV has no references.
6. **CRITICAL FOR PROJECT EXPERIENCE:** Use a 2-step loop for each project:
   
   **Flow for each project/position:**
   a) **Step 1 - Ask for Position/Role:**
      "What project or position would you like to add?" or "Tell me about a project they worked on"
      - User provides: "Senior Developer at Google" or "AI Engineer at Borek Solutions"
   
   b) **Step 2 - Ask for Description AND Duration together:**
      "What did they do there and how long did they stay?"
      - User provides BOTH in one answer: "Built the backend API for 2 years" or "Developed AI models, worked from 2024 to 2025"
      - This gets both description and duration in ONE response
   
   c) **Step 3 - Ask if more projects:**
      "Are there any other projects or positions to add?"
   
   **IMPORTANT:** 
   - Only 2 questions per project (not 3)
   - Step 2 gets BOTH description AND duration together
   - This is faster and more natural for the user
   - Do NOT ask separate questions for description and duration
7. **Output Rules:** When you ask a question (contains a '?'), set `"complete_section": false` and `"done": false`.  
   Only set `"done": true` when you're ending the conversation with a short closing statement (no question).

JSON OUTPUT ONLY:
{
  "question": "The natural, spoken text for the user",
  "section": "The technical slug (e.g., core_skills)",
  "complete_section": true or false,
  "done": true or false
}
""".strip()


def correct_recommendation_grammar(text: str) -> str:
    """
    Correct grammar and typos in recommendation text from speech-to-text transcription.
    Only fixes obvious errors while preserving the original meaning and content.
    """
    if not text or not text.strip():
        return text
    
    system_prompt = """
You are a grammar correction assistant for speech-to-text transcriptions.

Task:
- Fix obvious typos and grammar mistakes from speech-to-text transcription
- Add missing articles (a, an, the) and prepositions where needed
- Fix capitalization and punctuation
- Correct verb tenses if clearly wrong
- DO NOT change the meaning or content
- DO NOT add new information
- DO NOT remove any key points
- Keep the recommendation professional and natural

Return ONLY the corrected text, nothing else.
""".strip()
    
    try:
        resp = requests.post(
            OPENAI_CHAT_COMPLETIONS_URL,
            headers={
                "Authorization": f"Bearer {OPENAI_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": OPENAI_RECRUITER_MODEL,
                "temperature": 0.1,  # Low temperature for consistent corrections
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"Correct this recommendation text:\n\n{text}"},
                ],
            },
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        corrected = data["choices"][0]["message"]["content"].strip()
        
        # Log the correction for debugging
        if corrected != text:
            logger.info(f"[GrammarCorrection] Original: {text[:100]}...")
            logger.info(f"[GrammarCorrection] Corrected: {corrected[:100]}...")
        
        return corrected
    except Exception as e:
        logger.error(f"Grammar correction failed: {e}")
        # If correction fails, return original text
        return text


def classify_recruiter_answer(

    question_text: str,
    answer_text: str,
    section: str,
) -> Dict[str, Any]:
    """
    Classify a single recruiter answer using OpenAI.
    """
    question = (question_text or "").strip()
    answer = (answer_text or "").strip()
    section_key = (section or "").strip().lower()

    if not answer:
        return {
            "status": "not_confirmed",
            "confidence_level": "low",
            "extracted_skills": [],
            "notes": "Empty answer",
        }

    system_prompt = """
You are a data extraction assistant.
Analyze the User's Answer in response to the Question.

Task:
1. Identify if the user is Confirming, Denying, or Adding new skills.
2. Extract the specific items mentioned.

Output JSON:
{
  "status": "confirmed" | "not_confirmed" | "new_skill",
  "confidence_level": "high" | "medium" | "low",
  "extracted_skills": ["List", "of", "strings"],
  "notes": "Brief explanation"
}

Rules:
- **CRITICAL EXTRACTION RULE:** For Role, Project, Education, or Training, ALWAYS include the SOURCE/INSTITUTION/COMPANY if mentioned.
  * Example: Extract "AI Developer at Borek Solutions" instead of just "AI Developer"
  * Example: Extract "Bachelor's in Computer Science from MIT" instead of just "Bachelor's in Computer Science"
  * Example: Extract "AWS Certification from Amazon" instead of just "AWS Certification"
- **PROJECT EXPERIENCE - CRITICAL TAGGING RULES:** If the section is 'project_experience', you MUST prefix each extracted item with a tag:
  
  **TAGGING SYSTEM (REQUIRED FOR GROUPING):**
  * When the question asks about POSITION/TITLE/ROLE:
    - Prefix with "ROLE: "
    - Example: Extract "ROLE: AI Developer at Borek Solutions Group"
    - Example: Extract "ROLE: Senior Developer at Google"
  
  * When the question asks about DESCRIPTION/RESPONSIBILITIES or "what did they do":
    - Prefix with "DESC: "
    - Extract the COMPLETE, FULL TEXT of what the user said. DO NOT SUMMARIZE.
    - Example: Extract "DESC: Built the backend API and integrated payment systems"
    - Example: Extract "DESC: Developed AI models using Python and TensorFlow"
  
  * When the question asks about DURATION/TIME/YEARS or "how long":
    - Prefix with "TIME: "
    - Extract ANY time-related information from the answer
    - Year ranges: "TIME: 2024 to 2025", "TIME: from 2023 to 2024"
    - Relative durations: "TIME: 6 months", "TIME: 2 years"
    - Specific dates: "TIME: January 2024 to Present"
    - Extract EXACTLY what the user said, don't convert or change the format
  
  **IMPORTANT:**
  * If the user provides BOTH description AND duration in one answer (e.g., "Built APIs for 2 years"):
    - Extract TWO separate items: "DESC: Built APIs" AND "TIME: 2 years"
  * ALWAYS use the tags (ROLE:, DESC:, TIME:) - this is how the system groups them correctly
  * NEVER treat a description or duration as a new position
  * The tags are REQUIRED for the PDF generation to work correctly
- For Languages, include proficiency level if mentioned (e.g., "English - C1", "Spanish - Native").
- "confirmed": User agrees or confirms existing skills.
- "new_skill": User provides NEW info not asked in the question.
- "not_confirmed": User explicitly denies ("No, they don't know that").
- **CRITICAL:** If the User answers "No" to a question like "Do you have anything else?", this is NOT a denial of skill. It means they are done. Return status: "not_confirmed" but extracted_skills: [].
- **RECOMMENDATIONS SECTION - CRITICAL:** If the section is 'recommendations', you MUST extract the COMPLETE, FULL TEXT of what the user said. DO NOT SUMMARIZE. DO NOT SHORTEN. DO NOT EXTRACT KEYWORDS. Put the entire answer text verbatim into extracted_skills as a single string. The recommendation should be preserved exactly as spoken by the recruiter.
  * Example: If user says "I highly recommend this candidate as a detailed oriented software engineer he has consistently delivered high quality full stack Solutions", extract the ENTIRE sentence, not just "detailed oriented software engineer".
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
    except Exception as e:
        logger.error(f"OpenAI classification failed: {e}")
        return {
            "status": "partially_confirmed",
            "confidence_level": "low",
            "extracted_skills": [],
            "notes": "AI Classification Failed.",
        }

    status = str(parsed.get("status") or "partially_confirmed").strip()
    confidence = str(parsed.get("confidence_level") or "medium").strip().lower()
    extracted = parsed.get("extracted_skills") or []
    notes = str(parsed.get("notes") or "").strip()

    if not isinstance(extracted, list):
        extracted = []
    
    cleaned_skills = [s.strip() for s in extracted if isinstance(s, str) and s.strip()]
    
    # CRITICAL: For recommendations section, ALWAYS use the full answer text verbatim
    # This prevents the AI from summarizing or extracting keywords
    # Apply grammar correction to fix speech-to-text transcription errors
    if section_key == "recommendations" and answer.strip():
        # First, correct grammar and typos from speech-to-text transcription
        corrected_text = correct_recommendation_grammar(answer.strip())
        # Override whatever the AI extracted with the corrected full answer text
        cleaned_skills = [corrected_text]
        # If the user is providing a recommendation, it's always a new_skill
        if status not in ["not_confirmed"]:
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
    """
    logger.info(
        f"[generate_recruiter_next_question] Called with section={section}, history_length={len(history or [])}"
    )

    # Normalize history
    safe_history: List[Dict[str, str]] = []
    for item in history or []:
        role = str(item.get("role", "")).strip().lower()
        content = str(item.get("content", "")).strip()
        if role not in ("assistant", "recruiter") or not content:
            continue
        safe_history.append({"role": role, "content": content})
    
    # Track which sections have been asked about to prevent skipping
    sections_asked = set()
    for msg in safe_history:
        if msg.get("role") == "assistant":
            # Detect section mentions in assistant questions
            content_lower = msg.get("content", "").lower()
            if "recommendation" in content_lower:
                sections_asked.add("recommendations")
            elif "project" in content_lower and "experience" in content_lower:
                sections_asked.add("project_experience")
            elif "technical" in content_lower and "competenc" in content_lower:
                sections_asked.add("technical_competencies")
            elif "training" in content_lower or "certification" in content_lower:
                sections_asked.add("trainings_certifications")
            elif "education" in content_lower:
                sections_asked.add("education")
            elif "language" in content_lower:
                sections_asked.add("languages")
            elif "soft skill" in content_lower:
                sections_asked.add("soft_skills")
            elif "core skill" in content_lower:
                sections_asked.add("core_skills")

    user_payload: Dict[str, Any] = {
        "cv_text": cv_text or "",
        "competence_letter": competence_text or "",
        "current_section": section,
        "history": safe_history,
    }
    
    try:
        # BLOCKING: This is the API that returns the GPT response. We wait for the full
        # response (no streaming) before returning; called from stream_voice_to_question
        # only after Whisper has already returned.
        resp = requests.post(
            OPENAI_CHAT_COMPLETIONS_URL,
            headers={
                "Authorization": f"Bearer {OPENAI_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": OPENAI_RECRUITER_MODEL,
                "temperature": 0.4, # Increased slightly to allow for more varied phrasing
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
        content_raw = data["choices"][0]["message"]["content"]
        parsed = json.loads(content_raw)
    except Exception as e:
        logger.error(f"OpenAI generation failed: {e}")
        return {
            "question": "I'm having trouble connecting to the AI service. Please try again later.",
            "section": section,
            "complete_section": True,
            "done": True,
        }

    question = str(parsed.get("question") or "").strip()
    next_section = str(parsed.get("section") or section).strip()
    complete_section = bool(parsed.get("complete_section"))
    done = bool(parsed.get("done"))

    is_question_text = "?" in question

    # For additional_info, questions should not end the conversation.
    if section == "additional_info" and question and is_question_text and done:
        complete_section = False
        done = False

    # For additional_info, a non-question statement is treated as the closing message.
    if section == "additional_info" and question and not is_question_text:
        complete_section = True
        done = True

    # Strict Server-side Section Ordering Guardrail
    section_order = [
        "introduction",
        "core_skills",
        "soft_skills",
        "languages",
        "education",
        "trainings_certifications",
        "technical_competencies",
        "project_experience",
        "recommendations",
        "additional_info",
    ]

    if section not in section_order:
        section = "core_skills"

    if complete_section:
        try:
            idx = section_order.index(section)
        except ValueError:
            idx = 0
            
        if idx < len(section_order) - 1:
            next_section = section_order[idx + 1]
            
            # CRITICAL FIX: Force recommendations section if not asked yet
            if next_section == "additional_info" and "recommendations" not in sections_asked:
                next_section = "recommendations"
                question = "Great. Now, what can you tell me about their recommendations or references?"
                complete_section = False
                logger.info("[generate_recruiter_next_question] 🔒 FORCED recommendations section")
            # Ensure the AI provided a transition question. If not, generate a safe natural fallback.
            elif not question:
                 human_readable_next = next_section.replace('_', ' ').title()
                 if next_section == "additional_info":
                     question = "Is there anything else not in the CV that you would like to mention?"
                 else:
                     question = f"Great. Let's move on to {human_readable_next}. What can you tell me about that?"
        else:
            next_section = "additional_info"
            if section == "additional_info":
                 done = True

    # # If we are in recommendations, ensure the prompt explicitly asks for recommendations.
    # if (next_section or section) == "recommendations":
    #     question_lower = (question or "").lower()
    #     if not any(term in question_lower for term in ("recommendation", "reference")):
    #         question = "Great. Now, what can you tell me about their recommendations or references?"
    #         complete_section = False
    #         done = False
    #         logger.info("[generate_recruiter_next_question] 🔒 NORMALIZED recommendations prompt")

    if next_section != "additional_info" and section != "additional_info":
        done = False
    elif section == "additional_info" and done and not question:
        return {
            "question": "",
            "section": "additional_info",
            "complete_section": True,
            "done": True,
        }

    return {
        "question": question,
        "section": next_section or section,
        "complete_section": complete_section,
        "done": done,
    }


def generate_ai_voice(text: str) -> bytes:
    """
    Generate emotional AI voice using OpenAI's TTS API.
    Uses the 'shimmer' voice for an expressive, natural tone.
    
    Args:
        text: The text to convert to speech
        
    Returns:
        Binary audio content (MP3 format)
        
    Raises:
        Exception: If the API call fails
    """
    if not text or not text.strip():
        raise ValueError("Text cannot be empty")
    
    if not OPENAI_API_KEY:
        raise ValueError("OPENAI_API_KEY is not configured")
    
    try:
        resp = requests.post(
            OPENAI_AUDIO_SPEECH_URL,
            headers={
                "Authorization": f"Bearer {OPENAI_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": "tts-1",
                "voice": "shimmer",  # Expressive, warm female voice
                "speed": 1.1,
                "input": text.strip(),
            },
            timeout=60,
        )
        resp.raise_for_status()
        return resp.content
    except Exception as e:
        logger.error(f"OpenAI TTS generation failed: {e}")
        raise


def _ollama(prompt: str, *, model: str = OLLAMA_MODEL) -> str:
    """
    Minimal Ollama client.
    """
    headers = {}
    if OLLAMA_API_KEY:
        headers["Authorization"] = f"Bearer {OLLAMA_API_KEY}"

    start = time.monotonic()
    logger.info("Calling Ollama", extra={"model": model, "url": OLLAMA_URL})

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
    return full_out


def _extract_first_json_object(raw: str) -> Dict[str, Any]:
    """
    Helper to extract the first JSON object from a raw LLM string response.
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
    Competence summary prompt.
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

CV TEXT:
{cv_text}
""".strip()


def generate_competence_cv(cv_text: str) -> Dict[str, object]:
    """
    Call the LLaMA model with the given CV text.
    """
    if not cv_text or not cv_text.strip():
        return {"competence_summary": "", "skills": []}

    prompt = _build_competence_prompt(cv_text)
    
    raw = _ollama(prompt)
    data = _extract_first_json_object(raw)
    
    if not data:
        data = {}

    summary = data.get("competence_summary") or raw.strip()
    skills = data.get("skills") or []

    if not isinstance(skills, list):
        skills = []

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
# Structured CV generation
# ---------------------------------------------------------------------------

_STRUCTURED_CV_SCHEMA_EXAMPLE: Dict[str, Any] = {
    "name": "Candidate Full Name",
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


def _build_structured_cv_prompt(cv_text: str) -> str:
    """
    Prompt for generating a normalized CV JSON.
    """
    example_json = json.dumps(_STRUCTURED_CV_SCHEMA_EXAMPLE, indent=2)
    return f"""
You are an AI CV formatter.

TASK:
- Read the raw CV text carefully and extract ALL information.
- Extract the candidate's full name from the CV and place it in the "name" field.
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

OUTPUT FORMAT:
- Return exactly ONE JSON object.
- Do NOT include any markdown, comments, or additional text.

CV TEXT:
{cv_text}
""".strip()


def generate_structured_cv(cv_text: str) -> Dict[str, Any]:
    """
    Generate a normalized structured CV representation.
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
    
    # No fallback, strict AI
    raw = _ollama(prompt)
    data = _extract_first_json_object(raw)

    if not isinstance(data, dict):
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

    name = str(data.get("name") or "").strip()
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
    else:
        # Limit to max 3 languages
        languages = languages[:3]
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

    normalized_skills: List[str] = []
    for s in skills:
        if isinstance(s, str):
            s_clean = s.strip()
            if s_clean:
                normalized_skills.append(s_clean)

    skills_grouped: Dict[str, List[str]] = {}

    return {
        "name": name,
        "profile": profile,
        "languages": languages,
        "skills": normalized_skills,
        "skills_grouped": skills_grouped,
        "work_experience": work_experience,
        "education": education,
        "projects": projects,
        "courses": courses,
        "certifications": certifications,
    }


def _build_skill_grouping_prompt(skills: List[str]) -> str:
        """
        Prompt to group a flat skills list into up to 5 human-readable categories.
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

INPUT SKILLS:
{skills_str}
""".strip()


def group_skills_into_categories(skills: List[str]) -> Dict[str, List[str]]:
    """
    Use the LLM to group a flat list of skills.
    """
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
    
    raw = _ollama(prompt)
    data = _extract_first_json_object(raw)
    
    if not isinstance(data, dict):
        return {}

    groups_raw = data.get("groups") or []
    if not isinstance(groups_raw, list):
        return {}

    grouped: Dict[str, List[str]] = {}
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
            if s_clean.lower() not in seen:
                continue
            final_skills.append(s_clean)
        if final_skills:
            grouped[name] = final_skills

    return grouped


def stream_voice_to_question(
    audio_file,
    cv_text: str,
    competence_text: str,
    history: List[Dict[str, str]],
    section: str,
):
    """
    Generator for SSE: first yields transcription as JSON, then question_data.
    Caller should format each chunk as SSE (e.g. "data: {json}\\n\\n").
    """
    start_time = time.perf_counter()
    transcription_text = ""
    transcription_ms = 0.0

    try:
        t0 = time.perf_counter()
        result = transcribe_audio_whisper(audio_file)
        transcription_ms = (time.perf_counter() - t0) * 1000
        transcription_text = (result.get("text") or "").strip()
        logger.info(f"[stream_voice_to_question] transcribe_audio_whisper took {transcription_ms:.1f}ms")
    except ValueError as e:
        yield {"type": "error", "detail": str(e)}
        return
    except Exception as e:
        logger.error(f"[stream_voice_to_question] Transcription failed: {e}")
        yield {"type": "error", "detail": "Transcription failed"}
        return

    yield {
        "type": "transcription",
        "transcription": transcription_text,
        "backend_transcription_ms": round(transcription_ms, 1),
    }

    if not transcription_text:
        total_ms = (time.perf_counter() - start_time) * 1000
        logger.info(f"[stream_voice_to_question] total backend (transcription only) {total_ms:.1f}ms")
        yield {"type": "question_data", "question_data": None, "backend_thinking_ms": 0}
        return

    updated_history = list(history or [])
    updated_history.append({"role": "recruiter", "content": transcription_text})

    try:
        t1 = time.perf_counter()
        question_result = generate_recruiter_next_question(
            cv_text=cv_text or "",
            competence_text=competence_text or "",
            history=updated_history,
            section=section or "core_skills",
        )
        thinking_ms = (time.perf_counter() - t1) * 1000
        logger.info(f"[stream_voice_to_question] generate_recruiter_next_question took {thinking_ms:.1f}ms")
        total_ms = (time.perf_counter() - start_time) * 1000
        logger.info(f"[stream_voice_to_question] total backend processing {total_ms:.1f}ms")
        yield {
            "type": "question_data",
            "question_data": question_result,
            "backend_thinking_ms": round(thinking_ms, 1),
        }
    except Exception as e:
        logger.error(f"[stream_voice_to_question] Question generation failed: {e}")
        yield {"type": "error", "detail": "Failed to generate next question"}


def transcribe_audio_whisper(audio_file) -> Dict[str, str]:
    """
    Transcribe audio using OpenAI's Whisper API and validate language.
    
    Args:
        audio_file: File-like object containing audio data
        
    Returns:
        Dictionary with 'text' and 'language' keys
        
    Raises:
        ValueError: If the detected language is not English
        Exception: If the API call fails
    """
    if not OPENAI_API_KEY:
        raise ValueError("OPENAI_API_KEY is not configured")
    
    try:
        # Prepare the file for upload
        files = {
            'file': ('audio.webm', audio_file, 'audio/webm'),
        }
        
        data = {
            'model': 'whisper-1',
            'response_format': 'verbose_json',  # Get language detection info
        }
        
        resp = requests.post(
            "https://api.openai.com/v1/audio/transcriptions",
            headers={
                "Authorization": f"Bearer {OPENAI_API_KEY}",
            },
            files=files,
            data=data,
            timeout=60,
        )
        resp.raise_for_status()
        result = resp.json()
        
        # Extract text and language
        text = result.get('text', '').strip()
        language = result.get('language', 'unknown')
        
        # Handle empty transcription (no speech detected)
        if not text:
            logger.warning("No speech detected in audio")
            return {
                'text': '',
                'language': 'en',  # Assume English for empty audio
            }
        
        # Validate that the language is English
        language_lower = language.lower() if language else 'unknown'
        if language_lower != 'en' and language_lower != 'english':
            logger.warning(f"Non-English language detected: {language}")
            raise ValueError("I can understand English only")
        
        logger.info(f"Transcribed audio: language={language}, text_length={len(text)}")
        
        return {
            'text': text,
            'language': language_lower,
        }
        
    except ValueError:
        # Re-raise language validation errors
        raise
    except Exception as e:
        logger.error(f"Whisper transcription failed: {e}")
        raise