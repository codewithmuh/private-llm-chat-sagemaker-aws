"""ASGI entry point.

Not used by default: chat streaming is written with plain (sync) generators,
which gunicorn's threaded workers stream fine. Under ASGI, Django would buffer
a sync generator completely before sending it, so stick to WSGI unless you
rewrite the streaming views as async.
"""

import os

from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.dev")

application = get_asgi_application()
