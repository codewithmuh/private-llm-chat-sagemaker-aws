"""Speech to text: the chat's microphone button.

The browser records the user, turns the recording into a small 16 kHz WAV
file (the format Whisper works with), and posts it to /api/speech/transcribe/.
We forward it to a Whisper server and hand the text back; the browser puts it
in the message box, where the user can fix it before sending.

The Whisper server is whisper.cpp (speech/ in this repo): a container next to
the api, locally and on AWS, so voice never leaves your infrastructure. It
speaks OpenAI's transcription API (POST /v1/audio/transcriptions), so
SPEECH_TO_TEXT_URL can point at any server that does, OpenAI's own included.
"""

from __future__ import annotations

import re

import httpx
from django.conf import settings


class SpeechError(Exception):
    """The speech server could not be reached, or could not transcribe."""


def enabled() -> bool:
    return bool(settings.SPEECH_TO_TEXT_URL)


def transcribe(audio: bytes, filename: str, content_type: str, *, transport: httpx.BaseTransport | None = None) -> str:
    fields = {"model": settings.SPEECH_TO_TEXT_MODEL, "response_format": "json"}
    if settings.SPEECH_TO_TEXT_LANGUAGE:
        fields["language"] = settings.SPEECH_TO_TEXT_LANGUAGE
    headers = {}
    if settings.SPEECH_TO_TEXT_API_KEY:  # only for a hosted service like OpenAI
        headers["Authorization"] = f"Bearer {settings.SPEECH_TO_TEXT_API_KEY}"
    try:
        with httpx.Client(timeout=settings.SPEECH_TO_TEXT_TIMEOUT_SECONDS, transport=transport) as client:
            response = client.post(
                f"{settings.SPEECH_TO_TEXT_URL}/v1/audio/transcriptions",
                data=fields,
                files={"file": (filename, audio, content_type)},
                headers=headers,
            )
    except httpx.TimeoutException:
        raise SpeechError("Transcribing took too long. Try a shorter recording.") from None
    except httpx.HTTPError as exc:
        raise SpeechError(f"The speech-to-text server could not be reached ({type(exc).__name__}).") from None
    if response.status_code != 200:
        raise SpeechError(f"The speech-to-text server answered with HTTP {response.status_code}.")
    try:
        text = response.json().get("text", "")
    except ValueError:
        raise SpeechError("The speech-to-text server did not answer with JSON.") from None
    # Whisper marks silence and noise like "[BLANK_AUDIO]" or "(music)".
    return clean(text)


def clean(text: str) -> str:
    text = re.sub(r"\[[A-Z_ ]+\]|\((?:music|silence|noise|applause|laughs?)\)", " ", text, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", text).strip()
