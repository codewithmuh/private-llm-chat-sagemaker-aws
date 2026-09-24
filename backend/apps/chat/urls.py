from django.urls import path

from . import views

urlpatterns = [
    path("conversations/", views.ConversationListView.as_view()),
    path("conversations/<uuid:pk>/", views.ConversationDetailView.as_view()),
    path("conversations/<uuid:pk>/messages/", views.SendMessageView.as_view()),
    path("conversations/<uuid:pk>/regenerate/", views.RegenerateView.as_view()),
    path("messages/<uuid:pk>/stop/", views.StopMessageView.as_view()),
]
