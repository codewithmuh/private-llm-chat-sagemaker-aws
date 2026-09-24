"""Settings shared by every environment.

Everything that differs between your laptop and AWS is read from an environment
variable. docs/configuration.md lists them all; keep that page in sync when you
add one here.

The environment-specific modules (dev.py, production.py, test.py) import this
file and override a handful of values.
"""

from __future__ import annotations

import os
import urllib.parse
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent


# ------------------------------------------------------------------ helpers --


def env(name: str, default: str = "") -> str:
    return os.environ.get(name, default)


def env_bool(name: str, default: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None or value == "":
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


def env_int(name: str, default: int) -> int:
    value = os.environ.get(name, "")
    return int(value) if value.strip() else default


def env_list(name: str, default: str = "") -> list[str]:
    return [item.strip() for item in os.environ.get(name, default).split(",") if item.strip()]


def database_from_env() -> dict:
    """One `DATABASES["default"]` from DATABASE_URL, or from DB_* pieces.

    `sqlite:///db.sqlite3` is accepted too, so the backend can run with no
    database server at all (handy for a first look; use Postgres for real).
    """
    url = env("DATABASE_URL")
    if url:
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme == "sqlite":
            # sqlite:///db.sqlite3 -> backend/db.sqlite3 (relative)
            # sqlite:////tmp/db.sqlite3 -> /tmp/db.sqlite3 (absolute: four slashes)
            path = parsed.path
            name = path[1:] if path.startswith("//") else BASE_DIR / (path.lstrip("/") or "db.sqlite3")
            return {"ENGINE": "django.db.backends.sqlite3", "NAME": name}
        return {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": parsed.path.lstrip("/"),
            "USER": urllib.parse.unquote(parsed.username or ""),
            "PASSWORD": urllib.parse.unquote(parsed.password or ""),
            "HOST": parsed.hostname or "localhost",
            "PORT": str(parsed.port or 5432),
            "CONN_MAX_AGE": 60,
            "CONN_HEALTH_CHECKS": True,
            "OPTIONS": {"sslmode": env("DB_SSLMODE", "prefer")},
        }
    return {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": env("DB_NAME", "llmchat"),
        "USER": env("DB_USER", "llmchat"),
        "PASSWORD": env("DB_PASSWORD", ""),
        "HOST": env("DB_HOST", "localhost"),
        "PORT": env("DB_PORT", "5432"),
        "CONN_MAX_AGE": 60,
        "CONN_HEALTH_CHECKS": True,
        "OPTIONS": {"sslmode": env("DB_SSLMODE", "prefer")},
    }


# --------------------------------------------------------------------- core --

SECRET_KEY = env("DJANGO_SECRET_KEY", "dev-only-insecure-key-change-me")
DEBUG = False
ALLOWED_HOSTS = env_list("ALLOWED_HOSTS")

# Where people open the app (the web frontend). Email links point here.
PUBLIC_URL = env("PUBLIC_URL", "http://localhost:3000").rstrip("/")

ENABLE_ADMIN = env_bool("ENABLE_ADMIN", True)

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "corsheaders",
    "apps.common",
    "apps.accounts",
    "apps.llm",
    "apps.files",
    "apps.chat",
]

MIDDLEWARE = [
    # FIRST, before anything that validates the Host header. The load
    # balancer's health check sends the task's private IP as Host, which
    # ALLOWED_HOSTS would reject. See apps/common/health.py.
    "apps.common.health.HealthCheckMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    # Directly after SecurityMiddleware, per WhiteNoise's documentation.
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "apps.common.middleware.RequestIdMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ]
        },
    },
]

DATABASES = {"default": database_from_env()}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

LANGUAGE_CODE = "en"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

# ------------------------------------------------------------ accounts/auth --

AUTH_USER_MODEL = "accounts.User"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
        "OPTIONS": {"min_length": 8},
    },
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# Sessions live in the database, in an HttpOnly cookie. JavaScript never sees
# the credential, so an XSS bug cannot steal it.
SESSION_COOKIE_AGE = env_int("SESSION_COOKIE_AGE", 14 * 24 * 60 * 60)
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_HTTPONLY = True
# The CSRF cookie must be readable by the frontend: it copies the value into
# the X-CSRFToken header. That is the whole point of the double-submit check.
CSRF_COOKIE_HTTPONLY = False
CSRF_COOKIE_SAMESITE = "Lax"
CSRF_TRUSTED_ORIGINS = env_list("CSRF_TRUSTED_ORIGINS") or [PUBLIC_URL]

APP_NAME = env("APP_NAME", "Private LLM Chat")
SIGNUP_ENABLED = env_bool("SIGNUP_ENABLED", True)
# mandatory: no login until the email is verified; optional: verification is
# offered but not required; none: never asked.
EMAIL_VERIFICATION = env("EMAIL_VERIFICATION", "mandatory")
GOOGLE_CLIENT_ID = env("GOOGLE_CLIENT_ID")
# Users whose VERIFIED email is listed here become staff + superuser when they
# log in. The simplest way to reach /admin/ on a fresh deployment.
ADMIN_EMAILS = [e.lower() for e in env_list("ADMIN_EMAILS")]

# One-time codes (email verification, email 2FA, login step two).
OTP_CODE_TTL_SECONDS = env_int("OTP_CODE_TTL_SECONDS", 15 * 60)
OTP_MAX_ATTEMPTS = env_int("OTP_MAX_ATTEMPTS", 5)
# How long a "password OK, now give me your second factor" state is kept.
MFA_PENDING_TTL_SECONDS = env_int("MFA_PENDING_TTL_SECONDS", 10 * 60)

# ------------------------------------------------------------------- email --

EMAIL_PROVIDER = env("EMAIL_PROVIDER", "console")
EMAIL_BACKEND = {
    "console": "django.core.mail.backends.console.EmailBackend",
    "smtp": "django.core.mail.backends.smtp.EmailBackend",
    "ses": "apps.common.email.SESEmailBackend",
    "locmem": "django.core.mail.backends.locmem.EmailBackend",
}.get(EMAIL_PROVIDER, "django.core.mail.backends.console.EmailBackend")
EMAIL_HOST = env("EMAIL_HOST", "localhost")
EMAIL_PORT = env_int("EMAIL_PORT", 25)
EMAIL_HOST_USER = env("EMAIL_HOST_USER")
EMAIL_HOST_PASSWORD = env("EMAIL_HOST_PASSWORD")
EMAIL_USE_TLS = env_bool("EMAIL_USE_TLS", False)
EMAIL_TIMEOUT = 15
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", f"{APP_NAME} <no-reply@localhost>")

# ----------------------------------------------------------------- storage --

AWS_REGION = env("AWS_REGION", "us-east-1")
STORAGE_BACKEND = env("STORAGE_BACKEND", "local")
MEDIA_ROOT = Path(env("MEDIA_ROOT", str(BASE_DIR / "media")))
MEDIA_URL = "/media/"  # never served directly; files go through an auth-checked view

if STORAGE_BACKEND == "s3":
    _default_storage = {
        "BACKEND": "storages.backends.s3.S3Storage",
        "OPTIONS": {
            "bucket_name": env("S3_BUCKET"),
            "location": env("S3_PREFIX", "uploads/").strip("/"),
            "region_name": AWS_REGION,
            # Uploads are private. url() returns a presigned link that expires.
            "default_acl": None,
            "querystring_auth": True,
            "querystring_expire": 300,
            "file_overwrite": False,
            "signature_version": "s3v4",
        },
    }
else:
    _default_storage = {"BACKEND": "django.core.files.storage.FileSystemStorage"}

STATIC_URL = "/django-static/"  # not /static/: keeps clear of the web app's paths
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "default": _default_storage,
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}

MAX_UPLOAD_MB = env_int("MAX_UPLOAD_MB", 20)
# Uploaded files larger than this are streamed to a temp file instead of RAM.
FILE_UPLOAD_MAX_MEMORY_SIZE = 5 * 1024 * 1024

# --------------------------------------------------------------------- LLM --

# JSON list of models; see docs/configuration.md. Synced into the database by
# `python manage.py sync_models`.
LLM_MODELS = env("LLM_MODELS", "")
# ...or a path to a JSON file with the same list (used when LLM_MODELS is
# empty). docker compose mounts ../config/models.*.json here.
LLM_MODELS_FILE = env("LLM_MODELS_FILE")
LLM_TIMEOUT_SECONDS = env_int("LLM_TIMEOUT_SECONDS", 300)
OCR_ENGINE = env("OCR_ENGINE", "auto")
TITLE_GENERATION = env_bool("TITLE_GENERATION", True)
GPU_CONTROLLER_INTERVAL = env_int("GPU_CONTROLLER_INTERVAL", 30)
# Seconds between words for the in-process mock model (0 in tests).
MOCK_LLM_DELAY = float(env("MOCK_LLM_DELAY", "0.02"))

# --------------------------------------------------------------------- API --

REST_FRAMEWORK = {
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PARSER_CLASSES": [
        "rest_framework.parsers.JSONParser",
        "rest_framework.parsers.MultiPartParser",
        "rest_framework.parsers.FormParser",
    ],
    # SessionAuthentication enforces CSRF on every unsafe request from a
    # logged-in user. Anonymous auth endpoints enforce it themselves
    # (apps.accounts.views uses csrf_protect).
    "DEFAULT_AUTHENTICATION_CLASSES": ["apps.common.auth.SessionAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "EXCEPTION_HANDLER": "apps.common.errors.exception_handler",
    "DEFAULT_THROTTLE_RATES": {
        "auth": env("THROTTLE_AUTH", "20/min"),
        "otp_send": env("THROTTLE_OTP_SEND", "5/min"),
        "chat": env("THROTTLE_CHAT", "60/min"),
        "upload": env("THROTTLE_UPLOAD", "120/hour"),
        "ocr": env("THROTTLE_OCR", "30/hour"),
    },
    # How many proxies sit in front of Django. DRF uses it to pick the real
    # client IP out of X-Forwarded-For for rate limiting. On AWS it is 2
    # (CloudFront, then the load balancer). Getting it wrong lets clients spoof
    # their IP and dodge rate limits.
    "NUM_PROXIES": env_int("NUM_PROXIES", 0),
}

# ------------------------------------------------------------------ CORS ----
# Only needed when the web app and the API are on different origins, which is
# the case in local development (localhost:3000 -> localhost:8000). In
# production both are behind one domain.
CORS_ALLOWED_ORIGINS = env_list("CORS_ALLOWED_ORIGINS")
CORS_ALLOW_CREDENTIALS = True

# ---------------------------------------------------------------- logging ---
# Rule for this codebase: never log prompts, model answers, file contents,
# passwords or one-time codes. Log ids, sizes, durations and status codes.

LOG_LEVEL = env("LOG_LEVEL", "INFO")
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "json": {"()": "apps.common.logging.JSONFormatter"},
        "plain": {"format": "%(asctime)s %(levelname)s %(name)s: %(message)s"},
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": env("LOG_FORMAT", "plain"),
        },
    },
    "root": {"handlers": ["console"], "level": LOG_LEVEL},
    "loggers": {
        # At DEBUG, Django logs every SQL query with its parameters, which
        # would include message text. Keep it at INFO or above.
        "django.db.backends": {"level": "INFO", "handlers": ["console"], "propagate": False},
        "botocore": {"level": "WARNING", "handlers": ["console"], "propagate": False},
        "urllib3": {"level": "WARNING", "handlers": ["console"], "propagate": False},
        "httpx": {"level": "WARNING", "handlers": ["console"], "propagate": False},
    },
}
