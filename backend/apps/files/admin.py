from django.contrib import admin

from .models import Attachment


@admin.register(Attachment)
class AttachmentAdmin(admin.ModelAdmin):
    list_display = ("filename", "user", "kind", "content_type", "size", "text_source", "created_at")
    list_filter = ("kind", "text_source", "status")
    search_fields = ("filename", "user__email")
    readonly_fields = (
        "id",
        "user",
        "message",
        "file",
        "size",
        "content_type",
        "page_count",
        "width",
        "height",
        "created_at",
    )
