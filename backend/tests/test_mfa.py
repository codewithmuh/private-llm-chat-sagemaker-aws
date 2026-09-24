"""Two-factor authentication: authenticator app, email codes, recovery codes."""

from __future__ import annotations

import time
from unittest import mock

import pyotp
import pytest

from apps.accounts.models import RecoveryCode, User

from .conftest import PASSWORD, Client, last_code

pytestmark = pytest.mark.django_db


def enable_totp(client: Client) -> tuple[str, list[str]]:
    setup = client.post_json("/api/auth/mfa/totp/setup/").json()
    assert setup["otpauth_url"].startswith("otpauth://totp/")
    assert setup["qr_svg"].startswith("<svg")
    res = client.post_json("/api/auth/mfa/totp/confirm/", {"code": pyotp.TOTP(setup["secret"]).now()})
    assert res.status_code == 200, res.content
    return setup["secret"], res.json()["recovery_codes"]


def login_until_mfa(client: Client, user: User) -> dict:
    client.post_json("/api/auth/logout/")
    client.csrf()
    res = client.post_json("/api/auth/login/", {"email": user.email, "password": PASSWORD})
    assert res.status_code == 200
    return res.json()


def test_totp_login(auth_client: Client, user: User):
    secret, codes = enable_totp(auth_client)
    assert len(codes) == 10
    assert auth_client.get("/api/auth/mfa/").json() == {
        "enabled": True,
        "totp": True,
        "email": False,
        "recovery_codes_remaining": 10,
    }

    body = login_until_mfa(auth_client, user)
    assert body == {"status": "mfa_required", "methods": ["totp", "recovery"]}
    # Password alone is not a session.
    assert auth_client.get("/api/auth/me/").status_code == 401

    res = auth_client.post_json("/api/auth/login/mfa/", {"method": "totp", "code": "000000"})
    assert res.status_code == 400

    # The code for the NEXT 30 s window: never used during setup.
    code = pyotp.TOTP(secret).at(time.time() + 30)
    res = auth_client.post_json("/api/auth/login/mfa/", {"method": "totp", "code": code})
    assert res.status_code == 200, res.content
    assert res.json()["user"]["mfa"]["totp"] is True


def test_totp_code_cannot_be_replayed(auth_client: Client, user: User):
    secret, _ = enable_totp(auth_client)
    code = pyotp.TOTP(secret).at(time.time() + 30)
    login_until_mfa(auth_client, user)
    assert auth_client.post_json("/api/auth/login/mfa/", {"method": "totp", "code": code}).status_code == 200
    login_until_mfa(auth_client, user)
    res = auth_client.post_json("/api/auth/login/mfa/", {"method": "totp", "code": code})
    assert res.status_code == 400


def test_recovery_code_works_once(auth_client: Client, user: User):
    _, codes = enable_totp(auth_client)
    login_until_mfa(auth_client, user)
    assert (
        auth_client.post_json("/api/auth/login/mfa/", {"method": "recovery", "code": codes[0].upper()}).status_code
        == 200
    )
    login_until_mfa(auth_client, user)
    assert auth_client.post_json("/api/auth/login/mfa/", {"method": "recovery", "code": codes[0]}).status_code == 400
    assert auth_client.post_json("/api/auth/login/mfa/", {"method": "recovery", "code": codes[1]}).status_code == 200


def test_email_mfa(auth_client: Client, user: User):
    assert auth_client.post_json("/api/auth/mfa/email/send/").status_code == 200
    res = auth_client.post_json("/api/auth/mfa/email/confirm/", {"code": last_code()})
    assert res.status_code == 200
    assert len(res.json()["recovery_codes"]) == 10

    body = login_until_mfa(auth_client, user)
    assert body["methods"] == ["email", "recovery"]
    assert auth_client.post_json("/api/auth/login/mfa/email/").json() == {"status": "sent"}
    res = auth_client.post_json("/api/auth/login/mfa/", {"method": "email", "code": last_code()})
    assert res.status_code == 200


def test_second_method_gets_no_new_recovery_codes(auth_client: Client):
    enable_totp(auth_client)
    auth_client.post_json("/api/auth/mfa/email/send/")
    res = auth_client.post_json("/api/auth/mfa/email/confirm/", {"code": last_code()})
    assert res.json()["recovery_codes"] == []


def test_disabling_last_method_removes_recovery_codes(auth_client: Client, user: User):
    secret, _ = enable_totp(auth_client)
    res = auth_client.post_json("/api/auth/mfa/totp/disable/", {"code": pyotp.TOTP(secret).at(time.time() + 30)})
    assert res.status_code == 200
    assert not RecoveryCode.objects.filter(user=user).exists()
    assert auth_client.get("/api/auth/me/").json()["mfa"]["enabled"] is False


def test_regenerate_recovery_codes(auth_client: Client):
    secret, old = enable_totp(auth_client)
    res = auth_client.post_json("/api/auth/mfa/recovery-codes/", {"code": pyotp.TOTP(secret).at(time.time() + 30)})
    assert res.status_code == 200
    new = res.json()["recovery_codes"]
    assert len(new) == 10 and set(new).isdisjoint(old)


def test_pending_login_expires(auth_client: Client, user: User):
    secret, _ = enable_totp(auth_client)
    login_until_mfa(auth_client, user)
    with mock.patch("apps.accounts.services.time.time", return_value=time.time() + 3600):
        res = auth_client.post_json("/api/auth/login/mfa/", {"method": "totp", "code": pyotp.TOTP(secret).now()})
    assert res.status_code == 401
    assert res.json()["code"] == "no_pending_login"
