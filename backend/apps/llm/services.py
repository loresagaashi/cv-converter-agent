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
OPENAI_RECRUITER_MODEL = os.environ.get("OPENAI_RECRUITER_MODEL", "gpt-4o-mini")


# ---------------------------------------------------------------------------
# Recruiter voice assistant prompt (for realtime or chat usage)
# ---------------------------------------------------------------------------

RECRUITER_ASSISTANT_SYSTEM_PROMPT = """
AI Interview Confirmation Assistant

You are an AI assistant helping a recruiter CONFIRM information during a voice-style conversation.

You are NOT evaluating the candidate.
You are NOT interviewing deeply.
You are ONLY confirming accuracy.

SOURCE OF TRUTH (STRICT)
- Use ONLY the competence paper
- Do NOT extract anything from the CV
- Do NOT assume or infer
- Do NOT merge or invent skills

If something is not in the competence paper → mark as new_item.
If something exists but recruiter does not mention it → mark internally as not_confirmed.
Never tell the recruiter about internal flags.

OBJECTIVE
Confirm whether items in the competence paper reflect real experience.

APPROACH
- Ask ONE open-ended question per section
- Recruiter may list MULTIPLE items at once
- After recruiter provides an answer listing items:
  1. Understand the answer
  2. Match items with competence paper
  3. Acknowledge briefly (e.g., "Got it, those are confirmed.")
  4. IMMEDIATELY ask: "Do you have anything else?"
- If recruiter says "no", "that's all", "nothing else", etc. → Mark section complete and move to next section
- If recruiter lists more items → Process them, acknowledge, and ask "Do you have anything else?" again
- NEVER repeat the original question after receiving an answer

LIVE CONVERSATION STYLE
Sound human and natural.
Short spoken sentences.
Friendly reactions like:
- "Got it."
- "Alright."
- "Perfect."
- "I see."
- "That makes sense."

If unclear:
- "Sorry, I didn't catch that. Can you say it again?"
- "I didn't fully understand — could you repeat it?"

If different language:
- "Could you say that in English please?"

STRICT SECTION ORDER
1) Core Skills
2) Soft Skills
3) Languages
4) Education
5) Trainings & Certifications
6) Technical Competencies
7) Project Experience
8) Additional Information

Never skip.
Never return to a previous section.

DO NOT ask about "Our Recommendation".
This section is generated automatically later.

SECTION FLOW (MANDATORY)

For each section:

STEP 1 — Ask one open-ended question
Examples:
- "Based on your assessment, what is your experience with the candidate regarding their core skills?"
- "What can you tell me about the candidate's soft skills?"

Use candidate name from competence paper if available.
Otherwise say "the candidate".

STEP 2 — Wait for recruiter response

STEP 3 — Process response
CRITICAL: You MUST check each item the recruiter mentions against the competence paper.

For each item mentioned:
- If item EXISTS in competence paper → mark as confirmed
- If item does NOT exist in competence paper → mark as new_item

Acknowledge briefly:
- "Got it, those match what's listed." (if items are in competence paper)
- "Got it, I'll add those." (if items are new)
- "Got it, I see [confirmed items] are confirmed. I'll add [new items]." (if mix of both)

Do NOT list everything back.
Do NOT explain logic.

STEP 4 — Follow-up (CRITICAL)
After receiving ANY answer that lists items, you MUST:
1. Acknowledge what you heard (briefly)
2. IMMEDIATELY ask: "Do you have anything else?"

If the recruiter's answer contains completion signals like:
"no", "that's all", "nothing else", "no more", "nope", "that's it", "nothing more"
→ Mark the section as complete (set "complete_section": true) and move to the next section.

If the recruiter lists more items → Process them, acknowledge, and ask "Do you have anything else?" again.

IMPORTANT: After the recruiter provides an answer listing items, you MUST ask "Do you have anything else?" in your next response. Do NOT repeat the original question.

ADDITIONAL INFORMATION (FINAL SECTION)

When you reach the final "additional_info" section, ask:
"Is there any additional information from the interview that's not in the CV or competence paper?"

If new info appears:
- Automatically assign it to the correct section
- Mark as new_item
- Acknowledge briefly

Keep asking:
"Anything else to add?"

If recruiter gives a completion signal:
Return immediately:
{
  "question": "",
  "section": "additional_info",
  "complete_section": true,
  "done": true
}

INTRODUCTION
Start friendly and natural:
- "Hi! I'll help you confirm the information from the competence paper."
- "Alright, let's go through this together."

JSON OUTPUT ONLY

{
  "question": "",
  "section": "introduction | core_skills | soft_skills | languages | education | trainings_certifications | technical_competencies | project_experience | additional_info",
  "complete_section": true or false,
  "done": true or false
}

RULES
- "question" must NOT be empty while done = false
- No repeated questions
- No loops
- Always move forward

CRITICAL FLOW RULES:
1. After asking the initial question for a section, wait for recruiter's answer
2. When recruiter provides an answer listing items → Acknowledge + Ask "Do you have anything else?"
3. When recruiter says "no"/"that's all" → Set "complete_section": true and move to next section
4. NEVER ask the same question twice in a row
5. If you just asked "Do you have anything else?" and recruiter answered, check if it's a completion signal
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
    
    # Check if answer appears to be in a different language (non-English)
    # Simple heuristic: if answer contains mostly non-ASCII characters
    import re
    non_english_pattern = re.compile(r'[^\x00-\x7F]+')
    non_english_chars = len(non_english_pattern.findall(answer))
    if non_english_chars > 0 and non_english_chars > len(answer) * 0.3:
        return {
            "status": "not_confirmed",
            "confidence_level": "low",
            "extracted_skills": [],
            "notes": "Answer appears to be in a different language or unclear.",
        }

    # If OpenAI is not available, use rule-based heuristics.
    if not OPENAI_API_KEY:
        lowered = answer.lower()
        status = "partially_confirmed"
        if any(x in lowered for x in ["no", "not really", "don't think so", "do not think so"]):
            status = "not_confirmed"
        elif any(x in lowered for x in ["yes", "yeah", "yep", "they do", "they have", "correct"]):
            status = "confirmed"

        # For discovery/additional_info sections, treat any non-empty answer as new_skill.
        if section_key in {"additional_info"}:
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
- "extracted_skills": a list of short strings for ANY confirmed items mentioned (skills, languages, education, trainings, projects, etc.)
- "notes": short free-text justification

CRITICAL REASONING RULES:
- You MUST reason about the MEANING of the answer, not just look for "yes" or "no"
- If the recruiter says "the candidate is experienced in [skill]" or "they have [skill]" or "yes, they know [skill]" or any variation that indicates confirmation, mark as "confirmed"
- If the recruiter says "they don't have [skill]" or "no, they haven't worked with [skill]" or any variation that indicates denial, mark as "not_confirmed"
- If the recruiter provides information that confirms the skill/item (e.g., "yes, they use C# regularly" or "the candidate is experienced in c-sharp"), this is a CONFIRMATION, not "not_confirmed"
- Only mark as "not_confirmed" if the recruiter explicitly denies or says the information is incorrect
- If the answer is unclear or ambiguous, mark as "partially_confirmed" with confidence "low"

CRITICAL: For "extracted_skills", extract the ACTUAL confirmed items from the question or answer:
- If the question asks about "Java" and recruiter confirms (in any way), include "Java" in extracted_skills
- If the question asks about "C#" or "C-sharp" or "c-sharp" and recruiter confirms, include "C#" in extracted_skills
- If the question asks about "English C2" and recruiter confirms, include "English C2" in extracted_skills
- If the question asks about "Data Analyst in Python – DataCamp (30 Oct 2025)" and recruiter confirms, include the full original text in extracted_skills
- For languages: include the language name and level (e.g., "English C2", "Albanian")
- For education/trainings: include the full original text from the competence paper
- For projects: include the full position/role name as listed
- For SOFT SKILLS: If the question is open-ended (e.g., "What can you tell me about soft skills?"), extract the soft skills mentioned in the ANSWER itself (e.g., "communicative", "teamwork", "works well in a team", "good communication skills", etc.)
- For SOFT SKILLS: Extract each distinct soft skill mentioned, even if the question doesn't list specific skills

IMPORTANT: 
- If the answer is in a language other than English or is unclear, set confidence_level to "low" and status to "not_confirmed" or "partially_confirmed"
- Use "new_skill" when the recruiter clearly adds information that was not explicitly in the original CV/competence paper or when the section is for additional/discovery information
- In "additional_info" section, if the recruiter mentions something NEW (not in CV/competence paper), it should be marked as "new_skill" - do NOT assume it's already in the competence paper

EXAMPLES:
- Question: "Has the candidate worked with C#?"
- Answer: "Yes, the candidate is experienced in c-sharp"
- Status: "confirmed" (because the answer confirms the skill, even if worded differently)

- Question: "Has the candidate worked with Java?"
- Answer: "They have strong Java experience"
- Status: "confirmed" (because the answer confirms the skill)

- Question: "Has the candidate worked with Python?"
- Answer: "No, they haven't used Python"
- Status: "not_confirmed" (because the answer explicitly denies)

Return JSON only.
""".strip()

    user_payload: Dict[str, Any] = {
        "question": question,
        "answer": answer,
        "section": section_key,
    }
    
    # Add instruction to extract full original text
    user_payload["instruction"] = (
        "Extract the FULL original item text from the question. "
        "For example, if the question mentions 'Data Analyst in Python – DataCamp (30 Oct 2025)', "
        "extract the entire phrase, not just 'Python' or 'Data Analyst'. "
        "If the question mentions 'English C2', extract 'English C2', not just 'English'. "
        "Preserve the exact format and details from the original competence paper."
    )

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
        if section_key in {"additional_info"}:
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
    
    # For soft_skills section, be more lenient - accept medium confidence as high
    # This ensures soft skills are stored even with medium confidence
    if section_key == "soft_skills" and confidence == "medium":
        confidence = "high"
        logger.info(f"[classify_recruiter_answer] Adjusted confidence for soft_skills from medium to high")

    extracted = parsed.get("extracted_skills") or []
    if not isinstance(extracted, list):
        extracted = []
    cleaned_skills: List[str] = []
    # Filter out questions and follow-up phrases
    question_indicators = [
        "based on your assessment", "what is your experience", "what can you tell me",
        "do you have anything else", "is there anything else", "anything more",
        "let's talk about", "now let's move", "which", "should we confirm",
        "got it", "alright", "perfect", "i see"
    ]
    for s in extracted:
        if isinstance(s, str):
            s_clean = s.strip()
            if s_clean:
                s_lower = s_clean.lower()
                # Skip if it looks like a question, follow-up phrase, or is too short
                is_question = (
                    any(indicator in s_lower for indicator in question_indicators) or 
                    s_clean.endswith('?') or
                    len(s_clean) < 2
                )
                if not is_question:
                    cleaned_skills.append(s_clean)

    notes = str(parsed.get("notes") or "").strip()

    # For discovery/additional_info sections, bias status towards new_skill if we have
    # at least one extracted skill.
    # But filter out completion signals - they should not be stored as skills
    if section_key in {"additional_info"} and cleaned_skills and status != "not_confirmed":
        completion_signals = [
            "no", "nope", "nothing else", "that's all", "that is all", 
            "that's enough", "that is enough", "no more", "nothing more",
            "that's it", "that is it", "no additional", "no other"
        ]
        # Remove completion signals from cleaned_skills
        filtered_skills = [
            skill for skill in cleaned_skills 
            if skill.lower().strip() not in completion_signals
        ]
        if filtered_skills:
            cleaned_skills = filtered_skills
            status = "new_skill"
        else:
            # If only completion signals, mark as not_confirmed so nothing is stored
            cleaned_skills = []
            status = "not_confirmed"
    
    # SPECIAL HANDLING FOR SOFT SKILLS: If extracted_skills is empty but status is confirmed/partially_confirmed,
    # try to extract soft skills from the answer text itself
    if section_key == "soft_skills" and not cleaned_skills and status in {"confirmed", "partially_confirmed"}:
        # Try to extract soft skills from the answer
        answer_lower = answer.lower()
        soft_skill_keywords = {
            "Communication": ["communicative", "communication", "communicates", "communicating", "good communication"],
            "Teamwork": ["team", "teamwork", "works well in a team", "team player", "collaborative", "collaboration"],
            "Leadership": ["leader", "leadership", "leads", "leading"],
            "Problem Solving": ["problem solving", "problem-solving", "solves problems", "analytical"],
            "Adaptability": ["adaptable", "adaptability", "flexible", "flexibility"],
            "Time Management": ["time management", "manages time", "punctual", "punctuality"],
            "Creativity": ["creative", "creativity", "innovative", "innovation"],
            "Work Ethic": ["work ethic", "hardworking", "dedicated", "dedication", "reliable"],
        }
        
        extracted_soft_skills = []
        for skill_name, keywords in soft_skill_keywords.items():
            if any(keyword in answer_lower for keyword in keywords):
                extracted_soft_skills.append(skill_name)
        
        # If we found soft skills, use them
        if extracted_soft_skills:
            cleaned_skills = extracted_soft_skills
            logger.info(f"[classify_recruiter_answer] Extracted soft skills from answer: {cleaned_skills}")
        # If still no skills found, use a cleaned version of the answer as fallback
        elif answer.strip():
            # Clean the answer and use it as the skill (for soft skills, descriptive answers are acceptable)
            cleaned_answer = answer.strip()
            # Remove common phrases
            for phrase in ["the candidate", "they are", "they're", "the person", "he is", "she is", "he's", "she's"]:
                cleaned_answer = cleaned_answer.replace(phrase, "").strip()
            # Capitalize first letter
            if cleaned_answer:
                cleaned_answer = cleaned_answer[0].upper() + cleaned_answer[1:] if len(cleaned_answer) > 1 else cleaned_answer.upper()
                cleaned_skills = [cleaned_answer]
                logger.info(f"[classify_recruiter_answer] Using answer text as soft skill: {cleaned_skills}")
    
    # LOWER CONFIDENCE THRESHOLD: Accept ALL confidence levels if status is confirmed/partially_confirmed
    # If recruiter mentions something, we trust them - store it regardless of confidence
    if status in {"confirmed", "partially_confirmed", "new_skill"}:
        # Upgrade low confidence to medium to ensure items are stored
        if confidence == "low":
            confidence = "medium"
            logger.info(f"[classify_recruiter_answer] Upgraded confidence from low to medium for section {section_key} to ensure storage")
        # For soft_skills, always upgrade to high if we have skills to store
        if section_key == "soft_skills" and cleaned_skills and confidence in {"medium", "low"}:
            confidence = "high"
            logger.info(f"[classify_recruiter_answer] Upgraded confidence to high for soft_skills to ensure storage")

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
    logger.info(
        f"[generate_recruiter_next_question] Called with section={section}, history_length={len(history or [])}"
    )
    
    # Defensive fallback if OpenAI is not configured.
    if not OPENAI_API_KEY:
        logger.warning("[generate_recruiter_next_question] OpenAI API key not configured")
        return {
            "question": "",
            "section": section,
            "complete_section": True,
            "done": True,
        }

    # Normalize history into a safe, compact structure.
    safe_history: List[Dict[str, str]] = []
    last_recruiter_answer = ""
    last_assistant_question = ""
    for item in history or []:
        role = str(item.get("role", "")).strip().lower()
        content = str(item.get("content", "")).strip()
        if role not in ("assistant", "recruiter") or not content:
            continue
        safe_history.append({"role": role, "content": content})
        if role == "recruiter":
            last_recruiter_answer = content
        elif role == "assistant":
            last_assistant_question = content
    
    # Check conversation state to determine next action
    if last_recruiter_answer and last_assistant_question:
        answer_lower = last_recruiter_answer.lower()
        question_lower = last_assistant_question.lower()
        completion_signals = [
            "no", "nope", "nothing else", "that's all", "that is all", 
            "that's enough", "that is enough", "no more", "nothing more",
            "that's it", "that is it", "no additional", "no other"
        ]
        followup_questions = [
            "do you have anything else", "anything else", "is there anything else",
            "anything more", "anything more to add", "is there anything more"
        ]
        
        # Check if last question was asking about "additional information" (but NOT the final additional_info section)
        # This prevents "no" from skipping sections when asked as a follow-up
        is_additional_info_followup = (
            ("additional information" in question_lower or "additional info" in question_lower) and
            section != "additional_info"
        )
        
        # Check if last question was a follow-up question
        is_followup_question = any(fq in question_lower for fq in followup_questions)
        
        # If assistant asked about "additional information" as a follow-up (not the final section), 
        # treat "no" as a completion signal for the CURRENT section, not skip to next
        if is_additional_info_followup:
            answer_stripped = answer_lower.strip()
            is_completion = any(
                signal == answer_stripped or 
                answer_stripped.startswith(signal + " ") or 
                answer_stripped == signal 
                for signal in completion_signals
            )
            if is_completion:
                # Mark current section as complete and move to next
                logger.info(
                    f"[generate_recruiter_next_question] Detected 'no' to additional info follow-up, completing section: "
                    f"section={section}, answer='{last_recruiter_answer}'"
                )
                section_order = [
                    "introduction",
                    "core_skills",
                    "soft_skills",
                    "languages",
                    "education",
                    "trainings_certifications",
                    "technical_competencies",
                    "project_experience",
                    "additional_info",
                ]
                try:
                    idx = section_order.index(section)
                    if idx < len(section_order) - 1:
                        next_section = section_order[idx + 1]
                        return {
                            "question": f"Based on your assessment, what is your experience with the candidate regarding their {next_section.replace('_', ' ')}?",
                            "section": next_section,
                            "complete_section": False,
                            "done": False,
                        }
                except ValueError:
                    pass
        
        # If assistant asked follow-up and recruiter gave completion signal
        # IMPORTANT: Only process if NOT in additional_info (additional_info is handled separately above)
        if is_followup_question and section != "additional_info" and not is_additional_info_followup:
            # Check if answer is ONLY a completion signal (exact match or starts with signal)
            answer_stripped = answer_lower.strip()
            is_completion = any(
                signal == answer_stripped or 
                answer_stripped.startswith(signal + " ") or 
                answer_stripped == signal 
                for signal in completion_signals
            )
            if is_completion:
                logger.info(
                    f"[generate_recruiter_next_question] Detected completion signal after follow-up: "
                    f"section={section}, answer='{last_recruiter_answer}'"
                )
                # Move to next section
                section_order = [
                    "introduction",
                    "core_skills",
                    "soft_skills",
                    "languages",
                    "education",
                    "trainings_certifications",
                    "technical_competencies",
                    "project_experience",
                    "additional_info",
                ]
                try:
                    idx = section_order.index(section)
                    if idx < len(section_order) - 1:
                        next_section = section_order[idx + 1]
                        # Return question for next section
                        return {
                            "question": f"Based on your assessment, what is your experience with the candidate regarding their {next_section.replace('_', ' ')}?",
                            "section": next_section,
                            "complete_section": False,
                            "done": False,
                        }
                except ValueError:
                    pass
        
        # If last question was NOT a follow-up (was initial question) and recruiter answered
        # The AI should ask "Do you have anything else?" - but we'll let the prompt handle this
        # However, if recruiter already gave completion signal, we should move forward
        # IMPORTANT: Only process if NOT in additional_info (additional_info is handled separately above)
        if not is_followup_question and section != "additional_info":
            answer_stripped = answer_lower.strip()
            is_completion = any(
                signal == answer_stripped or 
                answer_stripped.startswith(signal + " ") or 
                answer_stripped == signal 
                for signal in completion_signals
            )
            if is_completion:
                # Recruiter said "no" to initial question - move to next section
                logger.info(
                    f"[generate_recruiter_next_question] Recruiter gave completion signal to initial question: "
                    f"section={section}, answer='{last_recruiter_answer}'"
                )
                section_order = [
                    "introduction",
                    "core_skills",
                    "soft_skills",
                    "languages",
                    "education",
                    "trainings_certifications",
                    "technical_competencies",
                    "project_experience",
                    "additional_info",
                ]
                try:
                    idx = section_order.index(section)
                    if idx < len(section_order) - 1:
                        next_section = section_order[idx + 1]
                        return {
                            "question": f"Based on your assessment, what is your experience with the candidate regarding their {next_section.replace('_', ' ')}?",
                            "section": next_section,
                            "complete_section": False,
                            "done": False,
                        }
                except ValueError:
                    pass
    
    # Check if we're in additional_info section and the last answer indicates completion
    # CRITICAL: This must be checked BEFORE any other processing to prevent "no" from being used for next section
    if section == "additional_info" and last_recruiter_answer:
        answer_lower = last_recruiter_answer.lower().strip()
        completion_signals = [
            "no", "nope", "nothing else", "that's all", "that is all", 
            "that's enough", "that is enough", "no more", "nothing more",
            "that's it", "that is it", "no additional", "no other"
        ]
        # Check if the answer is ONLY a completion signal (not mixed with other content)
        # This prevents "no" from being extracted as a skill
        if any(signal == answer_lower or answer_lower.startswith(signal + " ") or answer_lower == signal for signal in completion_signals):
            logger.info(
                f"[generate_recruiter_next_question] Detected completion signal in additional_info: '{last_recruiter_answer}'"
            )
            return {
                "question": "",
                "section": "additional_info",
                "complete_section": True,
                "done": True,
            }
    
    # Also check if last question was about additional_info and answer was completion signal
    # This prevents the "no" from being processed when we're already done
    if last_assistant_question and last_recruiter_answer:
        question_lower = last_assistant_question.lower()
        answer_lower = last_recruiter_answer.lower().strip()
        if "additional information" in question_lower or "additional_info" in question_lower:
            completion_signals = [
                "no", "nope", "nothing else", "that's all", "that is all", 
                "that's enough", "that is enough", "no more", "nothing more",
                "that's it", "that is it", "no additional", "no other"
            ]
            if any(signal == answer_lower or answer_lower.startswith(signal + " ") or answer_lower == signal for signal in completion_signals):
                logger.info(
                    f"[generate_recruiter_next_question] Detected completion signal for additional_info, ending flow"
                )
                return {
                    "question": "",
                    "section": "additional_info",
                    "complete_section": True,
                    "done": True,
                }

    # The assistant is responsible for managing its own section progression,
    # but we still pass through the current section for context.
    user_payload: Dict[str, Any] = {
        "cv_text": cv_text or "",
        "competence_letter": competence_text or "",
        "current_section": section,
        "history": safe_history,
    }
    
    # CRITICAL: Check if recruiter just answered and force follow-up BEFORE calling AI
    if last_recruiter_answer and last_assistant_question:
        question_lower = last_assistant_question.lower()
        followup_questions = [
            "do you have anything else", "anything else", "is there anything else",
            "anything more", "anything more to add", "is there anything more"
        ]
        is_followup = any(fq in question_lower for fq in followup_questions)
        
        if not is_followup and last_recruiter_answer:
            # Recruiter just answered the initial question
            answer_lower = last_recruiter_answer.lower()
            completion_signals = [
                "no", "nope", "nothing else", "that's all", "that is all", 
                "that's enough", "that is enough", "no more", "nothing more",
                "that's it", "that is it", "no additional", "no other"
            ]
            
            if any(signal in answer_lower for signal in completion_signals):
                # Recruiter said "no" or completion signal - move to next section
                logger.info(
                    f"[generate_recruiter_next_question] Recruiter gave completion signal, moving to next section: "
                    f"section={section}, answer='{last_recruiter_answer}'"
                )
                section_order = [
                    "introduction",
                    "core_skills",
                    "soft_skills",
                    "languages",
                    "education",
                    "trainings_certifications",
                    "technical_competencies",
                    "project_experience",
                    "additional_info",
                ]
                try:
                    idx = section_order.index(section)
                    if idx < len(section_order) - 1:
                        next_section = section_order[idx + 1]
                        section_label = next_section.replace("_", " ")
                        # Special handling for additional_info section - use correct wording
                        if next_section == "additional_info":
                            return {
                                "question": "Is there any additional information from the interview that's not in the CV or competence paper?",
                                "section": next_section,
                                "complete_section": False,
                                "done": False,
                            }
                        return {
                            "question": f"Based on your assessment, what is your experience with the candidate regarding their {section_label}?",
                            "section": next_section,
                            "complete_section": False,
                            "done": False,
                        }
                except ValueError:
                    pass
            else:
                # Recruiter provided items - FORCE follow-up question immediately
                logger.info(
                    f"[generate_recruiter_next_question] Forcing follow-up question: "
                    f"section={section}, answer='{last_recruiter_answer[:50]}...'"
                )
                return {
                    "question": "Got it. Do you have anything else?",
                    "section": section,
                    "complete_section": False,
                    "done": False,
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
    # - Never allow the flow to be marked done unless we're in the final "additional_info" section.
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
        "additional_info",
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
            # Special handling for additional_info section - use correct wording
            if next_section == "additional_info" and not question:
                question = "Is there any additional information from the interview that's not in the CV or competence paper?"
        else:
            # After project_experience, always move to additional_info
            next_section = "additional_info"
            if not question:
                question = "Is there any additional information from the interview that's not in the CV or competence paper?"
    
    # Force transition to additional_info after project_experience if not already there
    if section == "project_experience" and complete_section and next_section != "additional_info":
        next_section = "additional_info"
        logger.info(f"[generate_recruiter_next_question] Forcing transition to additional_info after project_experience")

    # Do not allow "done" to be true outside the final additional_info section.
    # However, if we're already in additional_info and done was set, keep it.
    if next_section != "additional_info" and section != "additional_info":
        done = False
    elif section == "additional_info" and done:
        # If we're in additional_info and done is true, ensure we return properly
        logger.info(f"[generate_recruiter_next_question] Done=true in additional_info section, completing flow")
        return {
            "question": "",
            "section": "additional_info",
            "complete_section": True,
            "done": True,
        }

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
            "additional_info": "Do you have any additional information from the interview that's not in the CV or competence paper?",
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


