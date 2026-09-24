#!/bin/sh
# SageMaker starts inference containers as `docker run <image> serve`: it
# appends the word "serve". Pointing ENTRYPOINT straight at uvicorn would put
# "serve" on uvicorn's command line, which fails with
#
#     Error: Got unexpected extra argument (serve)
#
# and SageMaker then only reports "did not pass the ping health check", which
# says nothing about the real cause. This wrapper swallows the argument.
set -e

case "${1:-serve}" in
  serve|"") ;;                                   # SageMaker, or a bare `docker run`
  train)    echo "This image serves inference only." >&2; exit 1 ;;
  *)        exec "$@" ;;                         # anything else: run it (debugging)
esac

exec uvicorn server:app --host 0.0.0.0 --port "${PORT:-8080}" --no-access-log --log-level info
