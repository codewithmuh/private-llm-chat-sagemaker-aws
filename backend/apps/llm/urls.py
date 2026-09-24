from django.urls import path

from . import views

urlpatterns = [
    path("", views.model_list),
    path("<slug:slug>/wake/", views.model_wake),
]
