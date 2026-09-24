#!/bin/sh
# Runs before the container's command (gunicorn, or the GPU controller).
#
# RUN_BOOTSTRAP=true applies database migrations and syncs LLM_MODELS first.
# It is safe with several containers starting at once: `bootstrap` takes a
# Postgres advisory lock, so they take turns.
set -e

if [ "${RUN_BOOTSTRAP:-false}" = "true" ]; then
  python manage.py bootstrap
fi

exec "$@"
