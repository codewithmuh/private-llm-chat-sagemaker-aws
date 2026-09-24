from django.urls import path

from . import views

urlpatterns = [
    path("csrf/", views.CsrfView.as_view()),
    path("signup/", views.SignupView.as_view()),
    path("verify-email/", views.VerifyEmailView.as_view()),
    path("verify-email/resend/", views.ResendVerificationView.as_view()),
    path("login/", views.LoginView.as_view()),
    path("login/mfa/", views.MfaLoginView.as_view()),
    path("login/mfa/email/", views.MfaLoginEmailView.as_view()),
    path("google/", views.GoogleLoginView.as_view()),
    path("logout/", views.LogoutView.as_view()),
    path("me/", views.MeView.as_view()),
    path("password/change/", views.PasswordChangeView.as_view()),
    path("password/reset/", views.PasswordResetView.as_view()),
    path("password/reset/confirm/", views.PasswordResetConfirmView.as_view()),
    path("mfa/", views.MfaStatusView.as_view()),
    path("mfa/totp/setup/", views.TotpSetupView.as_view()),
    path("mfa/totp/confirm/", views.TotpConfirmView.as_view()),
    path("mfa/totp/disable/", views.TotpDisableView.as_view()),
    path("mfa/email/send/", views.EmailMfaSendView.as_view()),
    path("mfa/email/confirm/", views.EmailMfaConfirmView.as_view()),
    path("mfa/email/disable/", views.EmailMfaDisableView.as_view()),
    path("mfa/recovery-codes/", views.RecoveryCodesView.as_view()),
]
