"""POST /api/speech/transcribe/: a recording in, its text out (see whisper.py)."""

from __future__ import annotations

import logging

from django.conf import settings
from rest_framework import status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.common.errors import ApiError
from apps.common.throttles import SpeechThrottle

from . import whisper

log = logging.getLogger(__name__)


class TranscribeView(APIView):
    throttle_classes = [SpeechThrottle]

    def post(self, request: Request) -> Response:
        if not whisper.enabled():
            raise ApiError(
                "Speech to text is not set up on this server (SPEECH_TO_TEXT_URL).",
                code="speech_unavailable",
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        audio = request.FILES.get("audio")
        if audio is None:
            raise ApiError("Send the recording in the 'audio' field.", code="invalid", fields={"audio": "No file."})
        if audio.size > settings.SPEECH_MAX_MB * 1024 * 1024:
            raise ApiError(
                f"Recordings can be up to {settings.SPEECH_MAX_MB} MB (about 5 minutes).",
                code="file_too_large",
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            )
        content_type = audio.content_type or "audio/wav"
        if not content_type.startswith("audio/"):
            raise ApiError("That is not an audio file.", code="unsupported_file_type", status_code=415)

        try:
            text = whisper.transcribe(audio.read(), audio.name or "speech.wav", content_type)
        except whisper.SpeechError as exc:
            # The words themselves are never logged, only that it failed.
            log.warning("transcription failed", extra={"reason": str(exc)})
            raise ApiError(str(exc), code="speech_failed", status_code=status.HTTP_502_BAD_GATEWAY) from None
        return Response({"text": text})
