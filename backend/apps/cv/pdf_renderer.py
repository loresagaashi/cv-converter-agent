from pathlib import Path
from typing import Any, Dict, List

from fpdf import FPDF


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
  - sanitizes text to latin-1, and
  - truncates content if FPDF reports not enough horizontal space.
  """
  clean = _sanitize_for_pdf(text)
  if not clean:
    return
  try:
    pdf.multi_cell(w, h, clean)
  except Exception:
    # Truncate aggressively to avoid layout errors on pathological long tokens.
    truncated = clean[:200]
    if truncated:
      pdf.multi_cell(w, h, truncated)


def render_structured_cv_to_pdf(structured_cv: Dict[str, Any], *, output_path: Path) -> Path:
  """
  Render a normalized structured CV into a fixed-layout PDF.

  The layout is inspired by the Ajlla_Product Owner.pdf:
  - Profile at the top
  - Languages, Skills
  - Work Experience
  - Education
  - Courses

  The function is deterministic: same input -> same PDF bytes.
  """
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

  # Languages
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

  # Skills
  skills = structured_cv.get("skills") or []
  if isinstance(skills, list) and skills:
    _pdf_add_section_title(pdf, "Skills")
    pdf.set_font("Helvetica", "", 11)
    skills_line = ", ".join(
      str(s) for s in skills if isinstance(s, str) and s.strip()
    )
    _safe_multi_cell(pdf, 0, 6, skills_line)

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
        pdf.cell(3, 5, "-")
        _safe_multi_cell(pdf, 0, 5, text)
      pdf.ln(1)

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
      pdf.cell(3, 5, "-")
      _safe_multi_cell(pdf, 0, 5, text)

  output_path.parent.mkdir(parents=True, exist_ok=True)
  pdf.output(str(output_path))
  return output_path


