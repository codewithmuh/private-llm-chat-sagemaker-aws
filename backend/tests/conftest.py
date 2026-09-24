"""Shared test fixtures.

`client` is a real API client that ENFORCES CSRF, like a browser session:
call `client.csrf()` (done for you by the fixture) and every unsafe request
carries the X-CSRFToken header automatically.
"""

from __future__ import annotations

import json
import re

import pytest
from django.core import mail
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.llm.models import LLMModel

PASSWORD = "correct horse battery staple"


class Client(APIClient):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, enforce_csrf_checks=True, **kwargs)

    def csrf(self) -> str:
        self.get("/api/auth/csrf/")
        return self.cookies["csrftoken"].value

    def generic(self, method, path, data="", content_type="application/octet-stream", secure=False, **extra):
        # Mimic the frontend: read the (possibly rotated) cookie on every call.
        if method.upper() not in ("GET", "HEAD", "OPTIONS") and "csrftoken" in self.cookies:
            extra.setdefault("HTTP_X_CSRFTOKEN", self.cookies["csrftoken"].value)
        return super().generic(method, path, data, content_type, secure=secure, **extra)

    def post_json(self, path, data=None, **extra):
        return self.post(path, data=json.dumps(data or {}), content_type="application/json", **extra)

    def patch_json(self, path, data=None, **extra):
        return self.patch(path, data=json.dumps(data or {}), content_type="application/json", **extra)

    def delete_json(self, path, data=None, **extra):
        return self.delete(path, data=json.dumps(data or {}), content_type="application/json", **extra)


@pytest.fixture
def client(db) -> Client:
    c = Client()
    c.csrf()
    return c


@pytest.fixture
def user(db) -> User:
    return User.objects.create_user(email="ada@example.com", password=PASSWORD, name="Ada", email_verified=True)


@pytest.fixture
def auth_client(client: Client, user: User) -> Client:
    res = client.post_json("/api/auth/login/", {"email": user.email, "password": PASSWORD})
    assert res.status_code == 200, res.content
    assert res.json()["status"] == "ok"
    return client


@pytest.fixture
def mock_model(db) -> LLMModel:
    return LLMModel.objects.create(
        slug="mock-chat",
        name="Mock",
        provider=LLMModel.Provider.MOCK,
        vision=True,
        ocr=True,
        context_window=32768,
        max_output_tokens=1024,
        is_default=True,
    )


def last_code() -> str:
    """The 6-digit code from the most recent email."""
    assert mail.outbox, "no email was sent"
    match = re.search(r"\b(\d{6})\b", mail.outbox[-1].body)
    assert match, mail.outbox[-1].body
    return match.group(1)


def parse_sse(response) -> list[tuple[str, dict]]:
    """Read a streaming response into [(event, data), ...]."""
    raw = b"".join(response.streaming_content).decode()
    events = []
    for block in raw.split("\n\n"):
        name = re.search(r"^event: (.*)$", block, re.M)
        data = re.search(r"^data: (.*)$", block, re.M)
        if name and data:
            events.append((name.group(1), json.loads(data.group(1))))
    return events
