import json
import logging
import time
from pathlib import Path

from django.conf import settings
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework import generics, status
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import CV
from .pdf_renderer import render_structured_cv_to_pdf, _calculate_seniority_label
from .serializers import CVSerializer
from .services import read_cv_file
from apps.llm.services import generate_structured_cv
from apps.interview.models import CompetencePaper


logger = logging.getLogger(__name__)


class CVUploadView(generics.ListCreateAPIView):
    serializer_class = CVSerializer
    permission_classes = [IsAuthenticated]
    parser_classes = (MultiPartParser, FormParser)

    def get_queryset(self):
        return CV.objects.filter(user=self.request.user)

    def create(self, request, *args, **kwargs):
        req_start = time.monotonic()
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        cv_instance = serializer.save()

        # Do not call LLM on upload; just persist the file and return metadata.
        competence_summary = ""
        skills = []

        headers = self.get_success_headers(serializer.data)
        response_data = {
            **serializer.data,
            "competence_summary": competence_summary,
            "skills": skills,
        }
        total_elapsed = time.monotonic() - req_start
        logger.info(
            "cv_upload_completed",
            extra={"cv_id": cv_instance.id, "seconds": round(total_elapsed, 3)},
        )
        print(f"[REQ] upload done cv_id={cv_instance.id} seconds={total_elapsed:.3f}")
        return Response(response_data, status=status.HTTP_201_CREATED, headers=headers)


class CVDetailView(generics.DestroyAPIView):
    """
    Allow a user to delete one of their own uploaded CVs.
    """

    serializer_class = CVSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return CV.objects.filter(user=self.request.user)


class CVTextView(APIView):
    """
    Read-only endpoint returning the extracted plain text for a single CV.

    This leverages the existing `read_cv_file` helper to ensure consistent
    parsing behavior between the API and internal usages.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        try:
            cv_instance = CV.objects.get(pk=pk, user=request.user)
        except CV.DoesNotExist:
            return Response(
                {"detail": "Not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        file_obj = cv_instance.file
        # Try to infer content type if available; it's safe to pass None.
        content_type = getattr(getattr(file_obj, "file", None), "content_type", None)
        cv_text = read_cv_file(
            file_obj,
            name=cv_instance.original_filename,
            content_type=content_type,
        )

        return Response(
            {
                "id": cv_instance.id,
                "original_filename": cv_instance.original_filename,
                "uploaded_at": cv_instance.uploaded_at,
                "text": cv_text,
            },
            status=status.HTTP_200_OK,
        )


class FormattedCVView(APIView):
    """
    Generate and return a formatted CV PDF for a given uploaded CV.

    Flow:
    - Load the user's CV.
    - Extract plain text from the stored file.
    - Ask the LLM for a normalized structured CV JSON.
    - Render a new PDF using the Ajlla-style template.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        req_start = time.monotonic()
        cv_instance = get_object_or_404(CV, pk=pk, user=request.user)

        # Extract text from the stored CV file.
        file_obj = cv_instance.file
        content_type = getattr(getattr(file_obj, "file", None), "content_type", None)
        cv_text = read_cv_file(
            file_obj,
            name=cv_instance.original_filename,
            content_type=content_type,
        )

        # Generate structured JSON via LLM.
        llm_start = time.monotonic()
        print(f"[LLM] structured start cv_id={cv_instance.id}")
        structured_cv = generate_structured_cv(cv_text)
        llm_elapsed = time.monotonic() - llm_start
        logger.info(
            "structured_cv_llm_completed",
            extra={"cv_id": cv_instance.id, "seconds": round(llm_elapsed, 3)},
        )
        print(f"[LLM] structured done cv_id={cv_instance.id} seconds={llm_elapsed:.3f}")

        # Render PDF using a deterministic template.
        output_dir = Path(settings.MEDIA_ROOT) / "formatted_cvs"
        safe_name = cv_instance.original_filename.replace("/", "_").replace("\\", "_")
        output_path = output_dir / f"cv_{cv_instance.id}_{safe_name}"
        if not output_path.suffix.lower().endswith(".pdf"):
            output_path = output_path.with_suffix(".pdf")

        # Prefer the Ajlla HTML template when available; fallback stays FPDF.
        template_path = Path(settings.BASE_DIR).parent / "Ajlla_Product Owner.html"
        pdf_path = render_structured_cv_to_pdf(
            structured_cv,
            output_path=output_path,
            html_template_path=template_path,
        )

        with open(pdf_path, "rb") as f:
            pdf_bytes = f.read()

        response = HttpResponse(
            pdf_bytes,
            content_type="application/pdf",
        )
        # Suggest a friendly download filename.
        response["Content-Disposition"] = (
            f'attachment; filename="{cv_instance.original_filename.rsplit(".", 1)[0]}_formatted.pdf"'
        )
        total_elapsed = time.monotonic() - req_start
        logger.info(
            "formatted_cv_completed",
            extra={"cv_id": cv_instance.id, "seconds": round(total_elapsed, 3)},
        )
        print(f"[REQ] formatted done cv_id={cv_instance.id} seconds={total_elapsed:.3f}")
        return response


class StructuredCVView(APIView):
    """
    Return the LLM-generated structured CV for a given CV.
    This allows the frontend to show an editable preview and POST back with edits.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        req_start = time.monotonic()
        cv_instance = get_object_or_404(CV, pk=pk, user=request.user)

        # Extract text from the stored CV file.
        file_obj = cv_instance.file
        content_type = getattr(getattr(file_obj, "file", None), "content_type", None)
        cv_text = read_cv_file(
            file_obj,
            name=cv_instance.original_filename,
            content_type=content_type,
        )

        # Generate structured JSON via LLM.
        llm_start = time.monotonic()
        print(f"[LLM] structured start cv_id={cv_instance.id}")
        structured_cv = generate_structured_cv(cv_text)
        llm_elapsed = time.monotonic() - llm_start
        logger.info(
            "structured_cv_llm_completed",
            extra={"cv_id": cv_instance.id, "seconds": round(llm_elapsed, 3)},
        )
        print(f"[LLM] structured done cv_id={cv_instance.id} seconds={llm_elapsed:.3f}")

        total_elapsed = time.monotonic() - req_start
        logger.info(
            "structured_cv_get_completed",
            extra={"cv_id": cv_instance.id, "seconds": round(total_elapsed, 3)},
        )
        print(f"[REQ] structured get done cv_id={cv_instance.id} seconds={total_elapsed:.3f}")
        return Response(structured_cv, status=status.HTTP_200_OK)

    def post(self, request, pk):
        """
        Accept edited structured CV data and render a PDF with the edits applied.
        Now supports a 'type' parameter: 'cv' (default) or 'competence'.
        """
        req_start = time.monotonic()
        cv_instance = get_object_or_404(CV, pk=pk, user=request.user)

        try:
            structured_cv = request.data.get("structured_cv", {})
            section_order = request.data.get("section_order")
            export_type = request.data.get("type", "cv")
        except Exception as e:
            return Response(
                {"detail": f"Invalid payload: {str(e)}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Render PDF using the edited structured CV.
        output_dir = Path(settings.MEDIA_ROOT) / "formatted_cvs"
        safe_name = cv_instance.original_filename.replace("/", "_").replace("\\", "_")
        output_path = output_dir / f"cv_{cv_instance.id}_{safe_name}"
        if not output_path.suffix.lower().endswith(".pdf"):
            output_path = output_path.with_suffix(".pdf")

        # Choose template based on export_type
        if export_type == "competence":
            template_path = Path(settings.BASE_DIR) / "templates" / "competence_template.html"
            download_name = f'{cv_instance.original_filename.rsplit(".", 1)[0]}_competence_letter.pdf'
        else:
            template_path = Path(settings.BASE_DIR).parent / "Ajlla_Product Owner.html"
            download_name = f'{cv_instance.original_filename.rsplit(".", 1)[0]}_edited.pdf'

        pdf_path = render_structured_cv_to_pdf(
            structured_cv,
            output_path=output_path,
            html_template_path=template_path,
            section_order=section_order,
        )

        # Store competence paper in DB when exporting competence type
        # IMPORTANT: Store only what was actually exported in the PDF (with same restrictions)
        if export_type == "competence":
            # Use the SAME logic as pdf_renderer to extract data with restrictions
            competence_content_parts = []
            
            # Name
            name = structured_cv.get("name") or structured_cv.get("full_name") or ""
            if name:
                competence_content_parts.append(f"Name: {name}")
            
            # Seniority (same logic as pdf_renderer)
            seniority = structured_cv.get("seniority") or ""
            if not seniority:
                work_exp = structured_cv.get("work_experience") or []
                if work_exp:
                    seniority = _calculate_seniority_label(work_exp)
            if seniority:
                competence_content_parts.append(f"Seniority: {seniority}")
            
            # Recommendation (profile) - main competence summary
            recommendation = structured_cv.get("profile", "").strip()
            if recommendation:
                competence_content_parts.append(f"\nRecommendation:\n{recommendation}")
            
            # Soft skills: LIMITED TO MAX 5 (same as pdf_renderer line 220)
            soft_skills = [str(s).strip() for s in (structured_cv.get("soft_skills") or []) if s][:5]
            if soft_skills:
                competence_content_parts.append(f"\nSoft Skills:")
                for skill in soft_skills:
                    competence_content_parts.append(f"• {skill}")
            
            # Core skills and Tech Competencies: TOP 5 ONLY (same logic as pdf_renderer lines 270-280)
            core_skills = []
            tech_competencies = {}
            
            # Group skills (same logic as pdf_renderer)
            # 1) Prefer pre-grouped skills if the caller already provided them
            if isinstance(structured_cv.get("skills_grouped"), dict):
                for k, v in structured_cv["skills_grouped"].items():
                    group_name = str(k).strip()
                    if not group_name:
                        continue
                    values = [str(s).strip() for s in (v or []) if str(s).strip()]
                    if values:
                        tech_competencies[group_name] = values
            
            # 2) Use static keyword-based grouping if no pre-grouped skills (same as pdf_renderer)
            # ALWAYS run this to ensure tech_competencies are created from skills list
            if not tech_competencies:
                skills = [str(s).strip() for s in (structured_cv.get("skills") or []) if s]
                for skill in skills:
                    key = "Other"
                    lower = skill.lower()
                    if any(x in lower for x in ["python", "node.js", "nodejs", "php", "java", ".net", "c#", "ruby", "go", "golang", "rust", "spring", "django", "flask", "express", "laravel", "asp.net", "backend", "api", "rest", "graphql"]):
                        key = "Backend Development"
                    elif any(x in lower for x in ["react", "vue", "angular", "svelte", "frontend", "css", "html", "javascript", "typescript", "js", "ts", "jquery", "bootstrap", "tailwind", "sass", "scss", "webpack", "vite", "ui", "ux"]):
                        key = "Frontend & UI"
                    elif any(x in lower for x in ["sql", "database", "db", "mongo", "mongodb", "postgres", "postgresql", "mysql", "oracle", "redis", "cassandra", "dynamodb", "sqlite", "nosql", "firebase", "supabase"]):
                        key = "Database & Data"
                    elif any(x in lower for x in ["devops", "docker", "kubernetes", "k8s", "ci/cd", "ci", "cd", "cloud", "aws", "azure", "gcp", "jenkins", "gitlab", "github actions", "terraform", "ansible", "cloudinary", "heroku", "vercel", "netlify"]):
                        key = "DevOps & Cloud"
                    elif any(x in lower for x in ["architecture", "design pattern", "clean code", "solid", "mvc", "mvvm", "microservices", "serverless", "event-driven", "tdd", "bdd", "agile", "scrum", "hexagonal", "onion", "adapter"]):
                        key = "Architecture & Practices"
                    tech_competencies.setdefault(key, []).append(skill)
            
            # Extract top 5 core skills from tech_competencies (same as pdf_renderer)
            seen_core = set()
            for group in tech_competencies.values():
                for s in group:
                    if s not in seen_core:
                        core_skills.append(s)
                        seen_core.add(s)
                    if len(core_skills) >= 5:
                        break
                if len(core_skills) >= 5:
                    break
            
            # If no core skills from grouped, try to get top 5 from raw skills list
            if not core_skills:
                raw_skills = [str(s).strip() for s in (structured_cv.get("skills") or []) if str(s).strip()]
                core_skills = raw_skills[:5]
            
            # Store Core Skills
            if core_skills:
                competence_content_parts.append(f"\nCore Skills:")
                for skill in core_skills:
                    competence_content_parts.append(f"• {skill}")
            
            # Tech Competencies: max 6 categories, max 8 skills per category (same as pdf_renderer)
            # Always include tech competencies if we have any grouped skills
            if tech_competencies:
                sorted_groups = sorted(tech_competencies.items(), key=lambda x: (x[0] == "Other", x[0]))
                tech_competencies_list = sorted_groups[:6]  # Max 6 categories
                
                if tech_competencies_list:
                    competence_content_parts.append(f"\nTech Competencies:")
                    for group, skills in tech_competencies_list:
                        if skills:
                            limited_skills = skills[:8]  # Max 8 skills per category
                            # Format: Category name as header, then skills as comma-separated list
                            competence_content_parts.append(f"• {group}: {', '.join(limited_skills)}")
            
            # Work Experience (all entries, formatted as in PDF)
            work_experience = structured_cv.get("work_experience") or []
            if work_experience:
                competence_content_parts.append("\nWork Experience:")
                for job in work_experience:
                    if isinstance(job, dict):
                        title = job.get("title", "") or "Position"
                        company = job.get("company", "")
                        period = job.get("from", "")
                        bullets = [str(b) for b in job.get("bullets") or [] if b]
                        header = f"{title}"
                        if company:
                            header += f" - {company}"
                        if period:
                            header += f" ({period})"
                        competence_content_parts.append(f"• {header}")
                        if bullets:
                            for bullet in bullets:
                                competence_content_parts.append(f"  - {bullet}")
            
            # Languages: MAX 4 (same as pdf_renderer lines 281-290)
            languages = []
            for lang in structured_cv.get("languages") or []:
                if isinstance(lang, dict):
                    name_ = str(lang.get("name") or "").strip()
                    level_ = str(lang.get("level") or "").strip()
                    if name_:
                        languages.append(f"{name_} ({level_})" if level_ else name_)
                    if len(languages) >= 4:
                        break
            if languages:
                competence_content_parts.append(f"\nLanguages:")
                for lang in languages:
                    competence_content_parts.append(f"• {lang}")
            
            # Education: LATEST 3 ENTRIES (same as pdf_renderer lines 291-302)
            education_items = []
            education_list = structured_cv.get("education") or []
            for e in education_list[:3]:  # Latest 3 only
                if isinstance(e, dict):
                    degree = str(e.get('degree', '')).strip()
                    institution = str(e.get('institution', '')).strip()
                    edu_str = f"{degree} {institution}".strip()
                    if edu_str:
                        education_items.append(edu_str)
            if education_items:
                competence_content_parts.append(f"\nEducation:")
                for edu in education_items:
                    competence_content_parts.append(f"• {edu}")
            
            # Trainings: LATEST 3 ITEMS (same as pdf_renderer lines 303-314)
            all_trainings = []
            for c in (structured_cv.get("certifications") or []):
                if c:
                    all_trainings.append(str(c).strip())
            for c in (structured_cv.get("courses") or []):
                if c:
                    all_trainings.append(str(c).strip())
            trainings = all_trainings[:3]  # Latest 3 only
            if trainings:
                competence_content_parts.append(f"\nTraining & Certifications:")
                for training in trainings:
                    competence_content_parts.append(f"• {training}")
            
            # Combine all parts into full competence paper content
            full_content = "\n".join(competence_content_parts)
            
            if full_content.strip():
                # Create new competence paper (store exactly what was exported - always original)
                CompetencePaper.objects.create(
                    cv=cv_instance,
                    content=full_content,
                )

        with open(pdf_path, "rb") as f:
            pdf_bytes = f.read()

        response = HttpResponse(
            pdf_bytes,
            content_type="application/pdf",
        )
        # Suggest a friendly download filename.
        response["Content-Disposition"] = (
            f'attachment; filename="{download_name}"'
        )
        total_elapsed = time.monotonic() - req_start
        logger.info(
            "structured_cv_post_completed",
            extra={"cv_id": cv_instance.id, "seconds": round(total_elapsed, 3)},
        )
        print(f"[REQ] structured post done cv_id={cv_instance.id} seconds={total_elapsed:.3f}")
        return response
