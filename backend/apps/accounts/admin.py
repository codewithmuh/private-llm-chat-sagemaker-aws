from django import forms
from django.conf import settings
from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.contrib.auth.forms import UserChangeForm, UserCreationForm
from django.shortcuts import redirect
from django.urls import reverse

from .models import User


class UserCreateForm(UserCreationForm):
    class Meta:
        model = User
        fields = ("email", "name")


class UserEditForm(UserChangeForm):
    # Declared explicitly to opt in to Django 6's https:// default now.
    avatar_url = forms.URLField(required=False, max_length=500, assume_scheme="https")

    class Meta:
        model = User
        fields = "__all__"


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    add_form = UserCreateForm
    form = UserEditForm
    ordering = ("-date_joined",)
    list_display = ("email", "name", "email_verified", "mfa_enabled", "is_staff", "is_active", "date_joined")
    list_filter = ("is_staff", "is_active", "email_verified", "mfa_email_enabled")
    search_fields = ("email", "name")
    readonly_fields = ("date_joined", "last_login", "google_sub")
    fieldsets = (
        (None, {"fields": ("email", "password")}),
        ("Profile", {"fields": ("name", "avatar_url", "email_verified", "google_sub")}),
        ("Preferences", {"fields": ("default_model", "theme", "custom_instructions")}),
        ("Two-factor", {"fields": ("mfa_email_enabled",)}),
        ("Permissions", {"fields": ("is_active", "is_staff", "is_superuser", "groups", "user_permissions")}),
        ("Dates", {"fields": ("last_login", "date_joined")}),
    )
    add_fieldsets = ((None, {"classes": ("wide",), "fields": ("email", "name", "password1", "password2")}),)

    @admin.display(boolean=True, description="2FA")
    def mfa_enabled(self, obj: User) -> bool:
        return obj.mfa_enabled


def app_login(request, extra_context=None):
    """Admin login goes through the app's login page.

    Django admin's own form checks only the password, which would let anyone
    with a stolen password skip two-factor authentication. So /admin/login/
    sends people to the web app to log in (password + 2FA), then back here.
    """
    if request.user.is_authenticated and request.user.is_staff:
        return redirect(request.GET.get("next") or reverse("admin:index"))
    return redirect(f"{settings.PUBLIC_URL}/login?next=/admin/")


admin.site.login = app_login
