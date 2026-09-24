"""Sign in with Google (the ID token is verified by google-auth; we fake it)."""

from __future__ import annotations

from unittest import mock

import pytest

from apps.accounts.models import User

from .conftest import Client

pytestmark = pytest.mark.django_db

VERIFY = "google.oauth2.id_token.verify_oauth2_token"


def claims(**overrides):
    base = {
        "iss": "https://accounts.google.com",
        "sub": "google-123",
        "email": "lin@example.com",
        "email_verified": True,
        "name": "Lin",
        "picture": "https://example.com/a.png",
    }
    return {**base, **overrides}


def test_first_google_login_creates_account(client: Client):
    with mock.patch(VERIFY, return_value=claims()) as verify:
        res = client.post_json("/api/auth/google/", {"credential": "jwt"})
    assert res.status_code == 200
    assert verify.call_args.args[2] == "test-client-id.apps.googleusercontent.com"  # audience check
    user = res.json()["user"]
    assert user["email"] == "lin@example.com"
    assert user["google_linked"] is True
    assert user["has_password"] is False


def test_google_links_existing_account_with_same_verified_email(client: Client):
    existing = User.objects.create_user(email="lin@example.com", password="x" * 12)
    with mock.patch(VERIFY, return_value=claims()):
        client.post_json("/api/auth/google/", {"credential": "jwt"})
    existing.refresh_from_db()
    assert existing.google_sub == "google-123"
    assert existing.email_verified is True
    assert User.objects.count() == 1


def test_unverified_google_email_is_refused(client: Client):
    User.objects.create_user(email="lin@example.com", password="x" * 12)
    with mock.patch(VERIFY, return_value=claims(email_verified=False)):
        res = client.post_json("/api/auth/google/", {"credential": "jwt"})
    assert res.status_code == 400
    assert User.objects.get(email="lin@example.com").google_sub is None


def test_invalid_token(client: Client):
    with mock.patch(VERIFY, side_effect=ValueError("Token has wrong audience")):
        res = client.post_json("/api/auth/google/", {"credential": "jwt"})
    assert res.json()["code"] == "invalid_google_token"


def test_google_login_still_asks_for_2fa(client: Client):
    User.objects.create_user(
        email="lin@example.com", password="x" * 12, google_sub="google-123", mfa_email_enabled=True
    )
    with mock.patch(VERIFY, return_value=claims()):
        res = client.post_json("/api/auth/google/", {"credential": "jwt"})
    assert res.json() == {"status": "mfa_required", "methods": ["email", "recovery"]}
