"""Speech to text: the microphone button's endpoint and the Whisper client."""

from __future__ import annotations

import httpx
import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.speech import whisper

from .conftest import Client

WHISPER = "http://whisper:9000"
WAV = b"RIFF\x24\x00\x00\x00WAVEfmt " + b"\x00" * 28  # the content doesn't matter here


@pytest.fixture
def speech_on(settings):
    settings.SPEECH_TO_TEXT_URL = WHISPER
    settings.SPEECH_TO_TEXT_API_KEY = ""
    settings.SPEECH_TO_TEXT_LANGUAGE = ""


def recording(name="speech.wav", content_type="audio/wav", data=WAV) -> SimpleUploadedFile:
    return SimpleUploadedFile(name, data, content_type=content_type)


# ------------------------------------------------------------ the client ---


def test_transcribe_posts_openai_style_multipart(speech_on, settings):
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"text": " Who is the prime minister of Pakistan? [BLANK_AUDIO] "})

    settings.SPEECH_TO_TEXT_LANGUAGE = "en"
    text = whisper.transcribe(WAV, "speech.wav", "audio/wav", transport=httpx.MockTransport(handler))

    assert text == "Who is the prime minister of Pakistan?"  # noise markers removed
    request = seen[0]
    assert str(request.url) == f"{WHISPER}/v1/audio/transcriptions"
    body = request.read()
    assert b'name="file"; filename="speech.wav"' in body
    assert b'name="response_format"' in body and b"json" in body
    assert b'name="language"' in body
    assert "authorization" not in request.headers  # no key for a local server


def test_transcribe_sends_the_api_key_for_hosted_services(speech_on, settings):
    settings.SPEECH_TO_TEXT_API_KEY = "sk-test"
    seen = []

    def handler(request):
        seen.append(request)
        return httpx.Response(200, json={"text": "hi"})

    whisper.transcribe(WAV, "a.wav", "audio/wav", transport=httpx.MockTransport(handler))
    assert seen[0].headers["authorization"] == "Bearer sk-test"


def test_transcribe_errors(speech_on):
    with pytest.raises(whisper.SpeechError, match="HTTP 500"):
        whisper.transcribe(WAV, "a.wav", "audio/wav", transport=httpx.MockTransport(lambda r: httpx.Response(500)))

    def down(request):
        raise httpx.ConnectError("refused")

    with pytest.raises(whisper.SpeechError, match="could not be reached"):
        whisper.transcribe(WAV, "a.wav", "audio/wav", transport=httpx.MockTransport(down))


@pytest.mark.parametrize(
    ("raw", "clean"),
    [("[BLANK_AUDIO]", ""), ("(music) Hello there (Music)", "Hello there"), ("  two   spaces ", "two spaces")],
)
def test_clean(raw, clean):
    assert whisper.clean(raw) == clean


# -------------------------------------------------------------- the view ---


def test_config_says_whether_the_mic_is_available(client: Client, settings):
    settings.SPEECH_TO_TEXT_URL = ""
    assert client.get("/api/config/").json()["speech_to_text"] is False
    settings.SPEECH_TO_TEXT_URL = WHISPER
    assert client.get("/api/config/").json()["speech_to_text"] is True


def test_transcribe_endpoint(auth_client: Client, speech_on, monkeypatch):
    received = []

    def fake(audio, filename, content_type):
        received.append((audio, filename, content_type))
        return "Hello from my microphone"

    monkeypatch.setattr(whisper, "transcribe", fake)
    res = auth_client.post("/api/speech/transcribe/", {"audio": recording()}, format="multipart")
    assert res.status_code == 200, res.content
    assert res.json() == {"text": "Hello from my microphone"}
    assert received == [(WAV, "speech.wav", "audio/wav")]


def test_transcribe_endpoint_errors(auth_client: Client, speech_on, settings, monkeypatch):
    url = "/api/speech/transcribe/"
    assert auth_client.post(url, {}, format="multipart").status_code == 400  # no audio
    not_audio = recording("notes.txt", "text/plain", b"hello")
    assert auth_client.post(url, {"audio": not_audio}, format="multipart").status_code == 415

    def broken(*args):
        raise whisper.SpeechError("The speech-to-text server answered with HTTP 500.")

    monkeypatch.setattr(whisper, "transcribe", broken)
    res = auth_client.post(url, {"audio": recording()}, format="multipart")
    assert res.status_code == 502 and res.json()["code"] == "speech_failed"

    settings.SPEECH_MAX_MB = 0
    assert auth_client.post(url, {"audio": recording()}, format="multipart").status_code == 413

    settings.SPEECH_TO_TEXT_URL = ""
    assert auth_client.post(url, {"audio": recording()}, format="multipart").status_code == 503


def test_transcribe_needs_login(client: Client, speech_on):
    res = client.post("/api/speech/transcribe/", {"audio": recording()}, format="multipart")
    assert res.status_code in (401, 403)
