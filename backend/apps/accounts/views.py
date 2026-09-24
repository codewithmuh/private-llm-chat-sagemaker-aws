"""Auth endpoints. The contract is in docs/api.md ("Auth").

How a login works, end to end:

    POST login/ {email, password}
      ├─ wrong password ................ 400 invalid_credentials
      ├─ email not verified ............ 403 email_not_verified (a code is emailed)
      ├─ no 2FA ........................ {"status": "ok", "user": ...}   <- logged in
      └─ 2FA enabled ................... {"status": "mfa_required", "methods": [...]}
                                           session remembers "password OK" for 10 min
    POST login/mfa/ {method, code} ..... {"status": "ok", "user": ...}   <- logged in

Google sign-in (POST google/) and email verification (POST verify-email/) end
the same way, so the frontend handles one response shape.
"""

from __future__ import annotations

from django.conf import settings
from django.contrib.auth import authenticate, logout, update_session_auth_hash
from django.contrib.auth.tokens import default_token_generator
from django.middleware.csrf import get_token
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode
from rest_framework import status
from rest_framework.permissions import SAFE_METHODS, AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.common.auth import enforce_csrf
from apps.common.email import send_email
from apps.common.errors import ApiError
from apps.common.throttles import AuthThrottle, OtpSendThrottle

from . import services
from .models import OneTimeCode, TOTPDevice, User
from .serializers import (
    CodeSerializer,
    DeleteAccountSerializer,
    EmailCodeSerializer,
    EmailSerializer,
    GoogleSerializer,
    LoginSerializer,
    MeUpdateSerializer,
    MfaLoginSerializer,
    PasswordChangeSerializer,
    PasswordResetConfirmSerializer,
    SignupSerializer,
    user_payload,
    validate_new_password,
)


class AuthView(APIView):
    """Base for endpoints used before (or while) logging in.

    DRF only checks CSRF for requests that are already authenticated. These
    endpoints are anonymous, so they check it themselves; otherwise a
    malicious site could silently log your browser into ITS account.
    """

    permission_classes = [AllowAny]
    throttle_classes = [AuthThrottle]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if request.method not in SAFE_METHODS:
            enforce_csrf(request)


class LoggedInView(AuthView):
    permission_classes = [IsAuthenticated]


def login_response(request: Request, result: dict, status_code: int = 200) -> Response:
    if result["status"] == "ok":
        result = {**result, "user": user_payload(request.user)}
    return Response(result, status=status_code)


def _validated(serializer_class, request: Request) -> dict:
    serializer = serializer_class(data=request.data)
    serializer.is_valid(raise_exception=True)
    return serializer.validated_data


# ----------------------------------------------------------------- session ----


class CsrfView(AuthView):
    """Sets the `csrftoken` cookie. Call once before the first POST."""

    throttle_classes = []

    def get(self, request: Request) -> Response:
        get_token(request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class SignupView(AuthView):
    def post(self, request: Request) -> Response:
        if not settings.SIGNUP_ENABLED:
            raise ApiError(
                "Sign-up is closed. Ask an administrator for an account.", code="signup_disabled", status_code=403
            )
        data = _validated(SignupSerializer, request)
        if User.objects.filter(email__iexact=data["email"]).exists():
            raise ApiError(
                "An account with this email already exists.",
                code="email_taken",
                fields={"email": "An account with this email already exists. Log in or reset your password."},
            )
        user = User.objects.create_user(email=data["email"], password=data["password"], name=data["name"])

        mode = settings.EMAIL_VERIFICATION
        if mode in ("mandatory", "optional"):
            services.send_code(user, OneTimeCode.Purpose.VERIFY_EMAIL)
        if mode == "mandatory":
            return Response(
                {"status": "verification_required", "email": user.email},
                status=status.HTTP_201_CREATED,
            )
        return login_response(request, services.begin_login(request, user), status.HTTP_201_CREATED)


class VerifyEmailView(AuthView):
    def post(self, request: Request) -> Response:
        data = _validated(EmailCodeSerializer, request)
        user = User.objects.filter(email__iexact=data["email"]).first()
        if user is None:
            raise ApiError("That code is not valid. Request a new one.", code="invalid_code")
        services.check_code(user, OneTimeCode.Purpose.VERIFY_EMAIL, data["code"])
        if not user.email_verified:
            user.email_verified = True
            user.save(update_fields=["email_verified"])
        # The code proves the person controls the inbox, so it also logs them
        # in (like a magic link), still asking for 2FA if they have it.
        return login_response(request, services.begin_login(request, user))


class ResendVerificationView(AuthView):
    throttle_classes = [OtpSendThrottle]

    def post(self, request: Request) -> Response:
        data = _validated(EmailSerializer, request)
        user = User.objects.filter(email__iexact=data["email"]).first()
        # Same answer whether or not the account exists: this endpoint must
        # not reveal who has an account.
        if user is not None and not user.email_verified:
            services.send_code(user, OneTimeCode.Purpose.VERIFY_EMAIL)
        return Response({"status": "sent"})


class LoginView(AuthView):
    def post(self, request: Request) -> Response:
        data = _validated(LoginSerializer, request)
        user = authenticate(request, email=data["email"].strip().lower(), password=data["password"])
        if user is None:
            raise ApiError("Wrong email or password.", code="invalid_credentials")
        if settings.EMAIL_VERIFICATION == "mandatory" and not user.email_verified:
            services.send_code(user, OneTimeCode.Purpose.VERIFY_EMAIL)
            raise ApiError(
                "Please verify your email address. We just sent you a new code.",
                code="email_not_verified",
                status_code=403,
                extra={"email": user.email},
            )
        return login_response(request, services.begin_login(request, user))


class MfaLoginView(AuthView):
    def post(self, request: Request) -> Response:
        data = _validated(MfaLoginSerializer, request)
        user = services.pending_user(request)
        services.check_second_factor(user, data["method"], data["code"])
        services.finish_login(request, user)
        return login_response(request, {"status": "ok"})


class MfaLoginEmailView(AuthView):
    throttle_classes = [OtpSendThrottle]

    def post(self, request: Request) -> Response:
        user = services.pending_user(request)
        if not user.mfa_email_enabled:
            raise ApiError("Email codes are not enabled for this account.", code="invalid_method")
        services.send_code(user, OneTimeCode.Purpose.LOGIN)
        return Response({"status": "sent"})


class GoogleLoginView(AuthView):
    def post(self, request: Request) -> Response:
        data = _validated(GoogleSerializer, request)
        identity = services.verify_google_credential(data["credential"])
        user = services.user_from_google(identity)
        return login_response(request, services.begin_login(request, user))


class LogoutView(AuthView):
    throttle_classes = []

    def post(self, request: Request) -> Response:
        logout(request)
        return Response(status=status.HTTP_204_NO_CONTENT)


# --------------------------------------------------------------------- me ----


class MeView(LoggedInView):
    throttle_classes = []

    def get(self, request: Request) -> Response:
        return Response(user_payload(request.user))

    def patch(self, request: Request) -> Response:
        data = _validated(MeUpdateSerializer, request)
        user: User = request.user
        fields = []
        if "name" in data:
            user.name = data["name"]
            fields.append("name")
        prefs = data.get("preferences") or {}
        if "default_model" in prefs:
            slug = prefs["default_model"] or ""
            if slug:
                from apps.llm.models import LLMModel

                if not LLMModel.objects.filter(slug=slug, enabled=True).exists():
                    raise ApiError("Unknown model.", code="invalid", fields={"default_model": "Unknown model."})
            user.default_model = slug
            fields.append("default_model")
        if "custom_instructions" in prefs:
            user.custom_instructions = prefs["custom_instructions"]
            fields.append("custom_instructions")
        if "theme" in prefs:
            user.theme = prefs["theme"]
            fields.append("theme")
        if fields:
            user.save(update_fields=fields)
        return Response(user_payload(user))

    def delete(self, request: Request) -> Response:
        data = _validated(DeleteAccountSerializer, request)
        user: User = request.user
        if user.has_usable_password():
            if not user.check_password(data.get("password") or ""):
                raise ApiError("Wrong password.", code="invalid_credentials", fields={"password": "Wrong password."})
        elif (data.get("confirm") or "") != "DELETE":
            raise ApiError('Type "DELETE" to confirm.', code="invalid", fields={"confirm": 'Type "DELETE" to confirm.'})
        logout(request)
        user.delete()  # cascades to conversations, messages and files
        return Response(status=status.HTTP_204_NO_CONTENT)


# --------------------------------------------------------------- passwords ----


class PasswordChangeView(LoggedInView):
    def post(self, request: Request) -> Response:
        data = _validated(PasswordChangeSerializer, request)
        user: User = request.user
        if user.has_usable_password() and not user.check_password(data.get("current_password") or ""):
            raise ApiError(
                "Your current password is not correct.",
                code="invalid_credentials",
                fields={"current_password": "Your current password is not correct."},
            )
        try:
            validate_new_password(data["new_password"], user)
        except Exception as exc:
            raise ApiError(
                "Please choose a stronger password.",
                code="invalid",
                fields={"new_password": " ".join(str(m) for m in getattr(exc, "detail", [str(exc)]))},
            ) from exc
        user.set_password(data["new_password"])
        user.save(update_fields=["password"])
        # Changing the password logs out every other session; keep this one.
        update_session_auth_hash(request, user)
        return Response({"status": "ok"})


class PasswordResetView(AuthView):
    throttle_classes = [OtpSendThrottle]

    def post(self, request: Request) -> Response:
        data = _validated(EmailSerializer, request)
        user = User.objects.filter(email__iexact=data["email"], is_active=True).first()
        if user is not None:
            uid = urlsafe_base64_encode(force_bytes(user.pk))
            token = default_token_generator.make_token(user)
            send_email(
                "password_reset",
                user.email,
                {"name": user.name, "link": f"{settings.PUBLIC_URL}/reset-password?uid={uid}&token={token}"},
            )
        return Response({"status": "sent"})


class PasswordResetConfirmView(AuthView):
    def post(self, request: Request) -> Response:
        data = _validated(PasswordResetConfirmSerializer, request)
        invalid = ApiError("This reset link is invalid or has expired.", code="invalid_token")
        try:
            user = User.objects.get(pk=force_str(urlsafe_base64_decode(data["uid"])))
        except (User.DoesNotExist, ValueError, TypeError, OverflowError):
            raise invalid from None
        # Django's token embeds the password hash and last login, so it stops
        # working once used or once the password changes.
        if not default_token_generator.check_token(user, data["token"]):
            raise invalid
        try:
            validate_new_password(data["new_password"], user)
        except Exception as exc:
            raise ApiError(
                "Please choose a stronger password.",
                code="invalid",
                fields={"new_password": " ".join(str(m) for m in getattr(exc, "detail", [str(exc)]))},
            ) from exc
        user.set_password(data["new_password"])
        # Following the emailed link proves the inbox is theirs.
        user.email_verified = True
        user.save(update_fields=["password", "email_verified"])
        return Response({"status": "ok"})


# -------------------------------------------------------------------- MFA ----


class MfaStatusView(LoggedInView):
    throttle_classes = []

    def get(self, request: Request) -> Response:
        return Response(user_payload(request.user)["mfa"])


class TotpSetupView(LoggedInView):
    def post(self, request: Request) -> Response:
        setup = services.start_totp_setup(request.user)
        return Response({"secret": setup.secret, "otpauth_url": setup.otpauth_url, "qr_svg": setup.qr_svg})


class TotpConfirmView(LoggedInView):
    def post(self, request: Request) -> Response:
        data = _validated(CodeSerializer, request)
        codes = services.confirm_totp(request.user, data["code"])
        return Response({"status": "ok", "recovery_codes": codes})


class TotpDisableView(LoggedInView):
    def post(self, request: Request) -> Response:
        data = _validated(CodeSerializer, request)
        user: User = request.user
        if not user.totp_enabled:
            raise ApiError("No authenticator app is set up.", code="not_enabled")
        if not (services.check_totp(user.totp_device, data["code"]) or services.use_recovery_code(user, data["code"])):
            raise ApiError("That code is not correct.", code="invalid_code")
        TOTPDevice.objects.filter(user=user).delete()
        user.refresh_from_db()
        services.after_mfa_method_removed(user)
        return Response({"status": "ok"})


class EmailMfaSendView(LoggedInView):
    throttle_classes = [OtpSendThrottle]

    def post(self, request: Request) -> Response:
        services.send_code(request.user, OneTimeCode.Purpose.MFA_SETUP)
        return Response({"status": "sent"})


class EmailMfaConfirmView(LoggedInView):
    def post(self, request: Request) -> Response:
        data = _validated(CodeSerializer, request)
        user: User = request.user
        if user.mfa_email_enabled:
            raise ApiError("Email codes are already enabled.", code="already_enabled")
        services.check_code(user, OneTimeCode.Purpose.MFA_SETUP, data["code"])
        had_mfa = user.mfa_enabled
        user.mfa_email_enabled = True
        # Receiving the code also proves the address works.
        user.email_verified = True
        user.save(update_fields=["mfa_email_enabled", "email_verified"])
        codes = [] if had_mfa else services.new_recovery_codes(user)
        return Response({"status": "ok", "recovery_codes": codes})


class EmailMfaDisableView(LoggedInView):
    def post(self, request: Request) -> Response:
        data = _validated(CodeSerializer, request)
        user: User = request.user
        if not user.mfa_email_enabled:
            raise ApiError("Email codes are not enabled.", code="not_enabled")
        if not services.use_recovery_code(user, data["code"]):
            services.check_code(user, OneTimeCode.Purpose.MFA_SETUP, data["code"])
        user.mfa_email_enabled = False
        user.save(update_fields=["mfa_email_enabled"])
        services.after_mfa_method_removed(user)
        return Response({"status": "ok"})


class RecoveryCodesView(LoggedInView):
    """New recovery codes. Needs a fresh second-factor code, so someone who
    walks up to an unlocked laptop cannot mint themselves a way in."""

    def post(self, request: Request) -> Response:
        data = _validated(CodeSerializer, request)
        user: User = request.user
        if not user.mfa_enabled:
            raise ApiError("Turn on two-factor authentication first.", code="not_enabled")
        ok = user.totp_enabled and services.check_totp(user.totp_device, data["code"])
        if not ok:
            if not user.mfa_email_enabled:
                raise ApiError("That code is not correct.", code="invalid_code")
            services.check_code(user, OneTimeCode.Purpose.MFA_SETUP, data["code"])
        return Response({"recovery_codes": services.new_recovery_codes(user)})
