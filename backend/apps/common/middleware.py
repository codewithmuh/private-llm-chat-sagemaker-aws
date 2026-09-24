"""Request correlation id.

Every response carries `X-Request-Id`. Quote it in a bug report and the matching
log lines can be found. It is a random UUID, so it is safe to log and to show.
"""

from __future__ import annotations

import uuid


class RequestIdMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request_id = request.headers.get("X-Request-Id", "")
        try:
            uuid.UUID(request_id)
        except (ValueError, AttributeError):
            request_id = str(uuid.uuid4())
        request.request_id = request_id
        response = self.get_response(request)
        response["X-Request-Id"] = request_id
        return response
