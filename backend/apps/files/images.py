"""Preparing images for a vision model.

Vision models turn an image into hundreds or thousands of tokens, and cost
grows with resolution. Most phone photos are 12+ megapixels; the models look
at far less. Shrinking to a longest side of ~1536 px and re-encoding as JPEG
keeps text readable and cuts the request size by 10x or more.

The image is sent inline as a base64 `data:` URI in an OpenAI `image_url`
content part. That works with vLLM, Ollama, SageMaker containers and OpenAI,
and the model server never needs access to our storage.
"""

from __future__ import annotations

import base64
import io

from PIL import Image, ImageOps

MAX_SIDE = 1536


def load_image(data: bytes) -> Image.Image:
    img = Image.open(io.BytesIO(data))
    img = ImageOps.exif_transpose(img)  # respect the phone's rotation flag
    if getattr(img, "is_animated", False):
        img.seek(0)  # first frame of a GIF
    if img.mode in ("RGBA", "LA", "P"):
        # Transparent PNGs: flatten onto white (JPEG has no transparency, and
        # black backgrounds make dark text invisible).
        img = img.convert("RGBA")
        background = Image.new("RGB", img.size, (255, 255, 255))
        background.paste(img, mask=img.split()[-1])
        return background
    return img.convert("RGB")


def to_data_uri(img: Image.Image, max_side: int = MAX_SIDE, quality: int = 85) -> str:
    img = img.copy()
    img.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
    buffer = io.BytesIO()
    img.save(buffer, format="JPEG", quality=quality, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode()


def image_part(data_uri: str) -> dict:
    return {"type": "image_url", "image_url": {"url": data_uri}}
