"""Rate-limit scopes. Rates are set in settings.REST_FRAMEWORK."""

from rest_framework.throttling import SimpleRateThrottle, UserRateThrottle


class AuthThrottle(SimpleRateThrottle):
    """Per client IP: login, sign-up, Google, MFA and verification attempts."""

    scope = "auth"

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}


class OtpSendThrottle(AuthThrottle):
    """Per client IP: anything that sends an email with a code."""

    scope = "otp_send"


class ChatThrottle(UserRateThrottle):
    scope = "chat"


class UploadThrottle(UserRateThrottle):
    scope = "upload"


class OcrThrottle(UserRateThrottle):
    scope = "ocr"
