"""A short title for a new conversation, written by the model itself.

It runs once, right after the first answer, on the same (already warm) model.
If anything goes wrong we fall back to the first few words of the question:
a missing title must never break a chat.
"""

from __future__ import annotations

import logging
import re

from django.conf import settings

from apps.llm.models import LLMModel
from apps.llm.providers import ChatRequest, ProviderError, provider_for

log = logging.getLogger(__name__)

TITLE_PROMPT = (
    "Write a short title (at most 6 words) for a conversation that starts with the "
    "message below. Reply with the title only: no quotes, no punctuation at the end.\n\n"
    "<message>{message}</message>"
)


def fallback_title(text: str) -> str:
    words = re.findall(r"\S+", text.strip())
    title = " ".join(words[:6])
    if len(words) > 6:
        title += "…"
    return title[:80] or "New chat"


def clean_title(raw: str) -> str:
    text = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL)
    text = text.strip().splitlines()[0] if text.strip() else ""
    text = text.strip().strip("\"'`*#").strip()
    text = re.sub(r"^(title\s*:\s*)", "", text, flags=re.IGNORECASE)
    return text.rstrip(".")[:80]


def generate_title(model: LLMModel, first_message: str) -> str:
    if not settings.TITLE_GENERATION or not first_message.strip():
        return fallback_title(first_message)
    request = ChatRequest(
        messages=[{"role": "user", "content": TITLE_PROMPT.format(message=first_message[:1500])}],
        max_tokens=30,
        temperature=0.2,
    )
    try:
        title = clean_title(provider_for(model).complete(request).text)
    except ProviderError:
        log.info("title generation failed; using fallback", extra={"model": model.slug})
        title = ""
    return title or fallback_title(first_message)
