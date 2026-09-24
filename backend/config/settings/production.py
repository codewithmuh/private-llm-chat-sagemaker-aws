"""Production (AWS). Fails fast when required configuration is missing.

Traffic path: browser -> CloudFront (HTTPS) -> load balancer (HTTP) -> Django.
Django never sees TLS itself, so it learns that the original request was
HTTPS from a header. The load balancer's X-Forwarded-Proto says "http" (that
hop IS plain HTTP), so behind CloudFront set
PROXY_SSL_HEADER=HTTP_CLOUDFRONT_FORWARDED_PROTO.
"""

import os

from .base import *  # noqa: F403
from .base import env, env_int

DEBUG = False

_missing = [name for name in ("DJANGO_SECRET_KEY",) if not os.environ.get(name)]
if _missing:
    raise RuntimeError(f"Missing required environment variables: {', '.join(_missing)}")

SECURE_PROXY_SSL_HEADER = (env("PROXY_SSL_HEADER", "HTTP_X_FORWARDED_PROTO"), "https")
# CloudFront already redirects http -> https for browsers. Redirecting here as
# well would also redirect the load balancer's plain-HTTP health checks.
SECURE_SSL_REDIRECT = False
SECURE_HSTS_SECONDS = env_int("SECURE_HSTS_SECONDS", 60 * 60 * 24 * 365)
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "strict-origin-when-cross-origin"
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
X_FRAME_OPTIONS = "DENY"

# CloudFront and the load balancer both sit in front of Django.
REST_FRAMEWORK["NUM_PROXIES"] = env_int("NUM_PROXIES", 2)  # noqa: F405

LOGGING["handlers"]["console"]["formatter"] = env("LOG_FORMAT", "json")  # noqa: F405
