"""Input validation and the User JSON shape (docs/api.md, "The User object")."""

from __future__ import annotations

from django.contrib.auth import password_validation
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from .models import User
from .services import recovery_codes_remaining


def user_payload(user: User) -> dict:
    return {
        "id": str(user.pk),
        "email": user.email,
        "name": user.name,
        "avatar_url": user.avatar_url or None,
        "email_verified": user.email_verified,
        "has_password": user.has_usable_password(),
        "google_linked": bool(user.google_sub),
        "is_staff": user.is_staff,
        "mfa": {
            "enabled": user.mfa_enabled,
            "totp": user.totp_enabled,
            "email": user.mfa_email_enabled,
            "recovery_codes_remaining": recovery_codes_remaining(user) if user.mfa_enabled else 0,
        },
        "preferences": {
            "default_model": user.default_model or None,
            "custom_instructions": user.custom_instructions,
            "theme": user.theme,
        },
        "date_joined": user.date_joined.isoformat(),
    }


def validate_new_password(password: str, user: User | None = None) -> str:
    try:
        password_validation.validate_password(password, user=user)
    except DjangoValidationError as exc:
        raise serializers.ValidationError(list(exc.messages)) from exc
    return password


class SignupSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=254)
    password = serializers.CharField(max_length=128, trim_whitespace=False)
    name = serializers.CharField(max_length=150, required=False, allow_blank=True, default="")

    def validate_email(self, value: str) -> str:
        return value.strip().lower()

    def validate(self, attrs):
        # Validate the password against the would-be user, so "ada@example.com"
        # with password "ada@example.com" is rejected as too similar.
        probe = User(email=attrs["email"], name=attrs.get("name", ""))
        try:
            validate_new_password(attrs["password"], probe)
        except serializers.ValidationError as exc:
            raise serializers.ValidationError({"password": exc.detail}) from exc
        return attrs


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(trim_whitespace=False)


class EmailSerializer(serializers.Serializer):
    email = serializers.EmailField()


class EmailCodeSerializer(serializers.Serializer):
    email = serializers.EmailField()
    code = serializers.CharField(max_length=12)


class CodeSerializer(serializers.Serializer):
    code = serializers.CharField(max_length=32)


class MfaLoginSerializer(serializers.Serializer):
    method = serializers.ChoiceField(choices=["totp", "email", "recovery"])
    code = serializers.CharField(max_length=32)


class GoogleSerializer(serializers.Serializer):
    credential = serializers.CharField(max_length=8192)


class PreferencesSerializer(serializers.Serializer):
    default_model = serializers.CharField(max_length=100, required=False, allow_blank=True, allow_null=True)
    custom_instructions = serializers.CharField(max_length=4000, required=False, allow_blank=True)
    theme = serializers.ChoiceField(choices=User.Theme.choices, required=False)


class MeUpdateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    preferences = PreferencesSerializer(required=False)


class PasswordChangeSerializer(serializers.Serializer):
    current_password = serializers.CharField(required=False, allow_blank=True, trim_whitespace=False)
    new_password = serializers.CharField(max_length=128, trim_whitespace=False)


class PasswordResetConfirmSerializer(serializers.Serializer):
    uid = serializers.CharField(max_length=64)
    token = serializers.CharField(max_length=128)
    new_password = serializers.CharField(max_length=128, trim_whitespace=False)


class DeleteAccountSerializer(serializers.Serializer):
    password = serializers.CharField(required=False, allow_blank=True, trim_whitespace=False)
    confirm = serializers.CharField(required=False, allow_blank=True)
