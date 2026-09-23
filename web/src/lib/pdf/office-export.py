"""Bounded local PDF export. Stdout is a small, content-free JSON protocol."""
import importlib.util
import json
import logging
import os
from pathlib import Path
import resource
import subprocess
import sys

import pdfplumber


class ExportError(Exception):
    pass


def emit(**values):
    print(json.dumps(values), flush=True)


def inspect_pdf(source):
    scans = []
    with pdfplumber.open(source) as pdf:
        if not 1 <= len(pdf.pages) <= 100:
            raise ExportError("PDF_OFFICE_PAGE_LIMIT")
        for page in pdf.pages:
            if page.width <= 0 or page.height <= 0 or page.width * page.height * 4 > 40_000_000:
                raise ExportError("PDF_OFFICE_PAGE_TOO_LARGE")
            if len(page.chars) > 100_000:
                raise ExportError("PDF_OFFICE_PAGE_TOO_COMPLEX")
            if not any(c.get("text", "").strip() for c in page.chars) and page.images:
                scans.append(page.page_number)
            page.close()
    return scans


def main():
    resource.setrlimit(resource.RLIMIT_AS, (1536 * 1024**2, 1536 * 1024**2))
    resource.setrlimit(resource.RLIMIT_CPU, (480, 485))
    logging.disable(logging.CRITICAL)
    source, output, extension = sys.argv[1:]
    if extension not in ("docx", "xlsx"):
        raise ExportError("PDF_OFFICE_FORMAT_INVALID")
    emit(progress=5)
    scans = inspect_pdf(source)
    if scans:
        target = str(Path(output).parent / "recognized.pdf")
        try:
            result = subprocess.run([
                "ocrmypdf", "--skip-text", "--pages", ",".join(map(str, scans)),
                "--output-type", "pdf", "--optimize", "0", "--jobs", "1",
                "--tesseract-timeout", "45", "--skip-big", "40", "--language", "por+eng",
                source, target,
            ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=240,
                env={**os.environ, "OMP_THREAD_LIMIT": "1"})
        except (FileNotFoundError, subprocess.TimeoutExpired):
            raise ExportError("PDF_OFFICE_OCR_FAILED") from None
        if result.returncode or not Path(target).is_file():
            raise ExportError("PDF_OFFICE_OCR_FAILED")
        source = target
        # An OCR timeout or unreadable scan must never produce a silently empty file.
        with pdfplumber.open(source) as pdf:
            for number in scans:
                page = pdf.pages[number-1]
                if not any(c.get("text", "").strip() for c in page.chars):
                    raise ExportError("PDF_OFFICE_OCR_NO_TEXT")
                page.close()
    emit(progress=40, ocrPages=len(scans))
    name = "word" if extension == "docx" else "excel"
    spec = importlib.util.spec_from_file_location("office_export_" + name,
                                                 Path(__file__).with_name("office-export-" + name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with pdfplumber.open(source) as pdf:
        result = getattr(module, "export_" + name)(pdf, output)
    if not Path(output).is_file() or Path(output).stat().st_size > 100 * 1024**2:
        raise ExportError("PDF_OFFICE_OUTPUT_TOO_LARGE")
    emit(progress=95, **result)


if __name__ == "__main__":
    try:
        main()
    except ExportError as error:
        emit(error=str(error))
        sys.exit(1)
    except (MemoryError, OSError):
        emit(error="PDF_OFFICE_RESOURCE_LIMIT")
        sys.exit(1)
    except Exception:
        # PDF parser diagnostics may contain uploaded text. Do not log payloads.
        emit(error="PDF_OFFICE_CONVERSION_FAILED")
        sys.exit(1)
