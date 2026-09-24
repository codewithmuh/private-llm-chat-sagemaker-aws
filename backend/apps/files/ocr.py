"""OCR: turn an image (or a scanned PDF) into text.

Two engines:

    llm         a vision model reads the image. Understands layout, tables,
                handwriting and many languages. Needs a vision-capable model
                (e.g. Qwen3-VL on SageMaker, or `qwen2.5vl` in Ollama).
    tesseract   classic open-source OCR on the CPU. No GPU needed; weaker on
                photos, layouts and handwriting. Installed in the Docker image.

OCR_ENGINE=auto (the default) uses a ready vision/OCR model when there is one,
and Tesseract otherwise.
"""

from __future__ import annotations

import logging
import shutil
import time
from dataclasses import dataclass

from django.conf import settings
from PIL import Image

from apps.common.errors import ApiError
from apps.llm.models import LLMModel
from apps.llm.providers import ChatRequest, ProviderError, provider_for
from apps.llm.services import ensure_ready

from .images import image_part, load_image, to_data_uri
from .models import Attachment

log = logging.getLogger(__name__)

OCR_MAX_PAGES = 10
# The prompt matters more than you'd think. "Transcribe" (not "describe") and
# "no commentary" stop the model from summarizing instead of reading.
OCR_PROMPT = (
    "Transcribe all text in this image exactly as written, in its original language. "
    "Keep the reading order. Use Markdown for structure: headings, lists and tables. "
    "Do not describe the image, add commentary, or translate. "
    "If there is no text, reply exactly: (no text found)"
)


@dataclass
class OcrResult:
    text: str
    engine: str
    duration_ms: int


def tesseract_available() -> bool:
    return shutil.which("tesseract") is not None


def pages_of(attachment: Attachment) -> list[Image.Image]:
    with attachment.file.open("rb") as fh:
        data = fh.read()
    if attachment.kind == Attachment.Kind.IMAGE:
        return [load_image(data)]
    if attachment.content_type == "application/pdf":
        import pypdfium2 as pdfium

        pdf = pdfium.PdfDocument(data)
        try:
            images = []
            for index in range(min(len(pdf), OCR_MAX_PAGES)):
                page = pdf[index]
                # scale=2 renders at 144 dpi: sharp enough for small print.
                images.append(page.render(scale=2).to_pil().convert("RGB"))
                page.close()
            return images
        finally:
            pdf.close()
    raise ApiError("OCR works on images and PDFs.", code="unsupported_file_type", status_code=415)


def pick_llm(requested: str | None) -> LLMModel | None:
    """The model to OCR with: the one asked for, else the best ready candidate."""
    enabled = LLMModel.objects.filter(enabled=True)
    if requested:
        model = enabled.filter(slug=requested).first()
        if model is None or not (model.vision or model.ocr):
            raise ApiError("That model cannot read images.", code="invalid", fields={"model": "Pick a vision model."})
        return model
    candidates = list(enabled.filter(ocr=True)) + list(enabled.filter(vision=True, ocr=False))
    ready = [m for m in candidates if m.public_status()[0] == "ready"]
    if ready:
        return ready[0]
    if candidates and not tesseract_available():
        return candidates[0]  # will raise model_starting with a useful message
    return None


def ocr_with_llm(model: LLMModel, pages: list[Image.Image]) -> str:
    ensure_ready(model)
    provider = provider_for(model)
    texts = []
    for page in pages:
        request = ChatRequest(
            messages=[
                {"role": "user", "content": [{"type": "text", "text": OCR_PROMPT}, image_part(to_data_uri(page))]}
            ],
            max_tokens=model.max_output_tokens,
            temperature=0.0,
        )
        try:
            texts.append(provider.complete(request).text.strip())
        except ProviderError as exc:
            raise ApiError(
                exc.message, code=exc.code, status_code=503 if exc.code.startswith("model_") else 502
            ) from None
    return _join(texts)


def ocr_with_tesseract(pages: list[Image.Image]) -> str:
    import pytesseract

    try:
        return _join([pytesseract.image_to_string(page).strip() for page in pages])
    except pytesseract.TesseractNotFoundError:
        raise ApiError(
            "No OCR engine is available: deploy a vision model or install Tesseract.",
            code="ocr_unavailable",
            status_code=503,
        ) from None


def _join(texts: list[str]) -> str:
    if len(texts) == 1:
        return texts[0]
    return "\n\n".join(f"[Page {i + 1}]\n{t}" for i, t in enumerate(texts))


def run_ocr(attachment: Attachment, *, model_slug: str | None = None, force: bool = False) -> OcrResult:
    if attachment.text_source == Attachment.TextSource.OCR and attachment.text and not force and not model_slug:
        return OcrResult(attachment.text, attachment.ocr_engine, 0)

    engine_setting = settings.OCR_ENGINE
    if engine_setting == "none":
        raise ApiError("OCR is turned off on this server.", code="ocr_unavailable", status_code=503)

    started = time.monotonic()
    pages = pages_of(attachment)
    model = None if engine_setting == "tesseract" else pick_llm(model_slug)
    if model is not None:
        text = ocr_with_llm(model, pages)
        engine = f"llm:{model.slug}"
    elif engine_setting in ("auto", "tesseract"):
        text = ocr_with_tesseract(pages)
        engine = "tesseract"
    else:
        raise ApiError("No vision model is configured for OCR.", code="ocr_unavailable", status_code=503)

    duration_ms = int((time.monotonic() - started) * 1000)
    attachment.text = text
    attachment.text_source = Attachment.TextSource.OCR
    attachment.ocr_engine = engine
    attachment.save(update_fields=["text", "text_source", "ocr_engine"])
    log.info(
        "ocr done",
        extra={"attachment_id": str(attachment.id), "engine": engine, "duration_ms": duration_ms, "pages": len(pages)},
    )
    return OcrResult(text, engine, duration_ms)
