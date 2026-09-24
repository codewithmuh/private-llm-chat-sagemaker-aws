"""GET /api/models/ and POST /api/models/{id}/wake/ (docs/api.md, "Models")."""

from __future__ import annotations

from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.request import Request
from rest_framework.response import Response

from .models import LLMModel
from .services import get_model, request_wake


@api_view(["GET"])
def model_list(request: Request) -> Response:
    return Response([m.as_api() for m in LLMModel.objects.filter(enabled=True)])


@api_view(["POST"])
def model_wake(request: Request, slug: str) -> Response:
    model = get_model(slug)
    if model.is_sagemaker and model.scaling == LLMModel.Scaling.ON_DEMAND:
        request_wake(model)
    else:
        model.touch()
    state, detail = model.public_status()
    return Response({"status": state, "status_detail": detail}, status=status.HTTP_202_ACCEPTED)
