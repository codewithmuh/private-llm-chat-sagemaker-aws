"""File endpoints (docs/api.md, "Files")."""

from __future__ import annotations

import logging

from django.conf import settings
from django.core.files.base import ContentFile
from django.http import FileResponse, HttpResponseRedirect
from django.shortcuts import get_object_or_404
from rest_framework import serializers, status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.common.errors import ApiError
from apps.common.throttles import OcrThrottle, UploadThrottle

from .extract import UnsupportedFile, inspect_file
from .models import Attachment
from .ocr import run_ocr

log = logging.getLogger(__name__)

# Only these are ever shown inline in the browser. Anything else (HTML, SVG,
# text) is served as a download: rendering a user's HTML on our own origin
# would be a stored-XSS hole.
INLINE_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"}


def _own(request: Request, pk) -> Attachment:
    return get_object_or_404(Attachment, pk=pk, user=request.user)


class UploadView(APIView):
    throttle_classes = [UploadThrottle]

    def post(self, request: Request) -> Response:
        upload = request.FILES.get("file")
        if upload is None:
            raise ApiError("Attach a file in the 'file' field.", code="invalid", fields={"file": "No file."})
        limit = settings.MAX_UPLOAD_MB * 1024 * 1024
        if upload.size > limit:
            raise ApiError(f"Files can be up to {settings.MAX_UPLOAD_MB} MB.", code="file_too_large", status_code=413)
        data = upload.read()
        try:
            info = inspect_file(upload.name, data)
        except UnsupportedFile as exc:
            raise ApiError(str(exc), code="unsupported_file_type", status_code=415) from None

        attachment = Attachment(
            user=request.user,
            filename=(upload.name or "file")[:255],
            content_type=info.content_type,
            size=len(data),
            kind=info.kind,
            page_count=info.page_count,
            width=info.width,
            height=info.height,
            text=info.text,
            text_source=Attachment.TextSource.EXTRACTED if info.text.strip() else "",
            status=Attachment.Status.ERROR if info.error else Attachment.Status.READY,
            error=info.error,
        )
        attachment.file.save(upload.name or "file", ContentFile(data), save=False)
        attachment.save()
        log.info(
            "file uploaded",
            extra={"attachment_id": str(attachment.id), "kind": attachment.kind, "bytes": attachment.size},
        )
        return Response(attachment.as_api(), status=status.HTTP_201_CREATED)


class AttachmentView(APIView):
    def get(self, request: Request, pk) -> Response:
        return Response(_own(request, pk).as_api())

    def delete(self, request: Request, pk) -> Response:
        _own(request, pk).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ContentView(APIView):
    def get(self, request: Request, pk):
        attachment = _own(request, pk)
        inline = attachment.content_type in INLINE_TYPES
        disposition = "inline" if inline else "attachment"
        if settings.STORAGE_BACKEND == "s3":
            # A presigned S3 link that expires in a few minutes. The browser
            # downloads straight from S3; the bucket itself stays private.
            url = attachment.file.storage.url(
                attachment.file.name,
                parameters={
                    "ResponseContentType": attachment.content_type if inline else "application/octet-stream",
                    "ResponseContentDisposition": f'{disposition}; filename="{_ascii(attachment.filename)}"',
                },
            )
            return HttpResponseRedirect(url)
        response = FileResponse(
            attachment.file.open("rb"),
            content_type=attachment.content_type if inline else "application/octet-stream",
            as_attachment=not inline,
            filename=attachment.filename,
        )
        response["Cache-Control"] = "private, max-age=300"
        return response


class TextView(APIView):
    def get(self, request: Request, pk) -> Response:
        attachment = _own(request, pk)
        return Response({"text": attachment.text, "source": attachment.text_source or None})


class OcrInput(serializers.Serializer):
    model = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    force = serializers.BooleanField(required=False, default=False)


class OcrView(APIView):
    throttle_classes = [OcrThrottle]

    def post(self, request: Request, pk) -> Response:
        attachment = _own(request, pk)
        params = OcrInput(data=request.data)
        params.is_valid(raise_exception=True)
        result = run_ocr(
            attachment, model_slug=params.validated_data.get("model") or None, force=params.validated_data["force"]
        )
        return Response(
            {
                "text": result.text,
                "engine": result.engine,
                "duration_ms": result.duration_ms,
                "attachment": attachment.as_api(),
            }
        )


def _ascii(name: str) -> str:
    return "".join(c if 32 <= ord(c) < 127 and c not in '"\\' else "_" for c in name)
