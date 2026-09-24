# syntax=docker/dockerfile:1.7
#
# One image, two jobs:
#   api             gunicorn serving Django (the default CMD)
#   gpu-controller  same image, command: python manage.py gpu_controller
#
# Builds for linux/amd64 and linux/arm64 (AWS Fargate runs it on ARM/Graviton,
# which is ~20% cheaper).

FROM python:3.12-slim AS api

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# tesseract-ocr: CPU OCR, used when no vision model is available (OCR_ENGINE=auto).
# curl: the container health check.
RUN apt-get update \
    && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

# Collect the admin's CSS/JS at build time, so containers never need write
# access to the image at runtime. WhiteNoise serves them.
RUN DJANGO_SETTINGS_MODULE=config.settings.dev python manage.py collectstatic --noinput --clear

# Never run as root. /app/media holds uploads when STORAGE_BACKEND=local.
RUN useradd --create-home --uid 10001 app \
    && mkdir -p /app/media \
    && chown -R app:app /app/media \
    && chmod +x /app/docker-entrypoint.sh
USER app

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -fsS http://localhost:8000/api/health/ || exit 1

ENTRYPOINT ["/app/docker-entrypoint.sh"]

# gthread workers: each streaming answer holds one thread for its duration.
# 2 workers x 16 threads = 32 answers streaming at once per container.
CMD ["gunicorn", "config.wsgi:application", \
     "--bind", "0.0.0.0:8000", \
     "--worker-class", "gthread", \
     "--workers", "2", \
     "--threads", "16", \
     "--timeout", "120", \
     "--graceful-timeout", "30", \
     "--access-logfile", "-"]
