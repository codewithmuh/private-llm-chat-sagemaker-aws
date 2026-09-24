"""Session authentication for the API.

DRF's SessionAuthentication already does the important part: it reads the
Django session cookie and enforces CSRF on unsafe methods. Two additions:

1. Unauthenticated requests get **401** instead of DRF's default 403, so the
   frontend can tell "please log in" apart from "not allowed".
2. `enforce_csrf()` is exposed for the anonymous endpoints (login, sign-up...).
   DRF only checks CSRF for requests that are already logged in, but a login
   form without CSRF protection allows "login CSRF": a malicious page logs
   your browser into the attacker's account.
"""

from __future__ import annotations

from django.middleware.csrf import CsrfViewMiddleware
from rest_framework import authentication, exceptions


class _CSRFCheck(CsrfViewMiddleware):
    def _reject(self, request, reason):
        return reason


def enforce_csrf(request) -> None:
    """Raise PermissionDenied unless the request carries a valid CSRF token."""
    django_request = getattr(request, "_request", request)

    def dummy_get_response(_request):  # pragma: no cover - never called
        return None

    check = _CSRFCheck(dummy_get_response)
    check.process_request(django_request)
    reason = check.process_view(django_request, None, (), {})
    if reason:
        raise exceptions.PermissionDenied(f"CSRF Failed: {reason}")


class SessionAuthentication(authentication.SessionAuthentication):
    def authenticate_header(self, request):
        # Any non-empty value makes DRF answer 401 instead of 403.
        return "Session"
