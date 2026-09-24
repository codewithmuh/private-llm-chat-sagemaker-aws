"""A fake model that runs inside the backend process.

No GPU, no server, no AWS: useful for tests and for the very first run
(`python manage.py runserver`). It streams a markdown answer that shows off
what the UI can render and echoes back what it was sent, so you can see
exactly what the backend passes to a model (system prompt, history, documents,
images).
"""

from __future__ import annotations

import re
import time
from collections.abc import Iterator

from .base import ChatRequest, Provider, Usage


def _text_of(content) -> tuple[str, int, list[str]]:
    """(text, image_count, document_names) of one message's content."""
    if isinstance(content, str):
        return content, 0, re.findall(r'<document name="([^"]+)"', content)
    text_parts, images = [], 0
    for part in content or []:
        if part.get("type") == "text":
            text_parts.append(part.get("text", ""))
        elif part.get("type") == "image_url":
            images += 1
    text = "\n".join(text_parts)
    return text, images, re.findall(r'<document name="([^"]+)"', text)


def mock_answer(request: ChatRequest) -> str:
    messages = request.messages
    system = next((m for m in messages if m.get("role") == "system"), None)
    last_user = next((m for m in reversed(messages) if m.get("role") == "user"), {"content": ""})
    text, images, documents = _text_of(last_user.get("content"))
    question = re.sub(r"<document.*?</document>", "", text, flags=re.DOTALL).strip()

    lowered = question.lower()
    if lowered.startswith("transcribe all text"):
        return (
            "# Sample document\n\nThis text came from the **mock OCR**. Deploy a vision model "
            "(or install Tesseract) to read real images.\n\n| Item | Qty |\n|---|---|\n| Coffee | 2 |"
        )
    if "short title" in lowered:
        # The title prompt (apps/chat/titles.py) wraps the first message in
        # <message> tags. Echo its first few words as the "title".
        first = re.search(r"<message>(.*?)</message>", text, re.DOTALL)
        words = re.findall(r"[\w']+", first.group(1) if first else "")[:5]
        return " ".join(words).capitalize() or "New conversation"

    turns = sum(1 for m in messages if m.get("role") in ("user", "assistant"))
    lines = [
        "Hi! I'm the **mock model**: I don't understand anything, but I show you what the backend sent to the model.",
        "",
        f"- Your message: _{question[:200] or '(empty)'}_",
        f"- Turns in the conversation so far: **{turns}**",
        f"- System prompt: **{'yes' if system else 'no'}** ({len(system['content']) if system else 0} characters)",
    ]
    if documents:
        lines.append(f"- Documents attached: {', '.join(f'`{d}`' for d in documents)}")
    if images:
        lines.append(f"- Images attached: **{images}** (sent as base64 `image_url` parts)")
    lines += [
        "",
        "Here is some markdown so you can check the rendering:",
        "",
        "```python",
        "def greet(name: str) -> str:",
        '    return f"Hello, {name}!"',
        "```",
        "",
        "| Provider | Runs where |",
        "|---|---|",
        "| `sagemaker` | a GPU endpoint in your AWS account |",
        "| `openai` | vLLM, Ollama, LM Studio... |",
        "| `mock` | right here, in the backend |",
        "",
        "Math works too: $$E = mc^2$$",
        "",
        "To talk to a real model, follow **docs/02-run-a-real-model-locally.md** "
        "(Ollama) or **docs/03-deploy-a-model-on-sagemaker.md**.",
    ]
    return "\n".join(lines)


class MockProvider(Provider):
    def __init__(self, delay_seconds: float = 0.02):
        self.delay = delay_seconds

    def stream(self, request: ChatRequest) -> Iterator[str | Usage]:
        answer = mock_answer(request)
        for token in re.findall(r"\S+\s*|\s+", answer):
            if self.delay:
                time.sleep(self.delay)
            yield token
        prompt_chars = sum(len(str(m.get("content", ""))) for m in request.messages)
        yield Usage(prompt_tokens=prompt_chars // 4, completion_tokens=len(answer) // 4)
