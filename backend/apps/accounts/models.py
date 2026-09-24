"""Users and everything that proves who they are.

    User            email is the username; password optional (Google-only users)
    OneTimeCode     6-digit codes sent by email (verify email, 2FA, login)
    TOTPDevice      the secret shared with an authenticator app
    RecoveryCode    single-use backup codes for when the phone is lost

Secrets are never stored in plain text: one-time codes and recovery codes are
stored as SHA-256 hashes (they are random and short-lived, so a fast hash is
fine; passwords, which people choose, get Django's slow PBKDF2 hashing).
"""

from __future__ import annotations

import hashlib
import hmac
import uuid

from django.conf import settings
from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.db import models
from django.utils import timezone


def hash_secret(value: str) -> str:
    """Keyed hash for short random secrets (codes). Keyed with SECRET_KEY so a
    leaked database alone is not enough to brute-force 6-digit codes offline."""
    normalized = value.strip().lower().replace("-", "").replace(" ", "")
    return hmac.new(settings.SECRET_KEY.encode(), normalized.encode(), hashlib.sha256).hexdigest()


class UserManager(BaseUserManager):
    use_in_migrations = True

    def _create_user(self, email: str, password: str | None, **extra):
        if not email:
            raise ValueError("An email address is required")
        email = self.normalize_email(email).lower()
        user = self.model(email=email, **extra)
        if password:
            user.set_password(password)
        else:
            user.set_unusable_password()
        user.save(using=self._db)
        return user

    def create_user(self, email: str, password: str | None = None, **extra):
        extra.setdefault("is_staff", False)
        extra.setdefault("is_superuser", False)
        return self._create_user(email, password, **extra)

    def create_superuser(self, email: str, password: str | None = None, **extra):
        extra.setdefault("is_staff", True)
        extra.setdefault("is_superuser", True)
        extra.setdefault("email_verified", True)
        return self._create_user(email, password, **extra)


class User(AbstractBaseUser, PermissionsMixin):
    class Theme(models.TextChoices):
        SYSTEM = "system"
        LIGHT = "light"
        DARK = "dark"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True)
    name = models.CharField(max_length=150, blank=True)
    avatar_url = models.URLField(blank=True, max_length=500)
    email_verified = models.BooleanField(default=False)
    google_sub = models.CharField(
        max_length=255,
        unique=True,
        null=True,
        blank=True,
        help_text="Google's stable account id, set on first 'Sign in with Google'.",
    )

    # Preferences (shown in Settings > General)
    default_model = models.CharField(max_length=100, blank=True)
    custom_instructions = models.TextField(blank=True, max_length=4000)
    theme = models.CharField(max_length=10, choices=Theme.choices, default=Theme.SYSTEM)

    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    date_joined = models.DateTimeField(default=timezone.now)

    # Two-factor by email is a flag; TOTP has its own table (it has a secret).
    mfa_email_enabled = models.BooleanField(default=False)

    objects = UserManager()

    USERNAME_FIELD = "email"
    EMAIL_FIELD = "email"
    REQUIRED_FIELDS: list[str] = []

    class Meta:
        ordering = ["-date_joined"]

    def __str__(self) -> str:
        return self.email

    # ------------------------------------------------------------- MFA ----

    @property
    def totp_enabled(self) -> bool:
        device = getattr(self, "totp_device", None)
        return bool(device and device.confirmed)

    @property
    def mfa_enabled(self) -> bool:
        return self.totp_enabled or self.mfa_email_enabled

    def mfa_methods(self) -> list[str]:
        methods = []
        if self.totp_enabled:
            methods.append("totp")
        if self.mfa_email_enabled:
            methods.append("email")
        if methods:
            methods.append("recovery")
        return methods


class OneTimeCode(models.Model):
    """A 6-digit code we emailed to someone.

    One row per (user, purpose); asking again replaces the previous code, so
    only the newest email works.
    """

    class Purpose(models.TextChoices):
        VERIFY_EMAIL = "verify_email"
        LOGIN = "login"  # second factor during login
        MFA_SETUP = "mfa_setup"  # enabling / disabling email 2FA, regenerating codes

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="codes")
    purpose = models.CharField(max_length=20, choices=Purpose.choices)
    code_hash = models.CharField(max_length=64)
    attempts = models.PositiveSmallIntegerField(default=0)
    expires_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "purpose"], name="one_code_per_purpose"),
        ]

    def __str__(self) -> str:
        return f"{self.purpose} code for {self.user_id}"

    @property
    def expired(self) -> bool:
        return timezone.now() >= self.expires_at


class TOTPDevice(models.Model):
    """The shared secret behind an authenticator app (Google Authenticator,
    1Password, Authy, ...). Unconfirmed until the user types one valid code,
    which proves the app was set up correctly."""

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="totp_device")
    secret = models.CharField(max_length=64)
    confirmed = models.BooleanField(default=False)
    # The 30-second window of the last accepted code. A code is only accepted
    # once, so someone looking over your shoulder cannot replay it.
    last_used_step = models.BigIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return f"Authenticator app for {self.user_id}"


class RecoveryCode(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="recovery_codes")
    code_hash = models.CharField(max_length=64)
    used_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return f"Recovery code for {self.user_id}"
