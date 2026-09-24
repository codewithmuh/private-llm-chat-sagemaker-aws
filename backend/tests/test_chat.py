"""Conversations and streaming answers, end to end with the mock model."""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone

from apps.accounts.models import User
from apps.chat.models import Conversation, Message
from apps.llm.models import LLMModel

from .conftest import Client, parse_sse

pytestmark = pytest.mark.django_db


def new_conversation(client: Client, **data) -> str:
    res = client.post_json("/api/conversations/", data)
    assert res.status_code == 201, res.content
    return res.json()["id"]


def test_send_message_streams_and_titles(auth_client: Client, mock_model: LLMModel):
    cid = new_conversation(auth_client)
    res = auth_client.post_json(f"/api/conversations/{cid}/messages/", {"content": "Plan a trip to Lahore"})
    assert res.status_code == 200
    assert res["Content-Type"].startswith("text/event-stream")
    events = parse_sse(res)
    names = [e for e, _ in events]
    assert names[0] == "start"
    assert "delta" in names
    assert names[-2:] == ["done", "title"]

    start = events[0][1]
    assert start["user_message"]["content"] == "Plan a trip to Lahore"
    streamed = "".join(d["content"] for e, d in events if e == "delta")
    done = dict(events)["done"]["message"]
    assert done["status"] == "complete"
    assert done["content"] == streamed
    assert done["usage"]["completion_tokens"] > 0
    assert dict(events)["title"]["title"] == "Plan a trip to lahore"

    detail = auth_client.get(f"/api/conversations/{cid}/").json()
    assert detail["title"] == "Plan a trip to lahore"
    assert [m["role"] for m in detail["messages"]] == ["user", "assistant"]


def test_attachments_reach_the_model(auth_client: Client, mock_model: LLMModel):
    upload = SimpleUploadedFile("notes.txt", b"The launch is on Friday.", content_type="text/plain")
    file_id = auth_client.post("/api/files/", {"file": upload}, format="multipart").json()["id"]
    cid = new_conversation(auth_client)
    events = parse_sse(
        auth_client.post_json(f"/api/conversations/{cid}/messages/", {"content": "When?", "attachment_ids": [file_id]})
    )
    answer = dict(events)["done"]["message"]["content"]
    assert "`notes.txt`" in answer  # the mock lists the documents it received
    assert dict(events)["start"]["user_message"]["attachments"][0]["id"] == file_id

    # A file can only be sent once.
    res = auth_client.post_json(
        f"/api/conversations/{cid}/messages/", {"content": "again", "attachment_ids": [file_id]}
    )
    assert res.status_code == 400


def test_empty_message_is_rejected(auth_client: Client, mock_model):
    cid = new_conversation(auth_client)
    res = auth_client.post_json(f"/api/conversations/{cid}/messages/", {"content": "  "})
    assert res.status_code == 400


def test_regenerate_replaces_the_last_answer(auth_client: Client, mock_model):
    cid = new_conversation(auth_client)
    parse_sse(auth_client.post_json(f"/api/conversations/{cid}/messages/", {"content": "Hello"}))
    first = Message.objects.get(conversation_id=cid, role="assistant")
    events = parse_sse(auth_client.post_json(f"/api/conversations/{cid}/regenerate/", {}))
    assert dict(events)["start"]["user_message"] is None
    assert not Message.objects.filter(pk=first.pk).exists()
    assert Message.objects.filter(conversation_id=cid, role="assistant").count() == 1


def test_stop_flag(auth_client: Client, mock_model):
    cid = new_conversation(auth_client)
    conversation = Conversation.objects.get(pk=cid)
    msg = Message.objects.create(conversation=conversation, role="assistant", status="streaming")
    assert auth_client.post_json(f"/api/messages/{msg.pk}/stop/").json() == {"status": "stopped"}
    msg.refresh_from_db()
    assert msg.stop_requested is True


def test_conversations_are_private(auth_client: Client, mock_model):
    other = User.objects.create_user(email="eve@example.com", password="x" * 12)
    theirs = Conversation.objects.create(user=other, title="secret")
    assert auth_client.get(f"/api/conversations/{theirs.pk}/").status_code == 404
    assert auth_client.post_json(f"/api/conversations/{theirs.pk}/messages/", {"content": "hi"}).status_code == 404
    assert all(c["id"] != str(theirs.pk) for c in auth_client.get("/api/conversations/").json()["results"])


def test_list_rename_pin_search_delete(auth_client: Client, mock_model):
    a = new_conversation(auth_client, title="Budget 2026")
    b = new_conversation(auth_client, title="Holiday ideas")
    auth_client.patch_json(f"/api/conversations/{a}/", {"pinned": True, "title": "Budget"})
    results = auth_client.get("/api/conversations/").json()["results"]
    assert [c["id"] for c in results] == [a, b]  # pinned first
    assert [c["id"] for c in auth_client.get("/api/conversations/?q=holi").json()["results"]] == [b]
    assert auth_client.delete(f"/api/conversations/{b}/").status_code == 204
    assert auth_client.delete("/api/conversations/").status_code == 204
    assert auth_client.get("/api/conversations/").json()["results"] == []


def test_sleeping_sagemaker_model_is_woken(auth_client: Client):
    model = LLMModel.objects.create(
        slug="qwen",
        name="Qwen",
        provider="sagemaker",
        endpoint_name="llmchat-dev-qwen",
        endpoint_config_name="cfg-1",
        scaling="on_demand",
        endpoint_status="NotFound",
        status_checked_at=timezone.now(),
        is_default=True,
    )
    cid = new_conversation(auth_client)
    res = auth_client.post_json(f"/api/conversations/{cid}/messages/", {"content": "hi"})
    assert res.status_code == 503
    assert res.json()["code"] == "model_starting"
    model.refresh_from_db()
    assert model.wake_requested_at is not None
    assert not Message.objects.filter(conversation_id=cid).exists()  # nothing saved; the UI keeps the text
    status = auth_client.get("/api/models/").json()[0]
    assert status["status"] == "starting"


def test_switched_off_model(auth_client: Client):
    LLMModel.objects.create(
        slug="off",
        name="Off",
        provider="sagemaker",
        endpoint_name="x",
        scaling="off",
        endpoint_status="NotFound",
        status_checked_at=timezone.now() - timedelta(seconds=5),
        is_default=True,
    )
    cid = new_conversation(auth_client)
    res = auth_client.post_json(f"/api/conversations/{cid}/messages/", {"content": "hi"})
    assert res.json()["code"] == "model_unavailable"


def test_context_too_long_becomes_an_error_event(auth_client: Client):
    LLMModel.objects.create(
        slug="tiny", name="Tiny", provider="mock", context_window=600, max_output_tokens=200, is_default=True
    )
    cid = new_conversation(auth_client)
    events = parse_sse(auth_client.post_json(f"/api/conversations/{cid}/messages/", {"content": "word " * 2000}))
    event, data = events[-1]
    assert event == "error"
    assert data["code"] == "context_too_long"
    assert data["message"]["status"] == "error"


def test_model_switch_is_remembered(auth_client: Client, mock_model):
    LLMModel.objects.create(slug="other", name="Other", provider="mock")
    cid = new_conversation(auth_client)
    parse_sse(auth_client.post_json(f"/api/conversations/{cid}/messages/", {"content": "hi", "model": "other"}))
    assert Conversation.objects.get(pk=cid).model == "other"
    assert Message.objects.get(conversation_id=cid, role="assistant").model == "other"
