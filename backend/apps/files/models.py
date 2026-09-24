"""Files people attach to chats.

The bytes live in storage (a local folder in development, a private S3 bucket
on AWS). The row keeps what the app learned from the file: its type, page
count, and the text extracted from it (or OCR'd), which is what a model
without vision actually reads.
"""

from __future__ import annotations

import uuid
from pathlib import PurePath

from django.conf import settings
from django.db import models
from django.db.models.signals import post_delete
from django.dispatch import receiver


def upload_path(instance: Attachment, filename: str) -> str:
    # Random ids only: the original name is kept in the database, never in a
    # storage key or URL (names can contain personal information).
    suffix = PurePath(filename).suffix.lower()[:10]
    return f"u/{instance.user_id}/{instance.id}{suffix}"


class Attachment(models.Model):
    class Kind(models.TextChoices):
        IMAGE = "image"
        DOCUMENT = "document"

    class Status(models.TextChoices):
        READY = "ready"
        ERROR = "error"

    class TextSource(models.TextChoices):
        NONE = "", "None"
        EXTRACTED = "extracted", "Extracted from the file"
        OCR = "ocr", "OCR"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="attachments")
    message = models.ForeignKey(
        "chat.Message", on_delete=models.SET_NULL, null=True, blank=True, related_name="attachments"
    )
    file = models.FileField(upload_to=upload_path, max_length=255)
    filename = models.CharField(max_length=255)
    content_type = models.CharField(max_length=100)
    size = models.PositiveBigIntegerField()
    kind = models.CharField(max_length=10, choices=Kind.choices)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.READY)
    error = models.CharField(max_length=500, blank=True)
    page_count = models.PositiveIntegerField(null=True, blank=True)
    width = models.PositiveIntegerField(null=True, blank=True)
    height = models.PositiveIntegerField(null=True, blank=True)

    text = models.TextField(blank=True)
    text_source = models.CharField(max_length=10, choices=TextSource.choices, blank=True, default="")
    ocr_engine = models.CharField(max_length=120, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self) -> str:
        return self.filename

    def as_api(self) -> dict:
        return {
            "id": str(self.id),
            "filename": self.filename,
            "content_type": self.content_type,
            "size": self.size,
            "kind": self.kind,
            "status": self.status,
            "error": self.error or None,
            "page_count": self.page_count,
            "has_text": bool(self.text.strip()),
            "text_chars": len(self.text),
            "text_preview": self.text[:300],
            "ocr_done": self.text_source == self.TextSource.OCR,
            "url": f"/api/files/{self.id}/content/",
            "created_at": self.created_at.isoformat(),
        }


@receiver(post_delete, sender=Attachment)
def delete_stored_file(sender, instance: Attachment, **kwargs) -> None:
    """Deleting the row (directly, or via a deleted user) removes the bytes too."""
    if instance.file:
        instance.file.delete(save=False)
