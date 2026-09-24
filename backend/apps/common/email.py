"""Sending email: a tiny helper plus an Amazon SES backend.

`send_email("verify_email", to, context)` renders
templates/emails/verify_email.txt (first line = subject) and sends it with
whatever EMAIL_BACKEND is configured:

- console (default)  prints the email to the logs. Fine for a first run.
- smtp               e.g. Mailpit in docker compose (http://localhost:8025).
- ses                Amazon SES via boto3 (production on AWS).
"""

from __future__ import annotations

import logging

import boto3
from django.conf import settings
from django.core.mail import EmailMessage, send_mail
from django.core.mail.backends.base import BaseEmailBackend
from django.template.loader import render_to_string

log = logging.getLogger(__name__)


def send_email(template: str, to: str, context: dict | None = None) -> None:
    ctx = {"app_name": settings.APP_NAME, "public_url": settings.PUBLIC_URL, **(context or {})}
    rendered = render_to_string(f"emails/{template}.txt", ctx).strip()
    subject, _, body = rendered.partition("\n")
    send_mail(
        subject=subject.strip(),
        message=body.strip() + "\n",
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[to],
        fail_silently=False,
    )
    # The template name only: never the code or the address.
    log.info("email sent", extra={"template": template})


class SESEmailBackend(BaseEmailBackend):
    """Sends through SES v2 `SendEmail` with the raw MIME message.

    The task's IAM role needs `ses:SendEmail` / `ses:SendRawEmail`, and the
    From address must be a verified SES identity. A new SES account is in the
    *sandbox*: it can only send TO verified addresses until you request
    production access.
    """

    def __init__(self, fail_silently: bool = False, **kwargs):
        super().__init__(fail_silently=fail_silently, **kwargs)
        self._client = None

    @property
    def client(self):
        if self._client is None:
            self._client = boto3.client("sesv2", region_name=settings.AWS_REGION)
        return self._client

    def send_messages(self, email_messages: list[EmailMessage]) -> int:
        sent = 0
        for message in email_messages:
            try:
                self.client.send_email(
                    FromEmailAddress=message.from_email,
                    Destination={"ToAddresses": list(message.recipients())},
                    Content={"Raw": {"Data": message.message().as_bytes()}},
                )
                sent += 1
            except Exception:
                if not self.fail_silently:
                    raise
                log.exception("SES send failed")
        return sent
