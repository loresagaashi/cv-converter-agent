import logging
import re
import tempfile
from pathlib import Path

from django.conf import settings
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

logger = logging.getLogger(__name__)

from apps.cv.models import CV
from apps.interview.models import (
    CompetencePaper,
    ConversationCompetencePaper,
    ConversationQuestion,
    ConversationResponse,
    ConversationSession,
)
from apps.interview.pdf_utils import render_conversation_paper_to_pdf
from apps.interview.serializers import (
    CompetencePaperListSerializer,
    CompetencePaperSerializer,
    ConversationCompetencePaperSerializer,
)
from apps.interview.services import (
    can_user_access_conversation_paper,
    can_user_access_paper,
    can_user_delete_conversation_paper,
    can_user_delete_paper,
    get_competence_papers_for_user,
    get_conversation_competence_papers_for_user,
)
from apps.llm.services import classify_recruiter_answer


class CompetencePaperListView(APIView):
    """
    List all stored competence papers for a CV.
    """
    
    permission_classes = [IsAuthenticated]
    
    def get(self, request, cv_id):
        # Admins can access any CV; regular users only their own
        if getattr(request.user, 'is_staff', False):
            cv_instance = get_object_or_404(CV, pk=cv_id)
        else:
            cv_instance = get_object_or_404(CV, pk=cv_id, user=request.user)
        
        # Get all original competence papers for this CV
        competence_papers = CompetencePaper.objects.filter(
            cv=cv_instance
        ).order_by('-created_at')
        
        serializer = CompetencePaperListSerializer(competence_papers, many=True)
        
        return Response({
            "cv_id": cv_instance.id,
            "papers": serializer.data,
            "count": len(serializer.data),
        }, status=status.HTTP_200_OK)


class CompetencePaperDetailView(APIView):
    """
    Retrieve a specific stored competence paper by ID.
    """
    
    permission_classes = [IsAuthenticated]
    
    def get(self, request, paper_id):
        competence_paper = get_object_or_404(CompetencePaper, pk=paper_id)
        
        # Verify the user has permission to access this paper
        if not can_user_access_paper(request.user, competence_paper):
            return Response(
                {"detail": "You don't have permission to access this competence paper."},
                status=status.HTTP_403_FORBIDDEN,
            )
        
        serializer = CompetencePaperListSerializer(competence_paper)
        return Response(serializer.data, status=status.HTTP_200_OK)


class AllCompetencePapersView(APIView):
    """
    List all stored competence papers for the authenticated user (across all CVs).
    """
    
    permission_classes = [IsAuthenticated]
    
    def get(self, request):
        # Get original competence papers using service function
        competence_papers = get_competence_papers_for_user(request.user)
        
        # Serialize with full information (including CV and user details)
        serializer = CompetencePaperSerializer(competence_papers, many=True)
        
        return Response({
            "papers": serializer.data,
            "count": len(serializer.data),
        }, status=status.HTTP_200_OK)


class CompetencePaperDeleteView(APIView):
    """
    Delete a specific stored competence paper by ID.
    """
    
    permission_classes = [IsAuthenticated]
    
    def delete(self, request, paper_id):
        competence_paper = get_object_or_404(CompetencePaper, pk=paper_id)
        
        # Verify the user has permission to delete this paper
        if not can_user_delete_paper(request.user, competence_paper):
            return Response(
                {"detail": "You don't have permission to delete this competence paper."},
                status=status.HTTP_403_FORBIDDEN,
            )
        
        competence_paper.delete()
        
        return Response(
            {"detail": "Competence paper deleted successfully."},
            status=status.HTTP_200_OK
        )


class AllConversationCompetencePapersView(APIView):
    """
    List all conversation-based competence papers for the authenticated user (across all CVs).
    """
    
    permission_classes = [IsAuthenticated]
    
    def get(self, request):
        # Get conversation-based competence papers using service function
        conversation_papers = get_conversation_competence_papers_for_user(request.user)
        
        # Serialize with full information (including CV and user details)
        serializer = ConversationCompetencePaperSerializer(conversation_papers, many=True)
        
        return Response({
            "papers": serializer.data,
            "count": len(serializer.data),
        }, status=status.HTTP_200_OK)


class ConversationCompetencePaperDetailView(APIView):
    """
    Retrieve a specific conversation-based competence paper by ID.
    """
    
    permission_classes = [IsAuthenticated]
    
    def get(self, request, paper_id):
        conversation_paper = get_object_or_404(ConversationCompetencePaper, pk=paper_id)
        
        # Verify the user has permission to access this paper
        if not can_user_access_conversation_paper(request.user, conversation_paper):
            return Response(
                {"detail": "You don't have permission to access this competence paper."},
                status=status.HTTP_403_FORBIDDEN,
            )
        
        serializer = ConversationCompetencePaperSerializer(conversation_paper)
        return Response(serializer.data, status=status.HTTP_200_OK)


class ConversationCompetencePaperDeleteView(APIView):
    """
    Delete a specific conversation-based competence paper by ID.
    """
    
    permission_classes = [IsAuthenticated]
    
    def delete(self, request, paper_id):
        conversation_paper = get_object_or_404(ConversationCompetencePaper, pk=paper_id)
        
        # Verify the user has permission to delete this paper
        if not can_user_delete_conversation_paper(request.user, conversation_paper):
            return Response(
                {"detail": "You don't have permission to delete this competence paper."},
                status=status.HTTP_403_FORBIDDEN,
            )
        
        conversation_paper.delete()
        
        return Response(
            {"detail": "Conversation competence paper deleted successfully."},
            status=status.HTTP_200_OK
        )


class ConversationSessionStartView(APIView):
    """
    Ensure there is a ConversationSession for the given CV + original competence paper.

    Returns an existing pending/in-progress session or creates a new one.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        cv_id = request.data.get("cv_id")
        paper_id = request.data.get("paper_id")

        logger.info(
            f"[ConversationSessionStartView] 📥 POST request: cv_id={cv_id}, paper_id={paper_id}, user={request.user.id}"
        )

        if not isinstance(cv_id, int) or not isinstance(paper_id, int):
            logger.warning(f"[ConversationSessionStartView] ❌ Invalid request data types")
            return Response(
                {"detail": "cv_id (int) and paper_id (int) are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )


        # Admins can access any CV; regular users only their own
        if getattr(request.user, 'is_staff', False):
            cv_instance = get_object_or_404(CV, pk=cv_id)
        else:
            cv_instance = get_object_or_404(CV, pk=cv_id, user=request.user)
        competence_paper = get_object_or_404(CompetencePaper, pk=paper_id, cv=cv_instance)


        session = (
            ConversationSession.objects.filter(
                cv=cv_instance,
                original_competence_paper=competence_paper,
            )
            .exclude(status="completed")
            .order_by("-created_at")
            .first()
        )

        if session is None:
            session = ConversationSession.objects.create(
                cv=cv_instance,
                original_competence_paper=competence_paper,
                status="in_progress",
            )
            logger.info(f"[ConversationSessionStartView] ✅ Created new session: id={session.id}")
        else:
            if session.status != "in_progress":
                session.status = "in_progress"
                session.completed_at = None
                session.save(update_fields=["status", "completed_at"])
            logger.info(f"[ConversationSessionStartView] ✅ Using existing session: id={session.id}, status={session.status}")

        return Response(
            {
                "session_id": session.id,
                "status": session.status,
            },
            status=status.HTTP_200_OK,
        )


class ConversationTurnView(APIView):
    """
    Store a single conversation turn (question + answer) for a session,
    and classify the recruiter answer.

    Payload:
    - session_id: int
    - section: str (e.g., "core_skills", "soft_skills", ...)
    - phase: "validation" | "discovery" (default: "validation")
    - question_text: str
    - answer_text: str
    """

    permission_classes = [IsAuthenticated]

    SECTION_CATEGORY_MAP = {
        "core_skills": "skill",
        "soft_skills": "skill",
        "languages": "language",
        "education": "education",
        "trainings_certifications": "training",
        "technical_competencies": "skill",
        "project_experience": "project",
        "recommendations": "recommendation",
        "additional_info": "discovery",
    }

    def post(self, request):
        data = request.data or {}
        session_id = data.get("session_id")
        section = (data.get("section") or "").strip()
        phase = (data.get("phase") or "validation").strip()
        question_text = (data.get("question_text") or "").strip()
        answer_text = (data.get("answer_text") or "").strip()

        logger.info(
            f"[ConversationTurnView] 📥 POST request received: session_id={session_id}, "
            f"section={section}, phase={phase}, question_length={len(question_text)}, answer_length={len(answer_text)}"
        )

        if not isinstance(session_id, int):
            logger.warning(f"[ConversationTurnView] ❌ Invalid session_id type: {type(session_id)}")
            return Response(
                {"detail": "session_id (int) is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not section:
            logger.warning(f"[ConversationTurnView] ❌ Missing section")
            return Response(
                {"detail": "section is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            session = ConversationSession.objects.get(pk=session_id)
            logger.info(f"[ConversationTurnView] ✅ Found session: id={session.id}, status={session.status}, cv_id={session.cv.id}")
        except ConversationSession.DoesNotExist:
            logger.error(f"[ConversationTurnView] ❌ Session not found: session_id={session_id}")
            return Response(
                {"detail": f"No ConversationSession matches the given query (id={session_id})."},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Permission check: only owner (or staff via standard DRF auth) can write.
        if session.cv.user != request.user and not getattr(request.user, "is_staff", False):
            return Response(
                {"detail": "You don't have permission to modify this conversation session."},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Derive category from section.
        category = self.SECTION_CATEGORY_MAP.get(section, "other")

        # Strict section validation: only allow known sections
        allowed_sections = set(self.SECTION_CATEGORY_MAP.keys())
        if section not in allowed_sections:
            logger.warning(f"[ConversationTurnView] ❌ Invalid or unknown section: {section}")
            return Response(
                {"detail": f"Invalid section: {section}. Must be one of: {', '.join(allowed_sections)}."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Compute next question_order.
        last_q = (
            ConversationQuestion.objects.filter(session=session)
            .order_by("-question_order")
            .first()
        )
        next_order = 1 if last_q is None else (last_q.question_order + 1)

        # Topic: short identifier of what is being asked about.
        topic = question_text[:255]

        # Log the incoming turn data
        logger.info(
            f"[ConversationTurn] 📥 Received turn: session_id={session_id}, section={section}, "
            f"phase={phase}, question_preview='{question_text[:50]}...', answer_preview='{answer_text[:50]}...'"
        )

        # Classify the answer using the LLM helper with safe fallback.
        logger.debug(f"[ConversationTurn] Classifying answer for section={section}")
        classification = classify_recruiter_answer(
            question_text=question_text,
            answer_text=answer_text,
            section=section,
        )
        logger.info(
            f"[ConversationTurn] Classification result: status={classification.get('status')}, "
            f"confidence={classification.get('confidence_level')}, "
            f"extracted_skills={len(classification.get('extracted_skills', []))}"
        )

        status_value = classification.get("status") or "partially_confirmed"
        confidence_level = classification.get("confidence_level")
        extracted_skills = classification.get("extracted_skills") or []
        notes = classification.get("notes") or ""

        # Log before creating records
        logger.info(
            f"[ConversationTurn] Storing turn for session_id={session_id}, section={section}, phase={phase}, "
            f"question_order={next_order}, status={status_value}"
        )
        logger.debug(
            f"[ConversationTurn] Question: {question_text[:100]}... | Answer: {answer_text[:100]}..."
        )

        # Create question + response records.
        try:
            question = ConversationQuestion.objects.create(
                session=session,
                section=section,
                category=category,
                topic=topic,
                question_text=question_text,
                question_order=next_order,
                phase="discovery" if phase == "discovery" else "validation",
            )
            logger.info(f"[ConversationTurn] ✅ Question created: question_id={question.id}, section={question.section}")

            response = ConversationResponse.objects.create(
                question=question,
                answer_text=answer_text,
                status=status_value,
                confidence_level=confidence_level or None,
                extracted_skills=extracted_skills,
                notes=notes,
            )
            logger.info(
                f"[ConversationTurn] ✅ Response created: response_id={response.id}, "
                f"status={response.status}, confidence={response.confidence_level}, "
                f"extracted_skills_count={len(extracted_skills)}"
            )

            # Log total questions/responses for this session
            total_questions = ConversationQuestion.objects.filter(session=session).count()
            total_responses = ConversationResponse.objects.filter(question__session=session).count()
            logger.info(
                f"[ConversationTurn] Session {session_id} now has {total_questions} questions and {total_responses} responses"
            )

        except Exception as e:
            logger.error(f"[ConversationTurn] ❌ Failed to create question/response: {str(e)}", exc_info=True)
            raise

        return Response(
            {
                "question_id": question.id,
                "response_id": response.id,
                "status": response.status,
                "confidence_level": response.confidence_level,
                "extracted_skills": response.extracted_skills,
            },
            status=status.HTTP_201_CREATED,
        )


class ConversationSessionGeneratePaperView(APIView):
    """
    Generate a conversation-based competence paper for a session.

    Includes only:
    - Items confirmed during interview (status = confirmed / partially_confirmed)
    - Items added during interview (status = new_skill, including discovery phase)

    Excludes:
    - Items explicitly marked not_confirmed
    """

    permission_classes = [IsAuthenticated]

    SECTION_LABELS = {
        "core_skills": "Core Skills",
        "soft_skills": "Soft Skills",
        "languages": "Languages",
        "education": "Education",
        "trainings_certifications": "Trainings & Certifications",
        "technical_competencies": "Technical Competencies",
        "project_experience": "Project Experience",
        "recommendations": "Recommendations",
    }
    
    def _extract_item_from_question(self, question_text: str, section: str) -> str:
        """
        Extract the actual skill/item name from a question.
        Questions are typically like:
        - "The competence paper lists Java. Is it correct that..."
        - "Has the candidate worked with Spring Boot as listed?"
        - "English is listed at C1 level. Is this accurate..."
        """
        if not question_text:
            return ""
        
        # Pattern 1: "The competence paper lists X. Is it correct..."
        match = re.search(r'lists\s+([^.]+?)(?:\.|,|\?|$)', question_text, re.IGNORECASE)
        if match:
            item = match.group(1).strip()
            # Remove trailing punctuation
            item = re.sub(r'[.,;:]+$', '', item).strip()
            if item:
                return item
        
        # Pattern 2: "Has the candidate worked with X as listed?"
        match = re.search(r'worked with\s+([^?]+?)(?:\s+as listed|\?)', question_text, re.IGNORECASE)
        if match:
            item = match.group(1).strip()
            item = re.sub(r'[.,;:]+$', '', item).strip()
            if item:
                return item
        
        # Pattern 3: "X is listed at Y level..."
        match = re.search(r'^([A-Z][^i]+?)\s+is listed', question_text, re.IGNORECASE)
        if match:
            item = match.group(1).strip()
            if item:
                return item
        
        # Pattern 4: "The competence paper mentions X..."
        match = re.search(r'mentions\s+(?:the\s+)?(?:project\s+)?["\']?([^"\'.]+?)["\']?(?:\s+at|\s+\.|$)', question_text, re.IGNORECASE)
        if match:
            item = match.group(1).strip()
            item = re.sub(r'[.,;:]+$', '', item).strip()
            if item:
                return item
        
        # Pattern 5: Extract quoted strings (most reliable for full text like "Data Analyst in Python – DataCamp (30 Oct 2025)")
        match = re.search(r'["\']([^"\']+)["\']', question_text)
        if match:
            item = match.group(1).strip()
            if item:
                return item
        
        return ""
    
    def _format_project_experience(self, project_items: list) -> list:
        """
        Format project experience items to match preview export format: "Title - Company (Period)"
        If the item is already in this format, keep it. Otherwise, try to parse it.
        """
        formatted = []
        for item in project_items:
            if not item:
                continue
            # If already in "Title - Company (Period)" format, use as-is
            if " - " in item and "(" in item:
                formatted.append(item)
            else:
                # Try to extract and format if it's a job position
                # The item might be like "AI Developer" or "AI Developer at BOREK SOLUTIONS GROUP"
                # We'll keep it simple and use the extracted item
                formatted.append(item)
        return formatted
    
    def _get_footer_logo_url(self) -> str:
        """Get the footer logo URL for the template."""
        try:
            footer_logo_path = (Path(settings.BASE_DIR).parent / "borek-logo" / "borek.jpeg").resolve()
            if footer_logo_path.exists():
                return footer_logo_path.as_uri()
        except Exception:
            pass
        return ""
    
    def _format_education(self, education_items: list) -> str:
        """Format education items for the template."""
        if not education_items:
            return "-"
        # Join with newlines, limit to reasonable length
        formatted = "\n".join(education_items[:3])
        return formatted
    
    def _format_tech_competencies_grouped(self, tech_competencies: list) -> str:
        """Group technical competencies by category and format for template."""
        if not tech_competencies:
            return ""
        
        # Group competencies by category
        tech_competencies_dict = {}
        
        for skill in tech_competencies:
            if not skill or not isinstance(skill, str):
                continue
            
            skill_lower = skill.lower().strip()
            category = "Other"
            
            # Backend Development
            if any(x in skill_lower for x in ["python", "node.js", "nodejs", "php", "java", ".net", "c#", "ruby", "go", "golang", "rust", "spring", "django", "flask", "express", "laravel", "asp.net", "backend", "api", "rest", "graphql"]):
                category = "Backend Development"
            # Frontend & UI
            elif any(x in skill_lower for x in ["react", "vue", "angular", "svelte", "frontend", "css", "html", "javascript", "typescript", "js", "ts", "jquery", "bootstrap", "tailwind", "sass", "scss", "webpack", "vite", "ui", "ux"]):
                category = "Frontend & UI"
            # Database & Data
            elif any(x in skill_lower for x in ["sql", "database", "db", "mongo", "mongodb", "postgres", "postgresql", "mysql", "oracle", "redis", "cassandra", "dynamodb", "sqlite", "nosql", "firebase", "supabase"]):
                category = "Database & Data"
            # DevOps & Cloud
            elif any(x in skill_lower for x in ["devops", "docker", "kubernetes", "k8s", "ci/cd", "ci", "cd", "cloud", "aws", "azure", "gcp", "jenkins", "gitlab", "github actions", "terraform", "ansible", "cloudinary", "heroku", "vercel", "netlify"]):
                category = "DevOps & Cloud"
            # Architecture & Practices
            elif any(x in skill_lower for x in ["architecture", "design pattern", "clean code", "solid", "mvc", "mvvm", "microservices", "serverless", "event-driven", "tdd", "bdd", "agile", "scrum", "hexagonal", "onion", "adapter", "layered", "clean architecture"]):
                category = "Architecture & Practices"
            
            if category not in tech_competencies_dict:
                tech_competencies_dict[category] = []
            tech_competencies_dict[category].append(skill.strip())
        
        # Format as "Category: skill1, skill2|Category2: skill3, skill4"
        # Sort to put "Other" last, limit to max 6 categories
        sorted_groups = sorted(tech_competencies_dict.items(), key=lambda x: (x[0] == "Other", x[0]))
        formatted_items = []
        
        for category, skills in sorted_groups[:6]:
            # Limit to 8 skills per category
            skills_list = skills[:8]
            # Format as "Category: skill1, skill2"
            formatted_items.append(f"{category}: {', '.join(skills_list)}")
        
        return "|".join(formatted_items)
    
    def _build_structured_data_from_conversation(
        self, session, section_items, additional_notes, original_content
    ):
        """Build structured data for the template from conversation responses."""
        # Extract name and seniority from original competence paper or CV
        name = ""
        seniority = ""
        
        # Try to get name from structured CV first (most reliable)
        if session.cv and session.cv.structured_cv:
            name = session.cv.structured_cv.get("name") or session.cv.structured_cv.get("full_name") or ""
        
        # If not in structured CV, try to extract from original content (fallback)
        if not name and original_content:
            name_match = re.search(r'Name:\s*([^\n]+)', original_content, re.IGNORECASE)
            if name_match:
                name = name_match.group(1).strip()
            
            seniority_match = re.search(r'Seniority:\s*([^\n]+)', original_content, re.IGNORECASE)
            if seniority_match:
                seniority = seniority_match.group(1).strip()
        
        # Fallback to CV filename if name not found
        if not name:
            name = session.cv.original_filename.rsplit('.', 1)[0] if session.cv else ""
        
        # Build recommendation from confirmed items
        # Priority: explicit recommendations section > constructed summary
        rec_parts = []
        explicit_recs = section_items.get("recommendations", [])
        
        if explicit_recs:
             # Use the explicit recommendations collected from voice input
             recommendation = " ".join(explicit_recs)
        else:
            # Fallback to constructing one from skills/projects
            all_skill_lines = section_items.get("core_skills", []) + section_items.get("technical_competencies", [])
            all_project_lines = section_items.get("project_experience", [])
            
            if all_skill_lines:
                rec_parts.append(f"The candidate has confirmed core and technical skills such as: {', '.join(all_skill_lines[:5])}.")
            if all_project_lines:
                rec_parts.append(f"They have relevant project experience, including: {', '.join(all_project_lines[:3])}.")
            if additional_notes:
                rec_parts.append(f"Additional strengths and context from the interview: {', '.join(additional_notes[:5])}.")
            
            recommendation = " ".join(rec_parts) if rec_parts else "Based on the interview, the candidate demonstrates relevant skills and experience."
        
        # Limit recommendation to 550 characters
        if len(recommendation) > 550:
            # Try to cut at sentence boundaries
            import re
            sentences = re.split(r'(?<=[.!?])\s+', recommendation)
            recommendation = ''
            for sentence in sentences:
                if len(recommendation + sentence) <= 550:
                    recommendation += sentence + ' '
                else:
                    break
            recommendation = recommendation.strip()
            # If still too long, hard cut
            if len(recommendation) > 550:
                recommendation = recommendation[:547] + "..."
        
        # Format data for template
        return {
            "name": name,
            "seniority": seniority or "-",
            "core_skills": section_items.get("core_skills", [])[:3],  # Limit to 3
            "soft_skills": section_items.get("soft_skills", [])[:3],  # Limit to 3
            "languages": section_items.get("languages", [])[:4],  # Limit to 4
            "education": self._format_education(section_items.get("education", [])) or "-",
            "trainings": "\n".join(section_items.get("trainings_certifications", [])) or "-",
            "recommendation": recommendation,
            "tech_competencies_line": self._format_tech_competencies_grouped(section_items.get("technical_competencies", [])),
            "project_experience_line": "|".join(self._format_project_experience(section_items.get("project_experience", []))),
            "footer_logo_url": self._get_footer_logo_url(),
        }

    def post(self, request, session_id):
        logger.info(f"[GeneratePaper] 🚀 Starting paper generation for session_id={session_id}")
        session = get_object_or_404(ConversationSession, pk=session_id)

        # Permission
        if session.cv.user != request.user and not getattr(request.user, "is_staff", False):
            logger.warning(f"[GeneratePaper] ❌ Permission denied for session {session_id}, user {request.user.id}")
            return Response(
                {"detail": "You don't have permission to generate a paper for this session."},
                status=status.HTTP_403_FORBIDDEN,
            )

        questions = (
            ConversationQuestion.objects.filter(session=session)
            .select_related("response")
            .order_by("question_order")
        )
        
        # Log session statistics
        total_questions = questions.count()
        questions_with_responses = questions.filter(response__isnull=False).count()
        logger.info(
            f"[GeneratePaper] 📊 Session {session_id} statistics: {total_questions} total questions, "
            f"{questions_with_responses} with responses, status={session.status}"
        )

        # Aggregate by section.
        section_items = {key: [] for key in self.SECTION_LABELS.keys()}
        additional_notes = []

        confirmed_count = 0
        not_confirmed_count = 0
        new_skill_count = 0
        
        for q in questions:
            resp = getattr(q, "response", None)
            if resp is None:
                logger.debug(f"[GeneratePaper] Question {q.id} has no response, skipping")
                continue

            status_value = resp.status
            if status_value == "not_confirmed":
                not_confirmed_count += 1
                logger.debug(f"[GeneratePaper] Question {q.id} not confirmed, excluding")
                continue

            # Count confirmed items
            if status_value == "confirmed":
                confirmed_count += 1
            elif status_value == "new_skill":
                new_skill_count += 1

            # Determine target section.
            section_key = q.section
            if section_key not in section_items and section_key != "additional_info":
                logger.debug(f"[GeneratePaper] Question {q.id} section '{section_key}' not in section_items, skipping")
                continue

            # Priority 1: Use extracted_skills from the response (this contains the actual confirmed items)
            extracted_skills_list = resp.extracted_skills or []
            
            # Priority 2: If no extracted_skills, try to extract from question/topic
            question_text = q.question_text.strip()
            answer_text = resp.answer_text.strip()
            
            items_to_store = []
            
            if extracted_skills_list and isinstance(extracted_skills_list, list):
                # Use the extracted_skills from the response (these are the actual confirmed items)
                # Filter out questions and follow-up phrases
                filtered_items = []
                question_indicators = [
                    "based on your assessment", "what is your experience", "what can you tell me",
                    "do you have anything else", "is there anything else", "anything more",
                    "let's talk about", "now let's move", "which", "should we confirm"
                ]
                for item in extracted_skills_list:
                    item_str = str(item).strip()
                    if item_str:
                        item_lower = item_str.lower()
                        # Skip if it looks like a question or follow-up phrase
                        is_question = any(indicator in item_lower for indicator in question_indicators) or item_str.endswith('?')
                        if not is_question:
                            filtered_items.append(item_str)
                items_to_store = filtered_items
                logger.debug(f"[GeneratePaper] Using extracted_skills from response (filtered): {items_to_store}")
            
            # If extracted_skills is empty but status is confirmed, extract from question/topic
            if not items_to_store:
                item_extracted = self._extract_item_from_question(question_text, section_key)
                if item_extracted:
                    items_to_store = [item_extracted]
                elif q.topic and q.topic.strip():
                    # Use topic if available (it should contain the skill/item name from original CP)
                    topic = q.topic.strip()
                    # Filter out questions
                    question_indicators = [
                        "based on your assessment", "what is your experience", "what can you tell me",
                        "do you have anything else", "is there anything else", "anything more",
                        "let's talk about", "now let's move", "which", "should we confirm"
                    ]
                    topic_lower = topic.lower()
                    is_question = any(indicator in topic_lower for indicator in question_indicators) or topic.endswith('?')
                    if not is_question:
                        items_to_store = [topic]
                elif status_value in {"confirmed", "partially_confirmed", "new_skill"} and answer_text:
                    # For confirmed/partially_confirmed/new_skill, use the answer which contains the information
                    # This is especially important for soft_skills where answers are descriptive
                    # Filter out questions and completion signals
                    answer_lower = answer_text.lower()
                    completion_signals = ["no", "nope", "nothing else", "that's all", "that is all"]
                    is_completion = any(signal in answer_lower for signal in completion_signals)
                    is_question = answer_text.strip().endswith('?') or "based on your assessment" in answer_lower
                    if not is_completion and not is_question:
                        # For soft_skills, always use the answer text if extracted_skills is empty
                        # For other sections, use answer text as fallback if no items extracted
                        if section_key == "soft_skills" or not items_to_store:
                            items_to_store = [answer_text.strip()]
                else:
                    # Last fallback: try to extract from question text
                    cleaned = question_text
                    for prefix in ["The competence paper lists ", "Has the candidate worked with ", "The competence paper mentions ", "Is it correct that "]:
                        if cleaned.startswith(prefix):
                            cleaned = cleaned[len(prefix):]
                            cleaned = cleaned.split('.')[0].split('?')[0].strip()
                            break
                    # Filter out questions
                    question_indicators = [
                        "based on your assessment", "what is your experience", "what can you tell me",
                        "do you have anything else", "is there anything else", "anything more"
                    ]
                    cleaned_lower = cleaned.lower()
                    is_question = any(indicator in cleaned_lower for indicator in question_indicators) or cleaned.endswith('?')
                    if cleaned and len(cleaned) < 100 and not is_question:
                        items_to_store = [cleaned]
            
            # Store all confirmed items (with deduplication)
            if items_to_store:
                if section_key in section_items:
                    # Deduplicate items before adding (case-insensitive comparison)
                    existing_items_lower = [item.lower() for item in section_items[section_key]]
                    for item in items_to_store:
                        item_lower = item.lower().strip()
                        # Check if item already exists (case-insensitive)
                        if item_lower and item_lower not in existing_items_lower:
                            section_items[section_key].append(item)
                            existing_items_lower.append(item_lower)
                            logger.debug(f"[GeneratePaper] Added new item to {section_key}: {item}")
                        else:
                            logger.debug(f"[GeneratePaper] Skipped duplicate item in {section_key}: {item}")
                else:
                    # additional_info / discovery-style information goes into additional notes.
                    # Deduplicate additional notes as well
                    existing_notes_lower = [note.lower() for note in additional_notes]
                    for item in items_to_store:
                        item_lower = item.lower().strip()
                        if item_lower and item_lower not in existing_notes_lower:
                            additional_notes.append(item)
                            existing_notes_lower.append(item_lower)
                            logger.debug(f"[GeneratePaper] Added new item to additional_notes: {item}")
                        else:
                            logger.debug(f"[GeneratePaper] Skipped duplicate item in additional_notes: {item}")
            else:
                logger.warning(f"[GeneratePaper] No items extracted for question {q.id}, section {section_key}, status {status_value}")
        
        logger.info(
            f"[GeneratePaper] Processing results: {confirmed_count} confirmed, {new_skill_count} new_skill, "
            f"{not_confirmed_count} not_confirmed"
        )

        # Build text content.
        lines = []

        # Our Recommendation – prioritize explicit recommendations from the recruiter
        explicit_recs = section_items.get("recommendations", [])
        
        if explicit_recs:
            # Use the explicit recommendations collected from voice input
            lines.append("Our Recommendation")
            lines.append("------------------")
            # Join all recommendation items into a single paragraph
            recommendation_text = " ".join(explicit_recs)
            lines.append(recommendation_text)
            lines.append("")
        else:
            # Fallback: construct recommendation from confirmed/new items
            all_skill_lines = section_items.get("core_skills", []) + section_items.get(
                "technical_competencies", []
            )
            all_project_lines = section_items.get("project_experience", [])
            rec_parts = []
            if all_skill_lines:
                rec_parts.append("The candidate has confirmed core and technical skills such as:")
                rec_parts.append("- " + "; ".join(all_skill_lines[:5]))
            if all_project_lines:
                rec_parts.append("They have relevant project experience, including:")
                rec_parts.append("- " + "; ".join(all_project_lines[:3]))
            if additional_notes:
                rec_parts.append("Additional strengths and context from the interview:")
                rec_parts.append("- " + "; ".join(additional_notes[:5]))

            # Add recommendation section only once
            if rec_parts:
                lines.append("Our Recommendation")
                lines.append("------------------")
                lines.extend(rec_parts)
                lines.append("")

        # Structured sections in fixed order.
        for key, label in self.SECTION_LABELS.items():
            # Skip recommendations since it's already handled in "Our Recommendation" section above
            if key == "recommendations":
                continue
            items = section_items.get(key) or []
            if not items:
                continue
            lines.append(label)
            lines.append("-" * len(label))
            for item in items:
                lines.append(f"- {item}")
            lines.append("")

        # Additional information section (from discovery / overall).
        if additional_notes:
            lines.append("Additional Information from Interview")
            lines.append("------------------------------------")
            for note in additional_notes:
                lines.append(f"- {note}")
            lines.append("")

        # Store TEXT version in database (not HTML)
        # HTML will be generated only when exporting to PDF
        text_content = "\n".join(lines).strip()

        if not text_content:
            return Response(
                {
                    "detail": "No confirmed or new items were found for this session. Cannot generate a competence paper."
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Create or update the conversation-based competence paper.
        # Store TEXT content in database (HTML will be generated only for PDF export)
        conversation_paper = session.conversation_competence_paper
        if conversation_paper is None:
            conversation_paper = ConversationCompetencePaper.objects.create(
                conversation_session=session,
                content=text_content,
            )
            session.conversation_competence_paper = conversation_paper
            logger.info(
                f"[GeneratePaper] ✅ Created new ConversationCompetencePaper: id={conversation_paper.id}, "
                f"content_length={len(text_content)} (TEXT format)"
            )
        else:
            conversation_paper.content = text_content
            conversation_paper.save(update_fields=["content"])
            logger.info(
                f"[GeneratePaper] ✅ Updated existing ConversationCompetencePaper: id={conversation_paper.id}, "
                f"content_length={len(text_content)} (TEXT format)"
            )

        # Mark session as completed and link the paper
        session.status = "completed"
        session.completed_at = timezone.now()
        session.conversation_competence_paper = conversation_paper
        session.save(update_fields=["status", "completed_at", "conversation_competence_paper"])
        
        logger.info(
            f"[GeneratePaper] ✅ Session {session_id} marked as completed at {session.completed_at}. "
            f"Paper ID: {conversation_paper.id}, Content length: {len(text_content)} characters (TEXT format)"
        )
        logger.info(
            f"[GeneratePaper] 📋 Final summary - Confirmed: {confirmed_count}, "
            f"New Skills: {new_skill_count}, Not Confirmed: {not_confirmed_count}, "
            f"Additional Notes: {len(additional_notes)}"
        )

        serializer = ConversationCompetencePaperSerializer(conversation_paper)
        logger.info(f"[GeneratePaper] ✅ Paper generation complete. Returning paper data to client.")
        return Response(serializer.data, status=status.HTTP_200_OK)


class ConversationCompetencePaperUpdateView(APIView):
    """
    Allow editing of a conversation-based competence paper's content.
    """

    permission_classes = [IsAuthenticated]

    def patch(self, request, paper_id):
        conversation_paper = get_object_or_404(ConversationCompetencePaper, pk=paper_id)

        if not can_user_access_conversation_paper(request.user, conversation_paper):
            return Response(
                {"detail": "You don't have permission to edit this competence paper."},
                status=status.HTTP_403_FORBIDDEN,
            )

        content = (request.data.get("content") or "").strip()
        if not content:
            return Response(
                {"detail": "content must not be empty."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        conversation_paper.content = content
        conversation_paper.save(update_fields=["content"])

        serializer = ConversationCompetencePaperSerializer(conversation_paper)
        return Response(serializer.data, status=status.HTTP_200_OK)


class ConversationCompetencePaperPDFView(APIView):
    """
    Generate a simple PDF from the stored ConversationCompetencePaper content.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, paper_id):
        conversation_paper = get_object_or_404(ConversationCompetencePaper, pk=paper_id)

        if not can_user_access_conversation_paper(request.user, conversation_paper):
            return Response(
                {"detail": "You don't have permission to access this competence paper."},
                status=status.HTTP_403_FORBIDDEN,
            )

        from pathlib import Path
        from django.conf import settings
        from django.http import HttpResponse

        session = conversation_paper.conversation_session
        cv_instance = session.cv

        # Get stored text content (this is the edited content from the user)
        text_content = conversation_paper.content or ""
        
        # Parse the stored text content to extract sections for template rendering
        # This ensures we use the edited content, not the original session data
        section_items = {
            "core_skills": [],
            "soft_skills": [],
            "languages": [],
            "education": [],
            "trainings_certifications": [],
            "technical_competencies": [],
            "project_experience": [],
        }
        additional_notes = []
        recommendation = ""
        
        # Parse text content into sections
        lines = text_content.split('\n')
        current_section = None
        current_content = []
        
        def parse_section_content(content_text, section_name):
            """Parse section content, handling both bullet points and plain text."""
            if section_name == "Our Recommendation":
                # Recommendation can be plain text or bullet points
                return content_text
            else:
                # Extract bullet points
                items = []
                for item in content_text.split('\n'):
                    item = item.strip()
                    if item.startswith('-'):
                        items.append(item.replace('-', '').strip())
                    elif item and not item.startswith('-'):
                        # Handle plain text lines (like in recommendation)
                        items.append(item)
                return items
        
        for i, line in enumerate(lines):
            line_stripped = line.strip()
            # Check for section headers
            if line_stripped in ["Our Recommendation", "Core Skills", "Soft Skills", "Languages", 
                                "Education", "Trainings & Certifications", "Technical Competencies",
                                "Project Experience", "Additional Information from Interview"]:
                # Save previous section
                if current_section and current_content:
                    content_text = '\n'.join(current_content).strip()
                    parsed = parse_section_content(content_text, current_section)
                    if current_section == "Our Recommendation":
                        recommendation = parsed if isinstance(parsed, str) else '\n'.join(parsed)
                    elif current_section == "Core Skills":
                        section_items["core_skills"] = parsed if isinstance(parsed, list) else []
                    elif current_section == "Soft Skills":
                        section_items["soft_skills"] = parsed if isinstance(parsed, list) else []
                    elif current_section == "Languages":
                        section_items["languages"] = parsed if isinstance(parsed, list) else []
                    elif current_section == "Education":
                        section_items["education"] = parsed if isinstance(parsed, list) else []
                    elif current_section == "Trainings & Certifications":
                        section_items["trainings_certifications"] = parsed if isinstance(parsed, list) else []
                    elif current_section == "Technical Competencies":
                        section_items["technical_competencies"] = parsed if isinstance(parsed, list) else []
                    elif current_section == "Project Experience":
                        section_items["project_experience"] = parsed if isinstance(parsed, list) else []
                    elif current_section == "Additional Information from Interview":
                        additional_notes = parsed if isinstance(parsed, list) else []
                
                current_section = line_stripped
                current_content = []
                # Skip the underline line (dashes) if present
                if i + 1 < len(lines):
                    next_line = lines[i + 1].strip()
                    if next_line and next_line.replace('-', '').strip() == '':
                        i += 1  # Skip the underline line
                        continue
            elif current_section:
                # Skip underline lines
                if not (line_stripped.replace('-', '').strip() == '' and len(line_stripped) > 0):
                    current_content.append(line)
        
        # Save last section
        if current_section and current_content:
            content_text = '\n'.join(current_content).strip()
            parsed = parse_section_content(content_text, current_section)
            if current_section == "Our Recommendation":
                recommendation = parsed if isinstance(parsed, str) else '\n'.join(parsed)
            elif current_section == "Core Skills":
                section_items["core_skills"] = parsed if isinstance(parsed, list) else []
            elif current_section == "Soft Skills":
                section_items["soft_skills"] = parsed if isinstance(parsed, list) else []
            elif current_section == "Languages":
                section_items["languages"] = parsed if isinstance(parsed, list) else []
            elif current_section == "Education":
                section_items["education"] = parsed if isinstance(parsed, list) else []
            elif current_section == "Trainings & Certifications":
                section_items["trainings_certifications"] = parsed if isinstance(parsed, list) else []
            elif current_section == "Technical Competencies":
                section_items["technical_competencies"] = parsed if isinstance(parsed, list) else []
            elif current_section == "Project Experience":
                section_items["project_experience"] = parsed if isinstance(parsed, list) else []
            elif current_section == "Additional Information from Interview":
                additional_notes = parsed if isinstance(parsed, list) else []
        
        # Get original competence paper for name/seniority
        original_paper = session.original_competence_paper
        original_content = original_paper.content if original_paper else ""
        
        # Extract name and seniority
        name = ""
        seniority = ""
        if original_content:
            name_match = re.search(r'Name:\s*([^\n]+)', original_content, re.IGNORECASE)
            if name_match:
                name = name_match.group(1).strip()
            seniority_match = re.search(r'Seniority:\s*([^\n]+)', original_content, re.IGNORECASE)
            if seniority_match:
                seniority = seniority_match.group(1).strip()
        
        if not name:
            name = session.cv.original_filename.rsplit('.', 1)[0] if session.cv else ""
        
        # Build structured data for template
        view_instance = ConversationSessionGeneratePaperView()
        structured_data = {
            "name": name,
            "seniority": seniority or "-",
            "core_skills": section_items.get("core_skills", [])[:3],
            "soft_skills": section_items.get("soft_skills", [])[:3],
            "languages": section_items.get("languages", [])[:4],
            "education": view_instance._format_education(section_items.get("education", [])) or "-",
            "trainings": "\n".join(section_items.get("trainings_certifications", [])) or "-",
            "recommendation": recommendation or "Based on the interview, the candidate demonstrates relevant skills and experience.",
            "tech_competencies_line": view_instance._format_tech_competencies_grouped(section_items.get("technical_competencies", [])),
            "project_experience_line": "|".join(view_instance._format_project_experience(section_items.get("project_experience", []))),
            "footer_logo_url": view_instance._get_footer_logo_url(),
            "is_assessment": True,  # Flag to indicate this is a Conversation Competence Paper (CCP)
        }
        
        # Generate HTML from template for PDF export
        template_path = Path(settings.BASE_DIR) / "templates" / "competence_template.html"
        html_content = text_content  # Fallback to text if template fails
        
        if template_path.exists():
            try:
                from jinja2 import Environment, FileSystemLoader
                env = Environment(loader=FileSystemLoader(template_path.parent))
                template = env.get_template(template_path.name)
                html_content = template.render(**structured_data)
                logger.info(f"[PDFExport] ✅ Generated HTML from template for paper {paper_id} using edited content")
            except Exception as e:
                logger.warning(f"[PDFExport] ⚠️ Failed to use template, using text format: {str(e)}")
                html_content = text_content
        else:
            logger.warning(f"[PDFExport] ⚠️ Template not found, using text format")
            html_content = text_content

        # Render PDF to a temp file (no local media storage).
        safe_name = cv_instance.original_filename.replace("/", "_").replace("\\", "_")
        with tempfile.TemporaryDirectory() as tmpdir:
            output_path = Path(tmpdir) / f"conversation_paper_{conversation_paper.id}_{safe_name}"
            if not output_path.suffix.lower().endswith(".pdf"):
                output_path = output_path.with_suffix(".pdf")
            pdf_path = render_conversation_paper_to_pdf(
                html_content,
                output_path=output_path,
                title="Conversation Competence Paper",
            )
            with open(pdf_path, "rb") as f:
                pdf_bytes = f.read()

        response = HttpResponse(
            pdf_bytes,
            content_type="application/pdf",
        )
        response["Content-Disposition"] = (
            f'attachment; filename="{cv_instance.original_filename.rsplit(".", 1)[0]}_conversation_paper.pdf"'
        )
        return response
