"""Top-level URL map. Every API route lives under /api/."""

from django.conf import settings
from django.contrib import admin
from django.urls import include, path

from apps.common.views import config_view

urlpatterns = [
    # /api/health/ is answered by HealthCheckMiddleware before routing.
    path("api/config/", config_view, name="config"),
    path("api/auth/", include("apps.accounts.urls")),
    path("api/models/", include("apps.llm.urls")),
    path("api/files/", include("apps.files.urls")),
    path("api/", include("apps.chat.urls")),
]

if settings.ENABLE_ADMIN:
    admin.site.site_header = f"{settings.APP_NAME} admin"
    admin.site.site_title = settings.APP_NAME
    admin.site.index_title = "Users, models and conversations"
    urlpatterns += [path("admin/", admin.site.urls)]
