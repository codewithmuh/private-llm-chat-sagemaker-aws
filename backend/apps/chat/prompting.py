"""Building the prompt: turning a conversation into what the model reads.

A chat model has no memory. Every turn, we send it the whole conversation
again, as a list of OpenAI-style messages:

    [{"role": "system",    "content": "You are ..."},
     {"role": "user",      "content": [<document text>, <image>, "the question"]},
     {"role": "assistant", "content": "the previous answer"},
     {"role": "user",      "content": "a follow-up"}]

Three things make this more than a loop:

1. **Attachments.** Documents become text inside <document> tags. Images go
   in as pictures if the model has vision; otherwise their OCR text is used.
2. **The context window.** A model reads at most `context_window` tokens,
   including its own answer. When the conversation is too long we drop the
   oldest plain turns first, then trim the biggest documents, and only then
   give up. See `fit_to_window`.
3. **Chat templates are strict.** Many models (Llama, Mistral, Gemma) reject a
   conversation unless roles alternate user/assistant starting with user, so
   consecutive same-role messages are merged.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from django.conf import settings
from django.utils import timezone

from apps.files.images import image_part, load_image, to_data_uri
from apps.files.models import Attachment
from apps.llm.models import LLMModel

from .models import Conversation, Message

SYSTEM_PROMPT = (
    "You are {app_name}, a helpful assistant. Today's date is {date}. "
    "Format answers in Markdown. When the user attaches files, their contents appear "
    "inside <document> or <image> tags: base your answer on them, quote them when useful, "
    "and say so when the answer is not in them."
)
# Images only for the most recent user turns: each image costs 1,000-3,000
# tokens every time the conversation is re-sent.
IMAGES_FROM_LAST_N_TURNS = 2
CHAT_IMAGE_MAX_SIDE = 1280
IMAGE_TOKEN_ESTIMATE = 1500
# Tokens kept free for the chat template's own markup.
TEMPLATE_OVERHEAD = 200
MIN_ANSWER_TOKENS = 256
# Documents are never trimmed below this many characters.
MIN_DOC_CHARS = 1000

_THINK = re.compile(r"<think>.*?</think>\s*", re.DOTALL)


class ContextTooLong(Exception):
    pass


def estimate_tokens(text: str) -> int:
    """Rough token count without a tokenizer: ~3 characters per token.

    Real tokenizers average ~4 characters per token for English, fewer for
    code and non-Latin scripts. Erring low on characters-per-token means we
    trim a little early rather than send a request the server rejects.
    """
    return len(text) // 3 + 1


@dataclass
class Turn:
    role: str
    text: str = ""
    documents: list[tuple[str, str]] = field(default_factory=list)  # (opening tag, text)
    images: list[str] = field(default_factory=list)  # data URIs
    has_attachments: bool = False

    def tokens(self) -> int:
        doc_tokens = sum(estimate_tokens(tag + text) for tag, text in self.documents)
        return estimate_tokens(self.text) + doc_tokens + IMAGE_TOKEN_ESTIMATE * len(self.images) + 4

    def content(self):
        doc_block = "\n\n".join(f"{tag}\n{text}\n</{_tag_name(tag)}>" for tag, text in self.documents)
        text = f"{doc_block}\n\n{self.text}".strip() if doc_block else self.text
        if not self.images:
            return text
        parts: list[dict] = [image_part(uri) for uri in self.images]
        if text:
            parts.append({"type": "text", "text": text})
        return parts


def _tag_name(opening: str) -> str:
    return "image" if opening.startswith("<image") else "document"


def system_prompt(conversation: Conversation, user) -> str:
    parts = [SYSTEM_PROMPT.format(app_name=settings.APP_NAME, date=timezone.now().date().isoformat())]
    if getattr(user, "custom_instructions", ""):
        parts.append(f"The user's instructions for all conversations:\n{user.custom_instructions}")
    if conversation.system_prompt:
        parts.append(f"Instructions for this conversation:\n{conversation.system_prompt}")
    return "\n\n".join(parts)


def _escape(value: str) -> str:
    return value.replace('"', "'").replace("<", "(").replace(">", ")")


def attachment_block(attachment: Attachment, *, send_image: bool) -> tuple[str | None, tuple[str, str] | None]:
    """(image data URI, document block) for one attachment."""
    name = _escape(attachment.filename)
    if attachment.kind == Attachment.Kind.IMAGE:
        if send_image:
            with attachment.file.open("rb") as fh:
                return to_data_uri(load_image(fh.read()), max_side=CHAT_IMAGE_MAX_SIDE), None
        if attachment.text.strip():
            return None, (f'<image name="{name}" source="ocr">', attachment.text)
        return None, (f'<image name="{name}">', "(This image could not be read as text.)")
    pages = f' pages="{attachment.page_count}"' if attachment.page_count else ""
    if attachment.text.strip():
        return None, (f'<document name="{name}"{pages}>', attachment.text)
    return None, (
        f'<document name="{name}"{pages}>',
        "(No text could be extracted: this looks like a scanned document. "
        "Tell the user to run OCR on it from the attachment menu.)",
    )


def conversation_turns(conversation: Conversation, model: LLMModel) -> list[Turn]:
    messages = list(
        conversation.messages.exclude(status=Message.Status.STREAMING)
        .exclude(role=Message.Role.ASSISTANT, status=Message.Status.ERROR)
        .prefetch_related("attachments")
        .order_by("created_at")
    )
    user_turn_indexes = [i for i, m in enumerate(messages) if m.role == Message.Role.USER]
    image_turns = set(user_turn_indexes[-IMAGES_FROM_LAST_N_TURNS:])

    turns: list[Turn] = []
    for index, message in enumerate(messages):
        if message.role == Message.Role.ASSISTANT:
            text = _THINK.sub("", message.content).strip()
            if text:
                turns.append(Turn(role="assistant", text=text))
            continue
        turn = Turn(role="user", text=message.content)
        for attachment in message.attachments.all():
            turn.has_attachments = True
            image, doc = attachment_block(attachment, send_image=model.vision and index in image_turns)
            if image:
                turn.images.append(image)
            if doc:
                turn.documents.append(doc)
        turns.append(turn)
    return _merge_same_roles(turns)


def _merge_same_roles(turns: list[Turn]) -> list[Turn]:
    merged: list[Turn] = []
    for turn in turns:
        if merged and merged[-1].role == turn.role:
            last = merged[-1]
            last.text = f"{last.text}\n\n{turn.text}".strip()
            last.documents += turn.documents
            last.images += turn.images
            last.has_attachments = last.has_attachments or turn.has_attachments
        else:
            merged.append(turn)
    while merged and merged[0].role != "user":
        merged.pop(0)
    return merged


def fit_to_window(system: str, turns: list[Turn], budget: int) -> list[Turn]:
    """Make the prompt fit `budget` tokens, or raise ContextTooLong."""

    def total() -> int:
        return estimate_tokens(system) + sum(t.tokens() for t in turns)

    # 1. Drop the oldest user+assistant pairs that carry no attachments. The
    #    newest user turn (the question being asked) is never dropped.
    i = 0
    while total() > budget and i < len(turns) - 1:
        pair = turns[i : i + 2]
        if not any(t.has_attachments for t in pair) and len(pair) == 2 and i + 2 < len(turns):
            del turns[i : i + 2]
        else:
            i += 2

    # 2. Trim the largest documents, keeping their beginning, down to at
    #    least MIN_DOC_CHARS each. Every pass shortens one document, so the
    #    loop always ends.
    while total() > budget:
        candidates = [
            (len(text), turn, j)
            for turn in turns
            for j, (_, text) in enumerate(turn.documents)
            if len(text) > MIN_DOC_CHARS + 200
        ]
        if not candidates:
            break
        length, turn, j = max(candidates, key=lambda c: c[0])
        excess_chars = (total() - budget) * 3 + 100
        keep = max(MIN_DOC_CHARS, length - excess_chars)
        tag, text = turn.documents[j]
        turn.documents[j] = (
            tag,
            text[:keep] + f"\n[... {length - keep} more characters not shown: the context window is full ...]",
        )

    if total() > budget:
        raise ContextTooLong()
    return turns


@dataclass
class Prompt:
    messages: list[dict]
    max_tokens: int
    estimated_prompt_tokens: int


def build_prompt(conversation: Conversation, model: LLMModel, user) -> Prompt:
    system = system_prompt(conversation, user)
    turns = conversation_turns(conversation, model)
    window = model.context_window
    answer_budget = min(model.max_output_tokens, max(MIN_ANSWER_TOKENS, window // 2))
    budget = window - answer_budget - TEMPLATE_OVERHEAD
    if budget <= 0:
        raise ContextTooLong()
    turns = fit_to_window(system, turns, budget)
    estimate = estimate_tokens(system) + sum(t.tokens() for t in turns)
    # Give the answer whatever room is left, up to the model's maximum.
    max_tokens = min(model.max_output_tokens, window - estimate - TEMPLATE_OVERHEAD)
    if max_tokens < MIN_ANSWER_TOKENS // 2:
        raise ContextTooLong()
    messages = [{"role": "system", "content": system}] + [{"role": t.role, "content": t.content()} for t in turns]
    return Prompt(messages=messages, max_tokens=max_tokens, estimated_prompt_tokens=estimate)


def images_needing_ocr(message: Message, model: LLMModel) -> list[Attachment]:
    """Images a text-only model can't see and that have no text yet."""
    if model.vision:
        return []
    return [a for a in message.attachments.all() if a.kind == Attachment.Kind.IMAGE and not a.text.strip()]
