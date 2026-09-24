"""Conversation and chat endpoints (docs/api.md, "Conversations" and "Chat streaming")."""

from __future__ import annotations

from django.db import transaction
from django.http import StreamingHttpResponse
from django.shortcuts import get_object_or_404
from rest_framework import serializers, status
from rest_framework.negotiation import BaseContentNegotiation
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.common.errors import ApiError
from apps.common.throttles import ChatThrottle
from apps.files.models import Attachment
from apps.llm.services import ensure_ready, get_model

from .models import Conversation, Message
from .streaming import stream_answer

MAX_ATTACHMENTS = 10


def _own(request: Request, pk) -> Conversation:
    return get_object_or_404(Conversation, pk=pk, user=request.user)


class ConversationInput(serializers.Serializer):
    title = serializers.CharField(max_length=200, required=False, allow_blank=True)
    model = serializers.CharField(max_length=100, required=False, allow_blank=True, allow_null=True)
    pinned = serializers.BooleanField(required=False)
    system_prompt = serializers.CharField(max_length=8000, required=False, allow_blank=True)


class ConversationListView(APIView):
    def get(self, request: Request) -> Response:
        # Conversations with no messages yet (a first message the model
        # refused, an unused OCR hand-off) are not listed: nothing to show.
        items = Conversation.objects.filter(user=request.user, messages__isnull=False).distinct()
        q = (request.query_params.get("q") or "").strip()
        if q:
            items = items.filter(title__icontains=q)
        return Response({"results": [c.as_api() for c in items[:500]]})

    def post(self, request: Request) -> Response:
        data = _validated(ConversationInput, request)
        model = get_model(data.get("model") or None, request.user)
        conversation = Conversation.objects.create(
            user=request.user,
            title=data.get("title", ""),
            model=model.slug,
            system_prompt=data.get("system_prompt", ""),
            pinned=data.get("pinned", False),
        )
        return Response(conversation.as_api(), status=status.HTTP_201_CREATED)

    def delete(self, request: Request) -> Response:
        # Deleting conversations deletes their messages; attachments are
        # deleted explicitly so their files leave storage too.
        with transaction.atomic():
            for attachment in Attachment.objects.filter(user=request.user, message__isnull=False):
                attachment.delete()
            Conversation.objects.filter(user=request.user).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ConversationDetailView(APIView):
    def get(self, request: Request, pk) -> Response:
        conversation = _own(request, pk)
        messages = conversation.messages.prefetch_related("attachments").order_by("created_at")
        return Response({**conversation.as_api(), "messages": [m.as_api() for m in messages]})

    def patch(self, request: Request, pk) -> Response:
        conversation = _own(request, pk)
        data = _validated(ConversationInput, request)
        if "model" in data and data["model"]:
            conversation.model = get_model(data["model"]).slug
        for field in ("title", "pinned", "system_prompt"):
            if field in data:
                setattr(conversation, field, data[field])
        conversation.save()
        return Response(conversation.as_api())

    def delete(self, request: Request, pk) -> Response:
        conversation = _own(request, pk)
        with transaction.atomic():
            for attachment in Attachment.objects.filter(message__conversation=conversation):
                attachment.delete()
            conversation.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class SendInput(serializers.Serializer):
    content = serializers.CharField(
        max_length=100_000, required=False, allow_blank=True, default="", trim_whitespace=False
    )
    attachment_ids = serializers.ListField(
        child=serializers.UUIDField(), required=False, default=list, max_length=MAX_ATTACHMENTS
    )
    model = serializers.CharField(max_length=100, required=False, allow_blank=True, allow_null=True)


class RegenerateInput(serializers.Serializer):
    model = serializers.CharField(max_length=100, required=False, allow_blank=True, allow_null=True)


class StreamNegotiation(BaseContentNegotiation):
    """Ignore the client's Accept header on the streaming endpoints.

    Browsers ask for `Accept: text/event-stream`. DRF would try to find a
    renderer for that, find none, and answer 406 Not Acceptable. The success
    response is a raw StreamingHttpResponse (no renderer involved), and errors
    before the stream starts should be JSON, so always pick the JSON renderer.
    """

    def select_parser(self, request, parsers):
        return parsers[0]

    def select_renderer(self, request, renderers, format_suffix=None):
        return renderers[0], renderers[0].media_type


def _sse_response(generator) -> StreamingHttpResponse:
    response = StreamingHttpResponse(generator, content_type="text/event-stream; charset=utf-8")
    response["Cache-Control"] = "no-cache, no-transform"
    # nginx and some proxies buffer responses unless told not to.
    response["X-Accel-Buffering"] = "no"
    return response


def _pick_model(conversation: Conversation, requested: str | None, user):
    model = get_model(requested or conversation.model or None, user)
    if conversation.model != model.slug:
        conversation.model = model.slug
    return model


class SendMessageView(APIView):
    throttle_classes = [ChatThrottle]
    content_negotiation_class = StreamNegotiation

    def post(self, request: Request, pk):
        conversation = _own(request, pk)
        data = _validated(SendInput, request)
        content = data["content"].strip()
        ids = list(dict.fromkeys(data["attachment_ids"]))
        attachments = list(Attachment.objects.filter(pk__in=ids, user=request.user, message__isnull=True))
        if len(attachments) != len(ids):
            raise ApiError(
                "Some files were not found or were already sent. Upload them again.",
                code="invalid",
                fields={"attachment_ids": "Unknown or already used file."},
            )
        if not content and not attachments:
            raise ApiError("Type a message or attach a file.", code="invalid", fields={"content": "Empty message."})

        model = _pick_model(conversation, data.get("model"), request.user)
        # Raises 503 model_starting (and wakes the GPU) before anything is
        # saved, so the UI keeps the message in the composer to retry.
        ensure_ready(model)

        first_exchange = not conversation.messages.exists()
        with transaction.atomic():
            user_message = Message.objects.create(conversation=conversation, role=Message.Role.USER, content=content)
            Attachment.objects.filter(pk__in=[a.pk for a in attachments]).update(message=user_message)
            assistant = Message.objects.create(
                conversation=conversation,
                role=Message.Role.ASSISTANT,
                model=model.slug,
                status=Message.Status.STREAMING,
            )
            conversation.save()  # bumps updated_at (and stores a model switch)

        return _sse_response(
            stream_answer(
                conversation=conversation,
                model=model,
                user=request.user,
                user_message=user_message,
                assistant=assistant,
                first_exchange=first_exchange,
            )
        )


class RegenerateView(APIView):
    throttle_classes = [ChatThrottle]
    content_negotiation_class = StreamNegotiation

    def post(self, request: Request, pk):
        conversation = _own(request, pk)
        data = _validated(RegenerateInput, request)
        last_user = conversation.messages.filter(role=Message.Role.USER).order_by("-created_at").first()
        if last_user is None:
            raise ApiError("There is nothing to regenerate yet.", code="invalid")
        model = _pick_model(conversation, data.get("model"), request.user)
        ensure_ready(model)
        with transaction.atomic():
            conversation.messages.filter(role=Message.Role.ASSISTANT, created_at__gt=last_user.created_at).delete()
            assistant = Message.objects.create(
                conversation=conversation,
                role=Message.Role.ASSISTANT,
                model=model.slug,
                status=Message.Status.STREAMING,
            )
            conversation.save()
        return _sse_response(
            stream_answer(
                conversation=conversation,
                model=model,
                user=request.user,
                user_message=None,
                assistant=assistant,
                first_exchange=False,
            )
        )


class StopMessageView(APIView):
    def post(self, request: Request, pk) -> Response:
        message = get_object_or_404(Message, pk=pk, conversation__user=request.user, role=Message.Role.ASSISTANT)
        if message.status == Message.Status.STREAMING:
            Message.objects.filter(pk=message.pk).update(stop_requested=True)
        return Response({"status": "stopped"})


def _validated(serializer_class, request: Request) -> dict:
    serializer = serializer_class(data=request.data)
    serializer.is_valid(raise_exception=True)
    return serializer.validated_data
