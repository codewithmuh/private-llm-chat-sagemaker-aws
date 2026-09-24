"""Account logic, kept out of the views so it can be read (and tested) on its own.

one-time email codes    issue_code / check_code
authenticator apps      start_totp_setup / check_totp
recovery codes          new_recovery_codes / use_recovery_code
Google                  verify_google_credential / user_from_google
logging in              begin_login -> (maybe) pending MFA -> finish_login
"""

from __future__ import annotations

import hmac
import logging
import secrets
import time
from dataclasses import dataclass
from datetime import timedelta

import pyotp
import segno
from django.conf import settings
from django.contrib.auth import login
from django.db import transaction
from django.utils import timezone

from apps.common.email import send_email
from apps.common.errors import ApiError

from .models import OneTimeCode, RecoveryCode, TOTPDevice, User, hash_secret

log = logging.getLogger(__name__)

TOTP_STEP_SECONDS = 30
RECOVERY_CODE_COUNT = 10
# Unambiguous alphabet for recovery codes: no 0/o, 1/l/i.
_RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"


# ------------------------------------------------------- email one-time codes --


def issue_code(user: User, purpose: str) -> str:
    """Create (or replace) the user's code for `purpose` and return it.

    Only the hash is stored. The caller emails the plain code.
    """
    code = f"{secrets.randbelow(1_000_000):06d}"
    OneTimeCode.objects.update_or_create(
        user=user,
        purpose=purpose,
        defaults={
            "code_hash": hash_secret(code),
            "attempts": 0,
            "expires_at": timezone.now() + timedelta(seconds=settings.OTP_CODE_TTL_SECONDS),
        },
    )
    return code


def send_code(user: User, purpose: str) -> None:
    code = issue_code(user, purpose)
    template = {
        OneTimeCode.Purpose.VERIFY_EMAIL: "verify_email",
        OneTimeCode.Purpose.LOGIN: "login_code",
        OneTimeCode.Purpose.MFA_SETUP: "mfa_code",
    }[purpose]
    send_email(
        template,
        user.email,
        {"code": code, "name": user.name, "minutes": settings.OTP_CODE_TTL_SECONDS // 60},
    )


def check_code(user: User, purpose: str, code: str, *, consume: bool = True) -> None:
    """Raise ApiError unless `code` is the user's current code for `purpose`.

    Each code allows OTP_MAX_ATTEMPTS guesses. A 6-digit code has a million
    possibilities; five guesses give an attacker a 1-in-200,000 chance.
    """
    # The error is raised AFTER the transaction commits. Raising inside it
    # would roll back the attempts counter, and the limit would never trigger.
    error: ApiError | None = None
    with transaction.atomic():
        row = OneTimeCode.objects.select_for_update().filter(user=user, purpose=purpose).first()
        if row is None:
            error = ApiError("That code is not valid. Request a new one.", code="invalid_code")
        elif row.expired:
            row.delete()
            error = ApiError("That code has expired. Request a new one.", code="expired_code")
        elif row.attempts >= settings.OTP_MAX_ATTEMPTS:
            row.delete()
            error = ApiError("Too many wrong attempts. Request a new code.", code="too_many_attempts", status_code=429)
        elif not hmac.compare_digest(row.code_hash, hash_secret(code or "")):
            row.attempts += 1
            row.save(update_fields=["attempts"])
            error = ApiError("That code is not correct.", code="invalid_code")
        elif consume:
            row.delete()
    if error is not None:
        raise error


# ----------------------------------------------------------- authenticator app --


@dataclass
class TotpSetup:
    secret: str
    otpauth_url: str
    qr_svg: str


def start_totp_setup(user: User) -> TotpSetup:
    """Generate a fresh secret. Nothing is enabled until `confirm_totp`."""
    if user.totp_enabled:
        raise ApiError("An authenticator app is already set up.", code="already_enabled")
    secret = pyotp.random_base32()
    TOTPDevice.objects.update_or_create(
        user=user, defaults={"secret": secret, "confirmed": False, "last_used_step": None}
    )
    url = pyotp.TOTP(secret).provisioning_uri(name=user.email, issuer_name=settings.APP_NAME)
    svg = segno.make(url, error="m").svg_inline(scale=5, border=2, dark="#111", light="#fff")
    return TotpSetup(secret=secret, otpauth_url=url, qr_svg=svg)


def check_totp(device: TOTPDevice, code: str) -> bool:
    """Accept the code for now, 30 s ago or 30 s ahead (clock drift), once.

    Tracking the last accepted time step stops a code from being replayed
    within its validity window.
    """
    code = (code or "").strip().replace(" ", "")
    if not (code.isdigit() and len(code) == 6):
        return False
    totp = pyotp.TOTP(device.secret)
    now_step = int(time.time()) // TOTP_STEP_SECONDS
    for step in (now_step - 1, now_step, now_step + 1):
        if device.last_used_step is not None and step <= device.last_used_step:
            continue
        if hmac.compare_digest(totp.generate_otp(step), code):
            device.last_used_step = step
            device.save(update_fields=["last_used_step"])
            return True
    return False


def confirm_totp(user: User, code: str) -> list[str]:
    device = TOTPDevice.objects.filter(user=user).first()
    if device is None or device.confirmed:
        raise ApiError("Start the authenticator setup first.", code="no_setup")
    if not check_totp(device, code):
        raise ApiError("That code is not correct. Check the time on your phone.", code="invalid_code")
    had_mfa = user.mfa_enabled
    device.confirmed = True
    device.save(update_fields=["confirmed"])
    return [] if had_mfa else new_recovery_codes(user)


# -------------------------------------------------------------- recovery codes --


def new_recovery_codes(user: User) -> list[str]:
    """Replace the user's recovery codes; return the plain codes (shown once)."""
    codes = []
    for _ in range(RECOVERY_CODE_COUNT):
        raw = "".join(secrets.choice(_RECOVERY_ALPHABET) for _ in range(8))
        codes.append(f"{raw[:4]}-{raw[4:]}")
    with transaction.atomic():
        RecoveryCode.objects.filter(user=user).delete()
        RecoveryCode.objects.bulk_create(RecoveryCode(user=user, code_hash=hash_secret(c)) for c in codes)
    return codes


def use_recovery_code(user: User, code: str) -> bool:
    row = RecoveryCode.objects.filter(user=user, code_hash=hash_secret(code or ""), used_at__isnull=True).first()
    if row is None:
        return False
    row.used_at = timezone.now()
    row.save(update_fields=["used_at"])
    return True


def recovery_codes_remaining(user: User) -> int:
    return RecoveryCode.objects.filter(user=user, used_at__isnull=True).count()


def after_mfa_method_removed(user: User) -> None:
    """With no second factor left, recovery codes have nothing to recover."""
    if not user.mfa_enabled:
        RecoveryCode.objects.filter(user=user).delete()


def check_second_factor(user: User, method: str, code: str) -> None:
    """Verify one second-factor code of the given method, or raise."""
    if method == "totp" and user.totp_enabled:
        if check_totp(user.totp_device, code):
            return
        raise ApiError("That code is not correct.", code="invalid_code")
    if method == "email" and user.mfa_email_enabled:
        check_code(user, OneTimeCode.Purpose.LOGIN, code)
        return
    if method == "recovery" and user.mfa_enabled:
        if use_recovery_code(user, code):
            return
        raise ApiError("That recovery code is not valid or was already used.", code="invalid_code")
    raise ApiError("That sign-in method is not enabled for this account.", code="invalid_method")


# ------------------------------------------------------------------- Google ----


@dataclass
class GoogleIdentity:
    sub: str
    email: str
    email_verified: bool
    name: str
    picture: str


def verify_google_credential(credential: str) -> GoogleIdentity:
    """Check a Google Identity Services ID token and return who it belongs to.

    The browser gets this signed JWT from Google's "Sign in with Google" button
    and posts it here. `verify_oauth2_token` checks the signature against
    Google's public keys, the expiry, and that the token was issued FOR OUR
    client id (the `aud` claim). Skipping the audience check would let any other
    site's Google tokens log in here.
    """
    if not settings.GOOGLE_CLIENT_ID:
        raise ApiError("Google sign-in is not configured.", code="google_disabled", status_code=404)
    # Imported here so the module loads without the extra dependency in tests.
    from google.auth.transport import requests as google_requests
    from google.oauth2 import id_token

    try:
        claims = id_token.verify_oauth2_token(credential, google_requests.Request(), settings.GOOGLE_CLIENT_ID)
    except ValueError:
        raise ApiError("Google sign-in failed. Please try again.", code="invalid_google_token") from None
    if claims.get("iss") not in ("accounts.google.com", "https://accounts.google.com"):
        raise ApiError("Google sign-in failed. Please try again.", code="invalid_google_token")
    return GoogleIdentity(
        sub=str(claims["sub"]),
        email=str(claims.get("email", "")).lower(),
        email_verified=bool(claims.get("email_verified")),
        name=str(claims.get("name", "")),
        picture=str(claims.get("picture", "")),
    )


def user_from_google(identity: GoogleIdentity) -> User:
    """Find or create the account for a Google identity.

    1. Already linked (same Google `sub`)          -> that user.
    2. Same email, and Google says it's verified   -> link and use it.
    3. Otherwise                                   -> new account (if sign-up is open).

    Rule 2 only ever runs with a Google-verified email: linking on an
    unverified email would let someone take over an account by creating a
    Google account with your address.
    """
    user = User.objects.filter(google_sub=identity.sub).first()
    if user:
        return user
    if not identity.email or not identity.email_verified:
        raise ApiError("Your Google account's email address is not verified.", code="email_not_verified")
    user = User.objects.filter(email__iexact=identity.email).first()
    if user:
        user.google_sub = identity.sub
        user.email_verified = True
        if not user.avatar_url and identity.picture:
            user.avatar_url = identity.picture[:500]
        user.save(update_fields=["google_sub", "email_verified", "avatar_url"])
        return user
    if not settings.SIGNUP_ENABLED:
        raise ApiError(
            "Sign-up is closed. Ask an administrator for an account.", code="signup_disabled", status_code=403
        )
    return User.objects.create_user(
        email=identity.email,
        password=None,
        name=identity.name[:150],
        avatar_url=identity.picture[:500],
        google_sub=identity.sub,
        email_verified=True,
    )


# ----------------------------------------------------------------- logging in --

PENDING_KEY = "mfa_pending"


def begin_login(request, user: User) -> dict:
    """First factor passed. Either log in now, or park the login until MFA."""
    if not user.is_active:
        raise ApiError("This account is disabled.", code="account_disabled", status_code=403)
    if user.mfa_enabled:
        request.session[PENDING_KEY] = {
            "user_id": str(user.pk),
            "expires": time.time() + settings.MFA_PENDING_TTL_SECONDS,
        }
        return {"status": "mfa_required", "methods": user.mfa_methods()}
    finish_login(request, user)
    return {"status": "ok"}


def pending_user(request) -> User:
    pending = request.session.get(PENDING_KEY)
    if not pending or pending.get("expires", 0) < time.time():
        request.session.pop(PENDING_KEY, None)
        raise ApiError(
            "Your sign-in timed out. Please enter your password again.",
            code="no_pending_login",
            status_code=401,
        )
    user = User.objects.filter(pk=pending["user_id"], is_active=True).first()
    if user is None:
        raise ApiError("Please sign in again.", code="no_pending_login", status_code=401)
    return user


def finish_login(request, user: User) -> None:
    request.session.pop(PENDING_KEY, None)
    promote_if_admin(user)
    # login() rotates the session key (no session fixation) and the CSRF token.
    login(request, user, backend="django.contrib.auth.backends.ModelBackend")
    log.info("login", extra={"user_id": str(user.pk)})


def promote_if_admin(user: User) -> None:
    """ADMIN_EMAILS: verified addresses listed there become superusers."""
    if (
        user.email_verified
        and user.email.lower() in settings.ADMIN_EMAILS
        and not (user.is_staff and user.is_superuser)
    ):
        user.is_staff = True
        user.is_superuser = True
        user.save(update_fields=["is_staff", "is_superuser"])
        log.info("promoted to admin via ADMIN_EMAILS", extra={"user_id": str(user.pk)})
