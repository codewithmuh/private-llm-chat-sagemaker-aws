"""Models on an Amazon SageMaker real-time endpoint.

A SageMaker endpoint is not a URL you can POST to. Requests go through the AWS
API (`sagemaker-runtime`), signed with the caller's IAM credentials. That is
also why it is private: without `sagemaker:InvokeEndpoint` permission in your
account, nobody can call your model.

    streaming      InvokeEndpointWithResponseStream  -> PayloadPart events
    one-shot       InvokeEndpoint                     -> one JSON body

The container behind the endpoint (the AWS vLLM Deep Learning Container, or
our own ml/vllm-router) accepts an OpenAI chat-completions body on
/invocations, so the payload is exactly what OpenAICompatibleProvider sends.
"""

from __future__ import annotations

import json
from collections.abc import Iterator

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError
from django.conf import settings

from .base import ChatRequest, ChunkParser, Provider, ProviderError, Usage, error_from_body, split_lines

_clients: dict[str, object] = {}


def runtime_client(region: str):
    """One boto3 client per region, reused across requests (they are thread-safe)."""
    if region not in _clients:
        _clients[region] = boto3.client(
            "sagemaker-runtime",
            region_name=region,
            config=Config(
                read_timeout=settings.LLM_TIMEOUT_SECONDS,
                connect_timeout=10,
                retries={"max_attempts": 2, "mode": "standard"},
            ),
        )
    return _clients[region]


def classify_client_error(exc: ClientError) -> ProviderError:
    error = exc.response.get("Error", {})
    code = error.get("Code", "")
    message = error.get("Message", "")
    if code == "ValidationError" and ("not found" in message.lower() or "could not find" in message.lower()):
        return ProviderError("The model's GPU endpoint is not running.", "model_starting")
    if code in ("ModelNotReadyException", "ServiceUnavailable"):
        return ProviderError("The model is still loading. Try again in a minute.", "model_starting")
    if code == "ThrottlingException":
        return ProviderError("The model is busy. Try again in a moment.", "provider_error")
    if code == "ModelError":
        # The container answered with an error status; its body is in the message.
        original = exc.response.get("OriginalMessage") or message
        return error_from_body(original)
    if code in ("AccessDeniedException", "UnrecognizedClientException", "ExpiredTokenException"):
        return ProviderError(
            "This server is not allowed to call the SageMaker endpoint (check its IAM role / AWS credentials).",
            "model_unavailable",
        )
    return ProviderError(f"SageMaker error: {code or 'unknown'}", "provider_error")


class SageMakerProvider(Provider):
    def __init__(self, endpoint_name: str, model_id: str, region: str | None = None, client=None):
        self.endpoint_name = endpoint_name
        self.model_id = model_id
        self.region = region or settings.AWS_REGION
        self._client = client

    @property
    def client(self):
        return self._client or runtime_client(self.region)

    def _body(self, request: ChatRequest, stream: bool) -> bytes:
        body = {
            "messages": request.messages,
            "max_tokens": request.max_tokens,
            "temperature": request.temperature,
            "stream": stream,
            **request.extra,
        }
        if self.model_id:
            body["model"] = self.model_id
        if stream:
            body["stream_options"] = {"include_usage": True}
        return json.dumps(body).encode()

    def stream(self, request: ChatRequest) -> Iterator[str | Usage]:
        parser = ChunkParser()
        try:
            response = self.client.invoke_endpoint_with_response_stream(
                EndpointName=self.endpoint_name,
                ContentType="application/json",
                Accept="text/event-stream",
                Body=self._body(request, stream=True),
            )

            def payloads():
                for event in response["Body"]:
                    if "PayloadPart" in event:
                        yield event["PayloadPart"]["Bytes"]
                    elif "ModelStreamError" in event:
                        raise error_from_body(event["ModelStreamError"].get("Message", "model stream error"))
                    elif "InternalStreamFailure" in event:
                        raise ProviderError("SageMaker interrupted the stream. Please retry.")

            for line in split_lines(payloads()):
                yield from parser.feed_line(line)
                if parser.done:
                    break
        except ClientError as exc:
            raise classify_client_error(exc) from None
        except BotoCoreError as exc:
            raise ProviderError(f"Could not reach SageMaker ({type(exc).__name__}).", "model_unavailable") from None
        yield from parser.finish()
        yield parser.usage

    def complete(self, request: ChatRequest):
        from .base import Completion

        try:
            response = self.client.invoke_endpoint(
                EndpointName=self.endpoint_name,
                ContentType="application/json",
                Accept="application/json",
                Body=self._body(request, stream=False),
            )
            payload = json.loads(response["Body"].read())
        except ClientError as exc:
            raise classify_client_error(exc) from None
        except BotoCoreError as exc:
            raise ProviderError(f"Could not reach SageMaker ({type(exc).__name__}).", "model_unavailable") from None
        except ValueError:
            raise ProviderError("SageMaker returned something that is not JSON.") from None
        parser = ChunkParser()
        text = "".join(parser.feed_line(json.dumps(payload)) + parser.finish())
        return Completion(text=text, usage=parser.usage)
