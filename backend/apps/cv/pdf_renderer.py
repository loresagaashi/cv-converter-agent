from pathlib import Path
from typing import Any, Dict, List, Optional

from fpdf import FPDF
from apps.llm.services import group_skills_into_categories

try:
  from jinja2 import Environment, FileSystemLoader  # type: ignore
  from weasyprint import HTML  # type: ignore
  _HTML_RENDER_AVAILABLE = True
except Exception as exc:  # pragma: no cover - optional dependency
  _HTML_RENDER_AVAILABLE = False
  Environment = None  # type: ignore
  FileSystemLoader = None  # type: ignore
  HTML = None  # type: ignore


DEFAULT_SECTION_ORDER: List[str] = [
  "profile",
  "languages",
  "skills",
  "work_experience",
  "certifications",
  "education",
  "projects",
  "courses",
]

# Keep left/right column defaults for the HTML template while allowing custom order.
LEFT_COLUMN_KEYS = {"profile", "languages", "skills"}
RIGHT_COLUMN_KEYS = {"work_experience", "certifications", "education", "projects", "courses"}

def _normalize_section_order(raw_order: Optional[List[Any]]) -> List[str]:
  """
  Return a stable, de-duplicated section order containing only known keys.
  Missing defaults are appended at the end to preserve PDF completeness.
  """
  seen = set()
  order: List[str] = []
  for key in raw_order or []:
    if not isinstance(key, str):
      continue
    cleaned = key.strip().lower()
    if cleaned in DEFAULT_SECTION_ORDER and cleaned not in seen:
      order.append(cleaned)
      seen.add(cleaned)
  for key in DEFAULT_SECTION_ORDER:
    if key not in seen:
      order.append(key)
      seen.add(key)
  return order


def _sanitize_for_pdf(text: str) -> str:
  """
  Ensure the text only contains characters supported by the core Helvetica
  font used by FPDF (latin-1). Any unsupported characters are dropped.
  """
  if not isinstance(text, str):
    return ""
  try:
    return text.encode("latin-1", "ignore").decode("latin-1")
  except Exception:
    return ""


def _pdf_add_section_title(pdf: FPDF, title: str) -> None:
  pdf.set_font("Helvetica", "B", 14)
  pdf.set_text_color(0, 0, 0)
  pdf.ln(4)
  pdf.cell(0, 8, _sanitize_for_pdf(title), ln=True)


def _pdf_add_small_heading(pdf: FPDF, text: str) -> None:
  pdf.set_font("Helvetica", "B", 11)
  pdf.set_text_color(40, 40, 40)
  pdf.ln(2)
  pdf.cell(0, 6, _sanitize_for_pdf(text), ln=True)


def _safe_multi_cell(pdf: FPDF, w: float, h: float, text: str) -> None:
  """
  Wrapper around FPDF.multi_cell that:
  - sanitizes text to latin-1,
  - hard-wraps very long tokens so FPDF can break lines,
  - ensures a minimum usable width,
  - truncates as a last resort to avoid layout errors.
  """
  clean = _sanitize_for_pdf(text)
  if not clean:
    return

  # Insert breakpoints into very long tokens (no spaces) to avoid FPDF errors.
  tokens = clean.split()
  softened_tokens: List[str] = []
  for tok in tokens:
    if len(tok) > 60:
      chunks = [tok[i : i + 60] for i in range(0, len(tok), 60)]
      softened_tokens.append(" ".join(chunks))
    else:
      softened_tokens.append(tok)
  softened = " ".join(softened_tokens)

  # Ensure there is always horizontal space: if w <= 0, use full width minus margins.
  effective_w = w if w and w > 0 else max(20, pdf.w - pdf.l_margin - pdf.r_margin - 2)

  try:
    pdf.multi_cell(effective_w, h, softened)
  except Exception:
    # Truncate aggressively to avoid layout errors on pathological content.
    truncated = softened[:200]
    if truncated:
      pdf.multi_cell(effective_w, h, truncated)


def render_structured_cv_to_pdf(
  structured_cv: Dict[str, Any], *, output_path: Path, html_template_path: Optional[Path] = None, section_order: Optional[List[str]] = None
) -> Path:
  """
  Render a normalized structured CV into a PDF.

  If a Jinja2/WeasyPrint HTML template is provided and dependencies are installed,
  render with that template to preserve the exact visual layout. Otherwise, fall
  back to the deterministic FPDF layout below.
  
  `section_order` allows customizing the order and visibility of sections.
  Missing sections use defaults; custom keys are ignored.
  """

  if not html_template_path:
    print("[PDF] No html_template_path provided; using FPDF fallback")
  elif not html_template_path.exists():
    print(f"[PDF] Template not found at: {html_template_path}; using FPDF fallback")
  elif not _HTML_RENDER_AVAILABLE:
    print("[PDF] HTML render deps unavailable; using FPDF fallback")

  normalized_order = _normalize_section_order(section_order)

  if html_template_path and html_template_path.exists() and _HTML_RENDER_AVAILABLE:
    print(f"[PDF] Using HTML template: {html_template_path}")
    env = Environment(loader=FileSystemLoader(html_template_path.parent))
    template = env.get_template(html_template_path.name)

    # Detect if this is the competence template by filename
    is_competence = "competence" in html_template_path.name.lower()

    # Map structured_cv to competence template placeholders
    if is_competence:
      # Name
      name = structured_cv.get("name") or structured_cv.get("full_name") or ""
      # Seniority: try to extract from profile or work_experience
      seniority = structured_cv.get("seniority") or ""
      if not seniority:
        # Try to infer from work_experience
        work_exp = structured_cv.get("work_experience") or []
        if isinstance(work_exp, list) and work_exp:
          years = 0
          for job in work_exp:
            if isinstance(job, dict):
              from_date = str(job.get("from") or "").strip()
              to_date = str(job.get("to") or "").strip()
              try:
                y1 = int(from_date[:4]) if from_date else None
                y2 = int(to_date[:4]) if to_date else None
                if y1 and y2:
                  years += max(0, y2 - y1)
              except Exception:
                pass
          if years:
            seniority = f"{years}+ years"
      # Soft skills: from structured_cv["soft_skills"] or empty
      soft_skills = [str(s).strip() for s in (structured_cv.get("soft_skills") or []) if s][:6]
      # Core skills and tech competencies:
      # Use AI-based grouping for tech competencies (max 6 groups), with a simple
      # heuristic fallback if the LLM is unavailable.
      core_skills: List[str] = []
      tech_competencies: Dict[str, List[str]] = {}
      tech_competencies_flat: List[str] = []

      # 1) Prefer pre-grouped skills if the caller already provided them.
      if isinstance(structured_cv.get("skills_grouped"), dict):
        for k, v in structured_cv["skills_grouped"].items():
          group_name = str(k).strip()
          if not group_name:
            continue
          values = [str(s).strip() for s in (v or []) if str(s).strip()]
          if values:
            tech_competencies[group_name] = values

      # 2) Otherwise, use the LLM to group skills dynamically.
      if not tech_competencies:
        skills = [str(s).strip() for s in (structured_cv.get("skills") or []) if s]
        if skills:
          try:
            grouped = group_skills_into_categories(skills)
          except Exception:
            grouped = {}
          if isinstance(grouped, dict) and grouped:
            # Enforce max 6 groups defensively even if the LLM misbehaves.
            for group_name, values in list(grouped.items())[:6]:
              values_clean = [str(s).strip() for s in (values or []) if str(s).strip()]
              if values_clean:
                tech_competencies[str(group_name).strip()] = values_clean

      # 3) Last-resort static fallback if everything above failed.
      if not tech_competencies:
        skills = [str(s).strip() for s in (structured_cv.get("skills") or []) if s]
        for skill in skills:
          key = "Other"
          lower = skill.lower()
          if any(x in lower for x in ["python", "node", "php", "java", ".net", "c#", "backend"]):
            key = "Backend"
          elif any(x in lower for x in ["react", "vue", "angular", "frontend", "css", "html", "js", "typescript"]):
            key = "Frontend"
          elif any(x in lower for x in ["devops", "docker", "kubernetes", "ci", "cd", "cloud"]):
            key = "DevOps"
          elif any(x in lower for x in ["sql", "database", "db", "mongo", "postgres", "mysql"]):
            key = "Database"
          tech_competencies.setdefault(key, []).append(skill)

      # Flatten for template: list of "Group: skill1, skill2"
      for group, skills in tech_competencies.items():
        if skills:
          tech_competencies_flat.append(f"{group}: {', '.join(skills)}")

      # Core skills: top 6 unique across all tech competencies.
      seen_core = set()
      for group in tech_competencies.values():
        for s in group:
          if s not in seen_core:
            core_skills.append(s)
            seen_core.add(s)
          if len(core_skills) >= 6:
            break
        if len(core_skills) >= 6:
          break
      # Languages: join name+level
      languages = []
      for lang in structured_cv.get("languages") or []:
        if isinstance(lang, dict):
          name_ = str(lang.get("name") or "").strip()
          level_ = str(lang.get("level") or "").strip()
          if name_:
            languages.append(f"{name_} ({level_})" if level_ else name_)
      # Education: join all degrees
      education = ", ".join([
        f"{e.get('degree', '')} {e.get('institution', '')}".strip()
        for e in (structured_cv.get("education") or []) if isinstance(e, dict)
      ])
      # Trainings: from certifications/courses
      trainings = ", ".join([
        str(c).strip() for c in (structured_cv.get("certifications") or []) if c
      ] + [str(c).strip() for c in (structured_cv.get("courses") or []) if c])
      # Recommendation: use full profile/summary
      recommendation = structured_cv.get("profile") or structured_cv.get("summary") or ""
      # Project experience: group by title/position, flatten for template
      project_experience_flat = []
      for job in structured_cv.get("work_experience") or []:
        if isinstance(job, dict):
          title = job.get("title") or "Other"
          period = job.get("from") or ""
          bullets = [str(b) for b in job.get("bullets") or [] if b]
          if bullets:
            project_experience_flat.append(f"{title} ({period}): {'; '.join(bullets)}")
          else:
            project_experience_flat.append(f"{title} ({period})")
      # Compose context for template
      context = {
        "name": name,
        "seniority": seniority,
        "core_skills": core_skills,
        "soft_skills": soft_skills,
        "languages": languages,
        "education": education,
        "trainings": trainings,
        "recommendation": recommendation,
        "tech_competencies_line": " | ".join(tech_competencies_flat),
        "project_experience_line": " | ".join(project_experience_flat),
      }
      # Render with landscape orientation (force via CSS if needed)
      html_out = template.render(**context)
      output_path.parent.mkdir(parents=True, exist_ok=True)
      try:
        # WeasyPrint landscape workaround: use CSS @page { size: landscape; }
        from weasyprint import CSS
        css_landscape = CSS(string='@page { size: A4 landscape; }')
        HTML(string=html_out).write_pdf(str(output_path), stylesheets=[css_landscape])
        print("[PDF] HTML render completed (competence, landscape)")
        return output_path
      except Exception as exc:
        print(f"[PDF] HTML render failed, falling back to FPDF: {exc}")
    else:
      # ...existing code for normal CV template...
      profile_summary_raw = str(structured_cv.get("profile") or "").strip()
      profile_summary = profile_summary_raw[:225]
      languages: List[Dict[str, str]] = []
      for lang in structured_cv.get("languages") or []:
        if isinstance(lang, dict):
          name = str(lang.get("name") or "").strip()
          level = str(lang.get("level") or "").strip()
          if name:
            languages.append({"name": name, "level": level})
      skills = [str(s).strip() for s in structured_cv.get("skills") or [] if isinstance(s, str) and str(s).strip()]
      skills = skills[:12]
      experience: List[Dict[str, Any]] = []
      for job in structured_cv.get("work_experience") or []:
        if not isinstance(job, dict):
          continue
        title = str(job.get("title") or "").strip()
        company = str(job.get("company") or "").strip()
        location = str(job.get("location") or "").strip()
        from_date = str(job.get("from") or "").strip()
        to_date = str(job.get("to") or "").strip()
        period_parts = [p for p in [from_date, to_date] if p]
        period = " - ".join(period_parts)
        if location:
          period = f"{period} · {location}" if period else location
        bullets = job.get("bullets") or []
        competence_bullets = [str(b).strip()[:220] for b in bullets if isinstance(b, str) and str(b).strip()]
        competence_bullets = competence_bullets[:4]
        experience.append(
          {
            "title": title,
            "company": company,
            "period": period,
            "competence_bullets": competence_bullets,
          }
        )
      education: List[Dict[str, str]] = []
      for edu in structured_cv.get("education") or []:
        if not isinstance(edu, dict):
          continue
        degree = str(edu.get("degree") or "").strip()
        institution = str(edu.get("institution") or "").strip()
        from_date = str(edu.get("from") or "").strip()
        to_date = str(edu.get("to") or "").strip()
        period_parts = [p for p in [from_date, to_date] if p]
        period = " - ".join(period_parts)
        education.append({"period": period, "degree": degree, "institution": institution})
      projects: List[Dict[str, Any]] = []
      for proj in structured_cv.get("projects") or []:
        if not isinstance(proj, dict):
          continue
        title = str(proj.get("title") or proj.get("name") or "").strip()
        company = str(proj.get("company") or proj.get("context") or "").strip()
        location = str(proj.get("location") or "").strip()
        from_date = str(proj.get("from") or "").strip()
        to_date = str(proj.get("to") or "").strip()
        period_parts = [p for p in [from_date, to_date] if p]
        period = " - ".join(period_parts)
        if location:
          period = f"{period} · {location}" if period else location
        bullets = proj.get("bullets") or []
        competence_bullets = [str(b).strip()[:220] for b in bullets if isinstance(b, str) and str(b).strip()]
        competence_bullets = competence_bullets[:4]
        projects.append(
          {
            "title": title,
            "company": company,
            "period": period,
            "competence_bullets": competence_bullets,
          }
        )
      courses = [str(c).strip() for c in structured_cv.get("courses") or [] if isinstance(c, str) and str(c).strip()]
      certifications = [
        str(c).strip()
        for c in structured_cv.get("certifications") or []
        if isinstance(c, str) and str(c).strip()
      ]
      logo_path = html_template_path.parent / "borek-logo" / "borek.png"
      logo_src = logo_path.as_uri() if logo_path.exists() else None
      context = {
        "profile": {"summary": profile_summary},
        "languages": languages,
        "skills": skills,
        "experience": experience,
        "education": education,
        "projects": projects,
        "courses": courses,
        "certifications": certifications,
        "logo_src": logo_src,
      }
      html_out = template.render(**context)
      output_path.parent.mkdir(parents=True, exist_ok=True)
      try:
        HTML(string=html_out).write_pdf(str(output_path))
        print("[PDF] HTML render completed")
        return output_path
      except Exception as exc:
        print(f"[PDF] HTML render failed, falling back to FPDF: {exc}")

  print("[PDF] Using FPDF fallback layout")
  # FPDF fallback layout (Ajlla-inspired) if HTML pipeline is unavailable.
  pdf = FPDF()
  pdf.set_auto_page_break(auto=True, margin=12)
  pdf.add_page()

  # Global font setup
  pdf.set_font("Helvetica", "", 11)

  # Profile / headline section
  profile = str(structured_cv.get("profile") or "").strip()
  if profile:
    _pdf_add_section_title(pdf, "Profile")
    pdf.set_font("Helvetica", "", 11)
    _safe_multi_cell(pdf, 0, 6, profile)

  # Work Experience
  work_experience = structured_cv.get("work_experience") or []
  if isinstance(work_experience, list) and work_experience:
    _pdf_add_section_title(pdf, "Work Experience")
    for job in work_experience:
      if not isinstance(job, dict):
        continue
      title = str(job.get("title") or "").strip()
      company = str(job.get("company") or "").strip()
      location = str(job.get("location") or "").strip()
      from_date = str(job.get("from") or "").strip()
      to_date = str(job.get("to") or "").strip()
      bullets = job.get("bullets") or []
      if not isinstance(bullets, list):
        bullets = []

      # Job header line
      header_parts = [p for p in [title, company] if p]
      header = " | ".join(header_parts) if header_parts else ""
      dates = " - ".join([p for p in [from_date, to_date] if p])

      if header:
        _pdf_add_small_heading(pdf, header)
      if dates or location:
        pdf.set_font("Helvetica", "I", 9)
        meta_parts = [dates, location]
        meta = "  ·  ".join([p for p in meta_parts if p])
        if meta:
          pdf.cell(0, 5, _sanitize_for_pdf(meta), ln=True)

      # Bullets
      pdf.set_font("Helvetica", "", 10)
      for bullet in bullets:
        if not isinstance(bullet, str):
          continue
        text = bullet.strip()
        if not text:
          continue
        # Use ASCII-safe bullet to avoid Unicode font issues
        # Start bullets on a fresh line with a small indent to guarantee width.
        pdf.ln(0)
        pdf.set_x(pdf.l_margin)
        bullet_indent = 4
        pdf.cell(bullet_indent, 5, "-")
        pdf.set_x(pdf.l_margin + bullet_indent)
        available_w = pdf.w - pdf.l_margin - pdf.r_margin - bullet_indent
        _safe_multi_cell(pdf, available_w, 5, text)
      pdf.ln(1)

  # Certifications (placed immediately after Work Experience)
  certifications = structured_cv.get("certifications") or []
  if isinstance(certifications, list) and certifications:
    _pdf_add_section_title(pdf, "Certifications")
    pdf.set_font("Helvetica", "", 10)
    for cert in certifications:
      if not isinstance(cert, str):
        continue
      text = cert.strip()
      if not text:
        continue
      pdf.ln(0)
      pdf.set_x(pdf.l_margin)
      bullet_indent = 4
      pdf.cell(bullet_indent, 5, "-")
      pdf.set_x(pdf.l_margin + bullet_indent)
      available_w = pdf.w - pdf.l_margin - pdf.r_margin - bullet_indent
      _safe_multi_cell(pdf, available_w, 5, text)

  # Education
  education = structured_cv.get("education") or []
  if isinstance(education, list) and education:
    _pdf_add_section_title(pdf, "Education")
    for edu in education:
      if not isinstance(edu, dict):
        continue
      degree = str(edu.get("degree") or "").strip()
      institution = str(edu.get("institution") or "").strip()
      from_date = str(edu.get("from") or "").strip()
      to_date = str(edu.get("to") or "").strip()

      header_parts = [p for p in [degree, institution] if p]
      header = " | ".join(header_parts) if header_parts else ""
      dates = " - ".join([p for p in [from_date, to_date] if p])

      if header:
        _pdf_add_small_heading(pdf, header)
      if dates:
        pdf.set_font("Helvetica", "I", 9)
        pdf.cell(0, 5, _sanitize_for_pdf(dates), ln=True)
      pdf.set_font("Helvetica", "", 10)
      pdf.ln(1)

  # Projects
  projects = structured_cv.get("projects") or []
  if isinstance(projects, list) and projects:
    _pdf_add_section_title(pdf, "Projects")
    for project in projects:
      if not isinstance(project, dict):
        continue
      title = str(project.get("title") or project.get("name") or "").strip()
      company = str(project.get("company") or project.get("context") or "Personal Project").strip()
      location = str(project.get("location") or "").strip()
      from_date = str(project.get("from") or "").strip()
      to_date = str(project.get("to") or "").strip()
      bullets = project.get("bullets") or []
      if not isinstance(bullets, list):
        bullets = []

      header_parts = [p for p in [title, company] if p]
      header = " | ".join(header_parts) if header_parts else ""
      dates = " - ".join([p for p in [from_date, to_date] if p])

      if header:
        _pdf_add_small_heading(pdf, header)
      if dates or location:
        pdf.set_font("Helvetica", "I", 9)
        meta_parts = [dates, location]
        meta = "  ·  ".join([p for p in meta_parts if p])
        if meta:
          pdf.cell(0, 5, _sanitize_for_pdf(meta), ln=True)

      pdf.set_font("Helvetica", "", 10)
      for bullet in bullets:
        if not isinstance(bullet, str):
          continue
        text = bullet.strip()
        if not text:
          continue
        pdf.ln(0)
        pdf.set_x(pdf.l_margin)
        bullet_indent = 4
        pdf.cell(bullet_indent, 5, "-")
        pdf.set_x(pdf.l_margin + bullet_indent)
        available_w = pdf.w - pdf.l_margin - pdf.r_margin - bullet_indent
        _safe_multi_cell(pdf, available_w, 5, text)
      pdf.ln(1)

  # Skills
  skills = structured_cv.get("skills") or []
  if isinstance(skills, list) and skills:
    _pdf_add_section_title(pdf, "Skills")
    pdf.set_font("Helvetica", "", 11)
    skills_line = ", ".join(
      str(s) for s in skills if isinstance(s, str) and s.strip()
    )
    _safe_multi_cell(pdf, 0, 6, skills_line)

  # Courses
  courses = structured_cv.get("courses") or []
  if isinstance(courses, list) and courses:
    _pdf_add_section_title(pdf, "Courses")
    pdf.set_font("Helvetica", "", 10)
    for course in courses:
      if not isinstance(course, str):
        continue
      text = course.strip()
      if not text:
        continue
      pdf.ln(0)
      pdf.set_x(pdf.l_margin)
      bullet_indent = 4
      pdf.cell(bullet_indent, 5, "-")
      pdf.set_x(pdf.l_margin + bullet_indent)
      available_w = pdf.w - pdf.l_margin - pdf.r_margin - bullet_indent
      _safe_multi_cell(pdf, available_w, 5, text)

  # Languages (placed last)
  languages: List[Dict[str, Any]] = []
  raw_languages = structured_cv.get("languages") or []
  if isinstance(raw_languages, list):
    for lang in raw_languages:
      if isinstance(lang, dict) and "name" in lang and "level" in lang:
        languages.append(lang)

  if languages:
    _pdf_add_section_title(pdf, "Languages")
    pdf.set_font("Helvetica", "", 11)
    for lang in languages:
      name = str(lang.get("name") or "").strip()
      level = str(lang.get("level") or "").strip()
      if not name:
        continue
      line = f"{name}: {level}" if level else name
      pdf.cell(0, 6, _sanitize_for_pdf(line), ln=True)

  output_path.parent.mkdir(parents=True, exist_ok=True)
  pdf.output(str(output_path))
  return output_path


