from django.urls import path

from . import views

urlpatterns = [
    path("transcribe/", views.TranscribeView.as_view()),
]
