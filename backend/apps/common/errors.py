"""One error shape for the whole API.

    {"error": "Message for humans", "code": "machine_code", "fields": {...}}

`fields` appears on validation errors only and maps a field name to its first
message. The frontend shows `error` in a toast and `fields` next to inputs.
"""

from __future__ import annotations

import logging

from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
from django.http import Http404
from rest_framework import exceptions, status
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler

log = logging.getLogger(__name__)


class ApiError(exceptions.APIException):
    """Raise this from any view for a specific status, code and message."""

    def __init__(
        self,
        message: str,
        *,
        code: str = "error",
        status_code: int = status.HTTP_400_BAD_REQUEST,
        fields: dict[str, str] | None = None,
        extra: dict | None = None,
    ):
        super().__init__(detail=message, code=code)
        self.status_code = status_code
        self.error_code = code
        self.fields = fields or {}
        self.extra = extra or {}


def _first_message(value) -> str:
    if isinstance(value, dict):
        return _first_message(next(iter(value.values()), ""))
    if isinstance(value, list | tuple):
        return _first_message(value[0]) if value else ""
    return str(value)


def _first_code(value) -> str:
    if isinstance(value, dict):
        return _first_code(next(iter(value.values()), None))
    if isinstance(value, list | tuple):
        return _first_code(value[0]) if value else "invalid"
    return str(getattr(value, "code", None) or "invalid")


DEFAULT_CODES = {
    400: "invalid",
    401: "not_authenticated",
    403: "permission_denied",
    404: "not_found",
    405: "method_not_allowed",
    413: "file_too_large",
    415: "unsupported_media_type",
    429: "throttled",
}


def exception_handler(exc, context):
    request = context.get("request")
    request_id = getattr(request, "request_id", None)

    if isinstance(exc, ApiError):
        body = {"error": str(exc.detail), "code": exc.error_code, **exc.extra}
        if exc.fields:
            body["fields"] = exc.fields
        return Response(body, status=exc.status_code)

    if isinstance(exc, Http404):
        exc = exceptions.NotFound()
    elif isinstance(exc, DjangoPermissionDenied):
        exc = exceptions.PermissionDenied()

    response = drf_exception_handler(exc, context)
    if response is None:
        log.exception("unhandled error", extra={"request_id": request_id})
        return Response(
            {"error": "Something went wrong on our side.", "code": "server_error"},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    code = DEFAULT_CODES.get(response.status_code, "error")
    body: dict = {}
    if isinstance(exc, exceptions.ValidationError):
        detail = exc.detail
        if isinstance(detail, dict):
            fields = {
                name: _first_message(value)
                for name, value in detail.items()
                if name != "non_field_errors"
            }
            non_field = detail.get("non_field_errors")
            message = _first_message(non_field) if non_field else (
                _first_message(detail) if not fields else "Please check the highlighted fields."
            )
            body = {"error": message, "code": _first_code(detail) if non_field else "invalid"}
            if fields:
                body["fields"] = fields
        else:
            body = {"error": _first_message(detail), "code": _first_code(detail)}
    elif isinstance(exc, exceptions.Throttled):
        wait = int(exc.wait or 0)
        body = {
            "error": f"Too many requests. Try again in {wait} seconds." if wait else "Too many requests.",
            "code": "throttled",
        }
    elif isinstance(exc, exceptions.PermissionDenied) and str(exc.detail).startswith("CSRF Failed"):
        body = {"error": "Your session expired. Refresh the page and try again.", "code": "csrf_failed"}
    elif isinstance(exc, exceptions.NotAuthenticated | exceptions.AuthenticationFailed):
        body = {"error": "Please log in.", "code": "not_authenticated"}
    else:
        body = {"error": _first_message(getattr(exc, "detail", "")) or "Request failed.", "code": code}

    response.data = body
    return response
