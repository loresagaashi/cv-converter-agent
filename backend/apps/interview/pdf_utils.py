from pathlib import Path
from typing import Any

from django.conf import settings
from fpdf import FPDF

from apps.cv.pdf_renderer import _sanitize_for_pdf

try:
    from weasyprint import HTML, CSS  # type: ignore
    _HTML_RENDER_AVAILABLE = True
    # print("[PDF] ✅ WeasyPrint is available for interview papers")
except Exception as exc:
    _HTML_RENDER_AVAILABLE = False
    HTML = None  # type: ignore
    CSS = None  # type: ignore
    print(f"[PDF] ⚠️ WeasyPrint not available for interview papers: {exc}")
    import traceback
    traceback.print_exc()


def render_conversation_paper_to_pdf(
    content: str,
    *,
    output_path: Path,
    title: str = "Conversation Competence Paper",
) -> Path:
    """
    Render a conversation-based competence paper to PDF.
    
    If content is HTML (starts with <!DOCTYPE html> or <html), use WeasyPrint to render it.
    Otherwise, fall back to FPDF for plain text.
    """
    content = (content or "").strip()
    
    # Check if content is HTML
    is_html = content.startswith('<!DOCTYPE html>') or content.startswith('<html')
    
    if is_html and _HTML_RENDER_AVAILABLE and HTML:
        try:
            # Use WeasyPrint to render HTML to PDF (same as preview mode)
            output_path.parent.mkdir(parents=True, exist_ok=True)
            # Use landscape orientation for competence papers (same as preview)
            css_landscape = CSS(string='@page { size: A4 landscape; }')
            HTML(string=content).write_pdf(str(output_path), stylesheets=[css_landscape])
            return output_path
        except Exception as e:
            # Fall back to FPDF if WeasyPrint fails
            print(f"[PDF] WeasyPrint render failed, falling back to FPDF: {e}")
    
    # Fallback to FPDF for plain text or if WeasyPrint is unavailable
    text = content
    
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



