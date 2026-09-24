from django.urls import path

from . import views

urlpatterns = [
    path("", views.UploadView.as_view()),
    path("<uuid:pk>/", views.AttachmentView.as_view()),
    path("<uuid:pk>/content/", views.ContentView.as_view()),
    path("<uuid:pk>/text/", views.TextView.as_view()),
    path("<uuid:pk>/ocr/", views.OcrView.as_view()),
]
