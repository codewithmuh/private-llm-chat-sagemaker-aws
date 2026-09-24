"""Load-balancer health endpoint that answers before Host validation.

The AWS load balancer's health check sends the TARGET'S PRIVATE IP as the Host
header (e.g. `10.0.12.34`). Django's ALLOWED_HOSTS rejects that with a 400, so
every task looks unhealthy and the load balancer serves 503s, even though the
app is fine.

Listing private IPs in ALLOWED_HOSTS is impractical (Fargate IPs change on
every deploy) and `*` would defeat the setting. So this middleware answers the
health path before host validation runs. It returns a fixed body and touches
no data; skipping host validation for it exposes nothing.
"""

from __future__ import annotations

from django.http import JsonResponse

HEALTH_PATHS = frozenset({"/api/health/", "/api/health"})


class HealthCheckMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path in HEALTH_PATHS and request.method in ("GET", "HEAD"):
            return JsonResponse({"status": "ok"})
        return self.get_response(request)
