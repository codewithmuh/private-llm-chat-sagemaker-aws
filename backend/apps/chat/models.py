"""Conversations and their messages."""

from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models


class Conversation(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="conversations")
    title = models.CharField(max_length=200, blank=True)
    # The model's slug, not a foreign key: a conversation outlives the model
    # it started with (models get renamed, disabled, replaced).
    model = models.CharField(max_length=100, blank=True)
    pinned = models.BooleanField(default=False)
    system_prompt = models.TextField(blank=True, max_length=8000)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-pinned", "-updated_at"]
        indexes = [models.Index(fields=["user", "-updated_at"])]

    def __str__(self) -> str:
        return self.title or f"Conversation {self.id}"

    def as_api(self) -> dict:
        return {
            "id": str(self.id),
            "title": self.title,
            "model": self.model or None,
            "pinned": self.pinned,
            "system_prompt": self.system_prompt,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }


class Message(models.Model):
    class Role(models.TextChoices):
        USER = "user"
        ASSISTANT = "assistant"

    class Status(models.TextChoices):
        COMPLETE = "complete"
        STREAMING = "streaming"
        STOPPED = "stopped"
        ERROR = "error"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name="messages")
    role = models.CharField(max_length=10, choices=Role.choices)
    content = models.TextField(blank=True)
    model = models.CharField(max_length=100, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.COMPLETE)
    error = models.CharField(max_length=1000, blank=True)
    stop_requested = models.BooleanField(default=False)
    prompt_tokens = models.PositiveIntegerField(null=True, blank=True)
    completion_tokens = models.PositiveIntegerField(null=True, blank=True)
    duration_ms = models.PositiveIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self) -> str:
        return f"{self.role} message {self.id}"

    def as_api(self) -> dict:
        usage = None
        if self.prompt_tokens is not None or self.completion_tokens is not None:
            usage = {"prompt_tokens": self.prompt_tokens, "completion_tokens": self.completion_tokens}
        return {
            "id": str(self.id),
            "role": self.role,
            "content": self.content,
            "model": self.model or None,
            "status": self.status,
            "error": self.error or None,
            "attachments": [a.as_api() for a in self.attachments.all()],
            "usage": usage,
            "duration_ms": self.duration_ms,
            "created_at": self.created_at.isoformat(),
        }
