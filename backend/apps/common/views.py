"""Public runtime configuration for the web app.

The frontend reads these at runtime instead of baking them in at build time,
so one web image works in every environment.
"""

from __future__ import annotations

from django.conf import settings
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response

from apps.files.extract import ACCEPTED_EXTENSIONS


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def config_view(request: Request) -> Response:
    return Response(
        {
            "app_name": settings.APP_NAME,
            "google_client_id": settings.GOOGLE_CLIENT_ID or None,
            "signup_enabled": settings.SIGNUP_ENABLED,
            "email_verification": settings.EMAIL_VERIFICATION,
            "max_upload_mb": settings.MAX_UPLOAD_MB,
            "accepted_file_types": sorted(ACCEPTED_EXTENSIONS),
        }
    )
