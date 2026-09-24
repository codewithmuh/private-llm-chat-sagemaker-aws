"""Local development: `docker compose up`, or `python manage.py runserver`.

The web app runs on http://localhost:3000 and calls the API on
http://localhost:8000. Those are different origins but the same *site*
(cookies ignore the port), so the session cookie works; CORS and the CSRF
trusted origins below allow the cross-origin requests.
"""

from .base import *  # noqa: F403
from .base import env_list

DEBUG = True
ALLOWED_HOSTS = ["*"]

CORS_ALLOWED_ORIGINS = env_list("CORS_ALLOWED_ORIGINS", "http://localhost:3000")
CSRF_TRUSTED_ORIGINS = env_list("CSRF_TRUSTED_ORIGINS", "http://localhost:3000")
