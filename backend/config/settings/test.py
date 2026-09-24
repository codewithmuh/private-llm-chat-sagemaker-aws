"""Test settings: SQLite in memory, fast password hashing, no network.

pytest uses this (see pytest.ini). Nothing here talks to AWS, a model server
or an SMTP server; tests fake those at the boundary.
"""

import tempfile

from .base import *  # noqa: F403

DEBUG = False
SECRET_KEY = "test-only-not-a-secret"  # noqa: S105
ALLOWED_HOSTS = ["testserver", "localhost"]

DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}}

# Hashing a password with PBKDF2 takes ~100 ms on purpose. Tests create a lot
# of users; the insecure hasher keeps the suite fast.
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]

EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
MEDIA_ROOT = Path(tempfile.mkdtemp(prefix="llmchat-test-media-"))  # noqa: F405
STORAGES = {  # noqa: F405
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}

GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com"
EMAIL_VERIFICATION = "mandatory"
OCR_ENGINE = "llm"
TITLE_GENERATION = True
LLM_MODELS = "[]"

# Throttling is tested explicitly where it matters; elsewhere it would make
# tests order-dependent.
REST_FRAMEWORK = {  # noqa: F405
    **REST_FRAMEWORK,  # noqa: F405
    "DEFAULT_THROTTLE_RATES": {
        "auth": "1000/min",
        "otp_send": "1000/min",
        "chat": "1000/min",
        "upload": "1000/min",
        "ocr": "1000/min",
    },
}
