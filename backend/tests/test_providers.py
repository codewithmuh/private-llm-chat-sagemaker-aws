"""Talking to model servers: stream parsing, OpenAI-compatible HTTP, SageMaker."""

from __future__ import annotations

import json

import httpx
import pytest
from botocore.exceptions import ClientError

from apps.llm.providers.base import ChatRequest, ChunkParser, ProviderError, Usage, split_lines
from apps.llm.providers.openai_compat import OpenAICompatibleProvider
from apps.llm.providers.sagemaker import SageMakerProvider


def chunk(content=None, reasoning=None, usage=None) -> str:
    delta = {}
    if content is not None:
        delta["content"] = content
    if reasoning is not None:
        delta["reasoning_content"] = reasoning
    body = {"object": "chat.completion.chunk", "choices": [{"index": 0, "delta": delta}] if delta else []}
    if usage:
        body["usage"] = usage
    return json.dumps(body)


def test_parser_handles_sse_and_json_lines():
    parser = ChunkParser()
    out = []
    for line in [
        f"data: {chunk('Hel')}",
        "",
        ": keep-alive",
        chunk("lo"),
        f"data: {chunk(usage={'prompt_tokens': 5, 'completion_tokens': 2})}",
        "data: [DONE]",
    ]:
        out += parser.feed_line(line)
    assert "".join(out) == "Hello"
    assert parser.done
    assert parser.usage == Usage(5, 2)


def test_parser_wraps_reasoning_in_think_tags():
    parser = ChunkParser()
    out = parser.feed_line(chunk(reasoning="Let me think.")) + parser.feed_line(chunk("Answer."))
    assert "".join(out) == "<think>\nLet me think.\n</think>\n\nAnswer."


def test_parser_raises_on_error_chunks():
    with pytest.raises(ProviderError) as info:
        ChunkParser().feed_line(
            'data: {"object": "error", "message": "This model\'s maximum context length is 4096 tokens"}'
        )
    assert info.value.code == "context_too_long"


def test_split_lines_reassembles_packets():
    assert list(split_lines([b"data: a", b"bc\ndata: d", b"ef\n", b"tail"])) == ["data: abc", "data: def", "tail"]


def test_openai_compatible_provider():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["auth"] = request.headers.get("authorization")
        seen["body"] = json.loads(request.content)
        body = "\n\n".join(
            f"data: {c}"
            for c in [chunk("Hi"), chunk(" there"), chunk(usage={"prompt_tokens": 3, "completion_tokens": 2})]
        )
        return httpx.Response(200, text=body + "\n\ndata: [DONE]\n\n", headers={"content-type": "text/event-stream"})

    provider = OpenAICompatibleProvider(
        "http://llm:8000/v1/", "my-model", api_key="k", transport=httpx.MockTransport(handler)
    )
    result = provider.complete(ChatRequest(messages=[{"role": "user", "content": "hey"}], max_tokens=10))
    assert result.text == "Hi there"
    assert result.usage.completion_tokens == 2
    assert seen["url"] == "http://llm:8000/v1/chat/completions"
    assert seen["auth"] == "Bearer k"
    assert seen["body"]["model"] == "my-model" and seen["body"]["stream"] is True


def test_openai_compatible_provider_errors():
    def handler(request):
        return httpx.Response(400, json={"error": {"message": "prompt is too long"}})

    provider = OpenAICompatibleProvider("http://llm/v1", "m", transport=httpx.MockTransport(handler))
    with pytest.raises(ProviderError) as info:
        provider.complete(ChatRequest(messages=[]))
    assert info.value.code == "context_too_long"

    def refuse(request):
        raise httpx.ConnectError("refused")

    provider = OpenAICompatibleProvider("http://llm/v1", "m", transport=httpx.MockTransport(refuse))
    with pytest.raises(ProviderError) as info:
        provider.complete(ChatRequest(messages=[]))
    assert info.value.code == "model_unavailable"


class FakeRuntime:
    """Stands in for boto3's sagemaker-runtime client."""

    def __init__(self, parts: list[bytes] | None = None, error: ClientError | None = None):
        self.parts = parts or []
        self.error = error
        self.calls = []

    def invoke_endpoint_with_response_stream(self, **kwargs):
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        return {"Body": iter([{"PayloadPart": {"Bytes": p}} for p in self.parts])}

    def invoke_endpoint(self, **kwargs):
        self.calls.append(kwargs)
        if self.error:
            raise self.error

        class Body:
            def read(self_inner):
                return json.dumps({"choices": [{"message": {"content": "Short title"}}]}).encode()

        return {"Body": Body()}


def test_sagemaker_streaming_splits_across_payload_parts():
    sse = f"data: {chunk('Hello')}\n\ndata: {chunk(' world')}\n\ndata: [DONE]\n\n".encode()
    runtime = FakeRuntime(parts=[sse[:17], sse[17:40], sse[40:]])  # cut mid-line on purpose
    provider = SageMakerProvider("llmchat-dev-qwen", "Qwen/Qwen3-VL-8B-Instruct-FP8", "us-east-1", client=runtime)
    assert provider.complete.__self__ is provider
    pieces = [
        p for p in provider.stream(ChatRequest(messages=[{"role": "user", "content": "hi"}])) if isinstance(p, str)
    ]
    assert "".join(pieces) == "Hello world"
    call = runtime.calls[0]
    assert call["EndpointName"] == "llmchat-dev-qwen"
    body = json.loads(call["Body"])
    assert body["stream"] is True and body["model"] == "Qwen/Qwen3-VL-8B-Instruct-FP8"


def test_sagemaker_non_streaming():
    provider = SageMakerProvider("e", "m", "us-east-1", client=FakeRuntime())
    assert provider.complete(ChatRequest(messages=[])).text == "Short title"


def test_sagemaker_missing_endpoint_means_starting():
    error = ClientError(
        {"Error": {"Code": "ValidationError", "Message": "Endpoint e of account 1 not found."}},
        "InvokeEndpointWithResponseStream",
    )
    provider = SageMakerProvider("e", "m", "us-east-1", client=FakeRuntime(error=error))
    with pytest.raises(ProviderError) as info:
        list(provider.stream(ChatRequest(messages=[])))
    assert info.value.code == "model_starting"


def test_sagemaker_model_error_is_decoded():
    error = ClientError(
        {
            "Error": {"Code": "ModelError", "Message": "Received client error (400)"},
            "OriginalMessage": '{"error": {"message": "maximum context length exceeded"}}',
        },
        "InvokeEndpoint",
    )
    provider = SageMakerProvider("e", "m", "us-east-1", client=FakeRuntime(error=error))
    with pytest.raises(ProviderError) as info:
        provider.complete(ChatRequest(messages=[]))
    assert info.value.code == "context_too_long"


def test_api_key_can_come_from_the_environment(monkeypatch):
    from apps.llm.providers import resolve_secret

    monkeypatch.setenv("OPENAI_KEY", "sk-from-env")
    assert resolve_secret("env:OPENAI_KEY") == "sk-from-env"
    assert resolve_secret("plain") == "plain"
    assert resolve_secret("env:MISSING") == ""
