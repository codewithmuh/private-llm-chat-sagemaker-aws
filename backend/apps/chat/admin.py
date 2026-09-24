"""Conversations in the admin: metadata only.

Message *content* is deliberately not shown. Admins can see who uses which
model and how much, without reading people's chats. (It is still in the
database; this is a courtesy, not a security boundary.)
"""

from django.contrib import admin

from .models import Conversation, Message


class MessageInline(admin.TabularInline):
    model = Message
    fields = ("role", "model", "status", "prompt_tokens", "completion_tokens", "duration_ms", "created_at")
    readonly_fields = fields
    extra = 0
    can_delete = False
    show_change_link = False


@admin.register(Conversation)
class ConversationAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "model", "message_count", "updated_at")
    list_filter = ("model",)
    search_fields = ("user__email",)
    fields = ("id", "user", "model", "pinned", "created_at", "updated_at")
    readonly_fields = fields
    inlines = [MessageInline]

    @admin.display(description="Messages")
    def message_count(self, obj):
        return obj.messages.count()
