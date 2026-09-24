"""Sign-up, email verification, login, logout, password reset, CSRF."""

from __future__ import annotations

import re

import pytest
from django.core import mail

from apps.accounts.models import OneTimeCode, User

from .conftest import PASSWORD, Client, last_code

pytestmark = pytest.mark.django_db


def test_config_and_health(client: Client):
    config = client.get("/api/config/").json()
    assert config["app_name"]
    assert config["google_client_id"] == "test-client-id.apps.googleusercontent.com"
    assert ".pdf" in config["accepted_file_types"]
    assert client.get("/api/health/").json() == {"status": "ok"}


def test_signup_verify_then_login(client: Client):
    res = client.post_json("/api/auth/signup/", {"email": "Grace@Example.com", "password": PASSWORD, "name": "Grace"})
    assert res.status_code == 201
    assert res.json() == {"status": "verification_required", "email": "grace@example.com"}

    # Not verified yet: login is refused and a fresh code is emailed.
    res = client.post_json("/api/auth/login/", {"email": "grace@example.com", "password": PASSWORD})
    assert res.status_code == 403
    assert res.json()["code"] == "email_not_verified"

    res = client.post_json("/api/auth/verify-email/", {"email": "grace@example.com", "code": "000000"})
    assert res.status_code == 400
    assert res.json()["code"] == "invalid_code"

    res = client.post_json("/api/auth/verify-email/", {"email": "grace@example.com", "code": last_code()})
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["user"]["email_verified"] is True

    me = client.get("/api/auth/me/")
    assert me.status_code == 200
    assert me.json()["name"] == "Grace"


def test_signup_rejects_duplicate_and_weak_password(client: Client, user: User):
    res = client.post_json("/api/auth/signup/", {"email": "ADA@example.com", "password": PASSWORD})
    assert res.status_code == 400
    assert res.json()["code"] == "email_taken"
    assert "email" in res.json()["fields"]

    res = client.post_json("/api/auth/signup/", {"email": "new@example.com", "password": "12345678"})
    assert res.status_code == 400
    assert "password" in res.json()["fields"]


def test_login_requires_csrf(user: User):
    raw = Client()  # no csrf() call, no token
    res = raw.post_json("/api/auth/login/", {"email": user.email, "password": PASSWORD})
    assert res.status_code == 403
    assert res.json()["code"] == "csrf_failed"


def test_wrong_password(client: Client, user: User):
    res = client.post_json("/api/auth/login/", {"email": user.email, "password": "nope"})
    assert res.status_code == 400
    assert res.json()["code"] == "invalid_credentials"


def test_me_requires_login(client: Client):
    res = client.get("/api/auth/me/")
    assert res.status_code == 401
    assert res.json()["code"] == "not_authenticated"


def test_logout(auth_client: Client):
    assert auth_client.post_json("/api/auth/logout/").status_code == 204
    assert auth_client.get("/api/auth/me/").status_code == 401


def test_code_attempts_are_limited(client: Client, settings):
    client.post_json("/api/auth/signup/", {"email": "g@example.com", "password": PASSWORD})
    for _ in range(settings.OTP_MAX_ATTEMPTS):
        assert (
            client.post_json("/api/auth/verify-email/", {"email": "g@example.com", "code": "111111"}).status_code == 400
        )
    res = client.post_json("/api/auth/verify-email/", {"email": "g@example.com", "code": "111111"})
    assert res.status_code == 429
    assert res.json()["code"] == "too_many_attempts"
    assert not OneTimeCode.objects.exists()


def test_resend_does_not_reveal_accounts(client: Client):
    res = client.post_json("/api/auth/verify-email/resend/", {"email": "nobody@example.com"})
    assert res.json() == {"status": "sent"}
    assert mail.outbox == []


def test_password_reset(client: Client, user: User):
    assert client.post_json("/api/auth/password/reset/", {"email": user.email}).json() == {"status": "sent"}
    link = re.search(r"reset-password\?uid=([^&\s]+)&token=(\S+)", mail.outbox[-1].body)
    uid, token = link.group(1), link.group(2)

    res = client.post_json(
        "/api/auth/password/reset/confirm/", {"uid": uid, "token": token, "new_password": "another good passphrase"}
    )
    assert res.status_code == 200
    # The link is single-use: the token depends on the password hash.
    res = client.post_json(
        "/api/auth/password/reset/confirm/", {"uid": uid, "token": token, "new_password": "yet another passphrase"}
    )
    assert res.json()["code"] == "invalid_token"
    res = client.post_json("/api/auth/login/", {"email": user.email, "password": "another good passphrase"})
    assert res.json()["status"] == "ok"


def test_change_password_keeps_session(auth_client: Client):
    res = auth_client.post_json(
        "/api/auth/password/change/", {"current_password": "wrong", "new_password": "a brand new passphrase"}
    )
    assert res.status_code == 400
    res = auth_client.post_json(
        "/api/auth/password/change/", {"current_password": PASSWORD, "new_password": "a brand new passphrase"}
    )
    assert res.status_code == 200
    assert auth_client.get("/api/auth/me/").status_code == 200


def test_update_preferences(auth_client: Client, mock_model):
    res = auth_client.patch_json(
        "/api/auth/me/",
        {
            "name": "Ada L.",
            "preferences": {"default_model": "mock-chat", "theme": "dark", "custom_instructions": "Be brief."},
        },
    )
    assert res.status_code == 200
    prefs = res.json()["preferences"]
    assert prefs == {"default_model": "mock-chat", "custom_instructions": "Be brief.", "theme": "dark"}
    res = auth_client.patch_json("/api/auth/me/", {"preferences": {"default_model": "does-not-exist"}})
    assert res.status_code == 400


def test_admin_emails_promote_verified_users(client: Client, settings):
    settings.ADMIN_EMAILS = ["boss@example.com"]
    User.objects.create_user(email="boss@example.com", password=PASSWORD, email_verified=True)
    res = client.post_json("/api/auth/login/", {"email": "boss@example.com", "password": PASSWORD})
    assert res.json()["user"]["is_staff"] is True


def test_delete_account(auth_client: Client, user: User):
    assert auth_client.delete_json("/api/auth/me/", {"password": "wrong"}).status_code == 400
    assert auth_client.delete_json("/api/auth/me/", {"password": PASSWORD}).status_code == 204
    assert not User.objects.filter(pk=user.pk).exists()


def test_signup_disabled(client: Client, settings):
    settings.SIGNUP_ENABLED = False
    res = client.post_json("/api/auth/signup/", {"email": "x@example.com", "password": PASSWORD})
    assert res.status_code == 403
    assert res.json()["code"] == "signup_disabled"


def test_optional_verification_logs_in_immediately(client: Client, settings):
    settings.EMAIL_VERIFICATION = "optional"
    res = client.post_json("/api/auth/signup/", {"email": "o@example.com", "password": PASSWORD})
    assert res.status_code == 201
    assert res.json()["status"] == "ok"
    assert len(mail.outbox) == 1  # the code is still sent
