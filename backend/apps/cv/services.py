import mimetypes
import os
from typing import BinaryIO, Optional

from django.core.files import File


def _normalize_text(text: str) -> str:
    """
    Basic cleanup for extracted text.

    - Strips trailing spaces on each line.
    - Collapses excessive blank lines.
    """

    if not text:
        return ""

    # Strip trailing spaces for each line
    lines = [line.rstrip() for line in text.splitlines()]

    # Collapse sequences of more than 2 blank lines down to a single blank line
    cleaned_lines = []
    blank_count = 0
    for line in lines:
        if line.strip():
            blank_count = 0
            cleaned_lines.append(line)
        else:
            blank_count += 1
            if blank_count <= 1:
                cleaned_lines.append("")

    return "\n".join(cleaned_lines).strip()


def read_pdf(file_obj: BinaryIO) -> str:
    """
    Extract text from a PDF file-like object using PyPDF2.

    `file_obj` can be:
      - a Django `File` / `FieldFile` instance
      - any binary file-like object opened in 'rb' mode
    """
    try:
        import PyPDF2
    except ImportError as exc:
        raise ImportError(
            "PyPDF2 must be installed to parse PDF files. "
            "Install it with 'pip install PyPDF2'."
        ) from exc

    # Ensure we are working with a raw file-like object
    if isinstance(file_obj, File):
        fp = file_obj.open("rb") if file_obj.closed else file_obj
    else:
        fp = file_obj

    # Rewind in case the caller already read some bytes
    try:
        fp.seek(0)
    except (AttributeError, OSError):
        pass

    reader = PyPDF2.PdfReader(fp)
    text_chunks = []

    for page in reader.pages:
        try:
            page_text = page.extract_text() or ""
        except Exception:
            # Ignore problematic pages rather than failing the whole document
            page_text = ""
        if page_text:
            text_chunks.append(page_text)

    return _normalize_text("\n\n".join(text_chunks))


def read_docx(file_obj: BinaryIO) -> str:
    """
    Extract text from a DOCX file-like object using python-docx.

    `file_obj` can be:
      - a Django `File` / `FieldFile` instance
      - any binary file-like object opened in 'rb' mode
    """
    try:
        import docx  # python-docx
    except ImportError as exc:
        raise ImportError(
            "python-docx must be installed to parse DOCX files. "
            "Install it with 'pip install python-docx'."
        ) from exc

    # Ensure we are working with a raw file-like object
    if isinstance(file_obj, File):
        fp = file_obj.open("rb") if file_obj.closed else file_obj
    else:
        fp = file_obj

    # Rewind in case the caller already read some bytes
    try:
        fp.seek(0)
    except (AttributeError, OSError):
        pass

    document = docx.Document(fp)
    paragraphs = [p.text for p in document.paragraphs if p.text]

    return _normalize_text("\n".join(paragraphs))


def guess_file_type(
    name: Optional[str] = None,
    content_type: Optional[str] = None,
) -> Optional[str]:
    """
    Infer file type (currently 'pdf' or 'docx') from name and/or MIME type.

    Returns 'pdf', 'docx' or None if the type cannot be determined.
    """
    # 1) Explicit content_type if provided
    if content_type:
        lc_type = content_type.lower()
        if "pdf" in lc_type:
            return "pdf"
        if "word" in lc_type or "officedocument.wordprocessingml.document" in lc_type:
            return "docx"

    # 2) Fallback to extension from name
    if name:
        ext = os.path.splitext(name)[1].lower()
        if ext == ".pdf":
            return "pdf"
        if ext == ".docx":
            return "docx"

    # 3) Last resort: let mimetypes guess from the name
    if name:
        guessed_type, _ = mimetypes.guess_type(name)
        if guessed_type:
            guessed_type = guessed_type.lower()
            if "pdf" in guessed_type:
                return "pdf"
            if "word" in guessed_type or "officedocument.wordprocessingml.document" in guessed_type:
                return "docx"

    return None


def read_cv_file(file_obj: BinaryIO, *, name: Optional[str] = None, content_type: Optional[str] = None) -> str:
    """
    Convenience helper that:
      1. Determines the file type (pdf/docx) from name/content_type.
      2. Dispatches to the appropriate parser.

    Example usage with a `CV` instance:

        cv = CV.objects.first()
        text = read_cv_file(cv.file, name=cv.original_filename, content_type=cv.file.file.content_type)
    """
    # --- LOGGING: Verify file source (Cloudinary vs local disk) ---
    try:
        # Try to get the URL if it exists (Cloudinary/S3 files have this)
        file_url = getattr(file_obj, 'url', 'No URL attribute')
        print(f"[FILE LOAD] Reading CV from: {file_url}")
        print(f"[FILE LOAD] File name: {name}")
        print(f"[FILE LOAD] File object type: {type(file_obj)}")
    except Exception as e:
        print(f"[FILE LOAD] Could not determine URL: {e}")
    # --------------------------------------------------------------
    
    file_type = guess_file_type(name=name, content_type=content_type)

    if file_type == "pdf":
        return read_pdf(file_obj)
    if file_type == "docx":
        return read_docx(file_obj)

    raise ValueError(f"Unsupported or unknown CV file type for name={name!r}, content_type={content_type!r}")


def read_cv_from_path(path: str) -> str:
    """
    Utility mainly for local testing:

    Given an absolute or relative filesystem path to a CV file,
    open it, detect file type, and return extracted text.

    Usage from a Django shell:

        from apps.cv.services import read_cv_from_path
        text = read_cv_from_path('path/to/my_cv.pdf')
        print(text[:500])
    """
    if not os.path.exists(path):
        raise FileNotFoundError(f"File does not exist: {path}")

    name = os.path.basename(path)

    with open(path, "rb") as f:
        # Let guess_file_type infer from extension
        file_type = guess_file_type(name=name)
        if file_type == "pdf":
            return read_pdf(f)
        if file_type == "docx":
            return read_docx(f)

        raise ValueError(f"Unsupported or unknown CV file type for path={path!r}")


