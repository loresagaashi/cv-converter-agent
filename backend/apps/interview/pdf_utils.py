from pathlib import Path
from typing import Any

from fpdf import FPDF

from apps.cv.pdf_renderer import _sanitize_for_pdf


def render_conversation_paper_to_pdf(
    content: str,
    *,
    output_path: Path,
    title: str = "Conversation Competence Paper",
) -> Path:
    """
    Render a plain-text conversation-based competence paper to a simple PDF.

    This is intentionally minimal but uses the same latin-1 sanitization as the
    main CV renderer to avoid font issues.
    """
    text = (content or "").strip()

    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()

    # Title
    pdf.set_font("Helvetica", "B", 14)
    pdf.cell(0, 10, _sanitize_for_pdf(title), ln=True)
    pdf.ln(4)

    # Body
    pdf.set_font("Helvetica", "", 11)
    cleaned = _sanitize_for_pdf(text)
    if cleaned:
        pdf.multi_cell(0, 6, cleaned)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    pdf.output(str(output_path))
    return output_path



