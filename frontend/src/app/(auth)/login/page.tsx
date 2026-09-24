"use client";

import { Suspense, useCallback, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthHeading } from "@/components/auth/AuthShell";
import { GoogleButton } from "@/components/auth/GoogleButton";
import { MfaStep } from "@/components/auth/MfaStep";
import styles from "@/components/auth/auth.module.css";
import { Field } from "@/components/ui/Field";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useFinishLogin } from "@/hooks/useFinishLogin";
import { useRedirectIfSignedIn } from "@/hooks/useRedirectIfSignedIn";
import { api, isApiError } from "@/lib/api";
import { APP_HOME, safeNext } from "@/lib/browser";
import { NO_ERRORS, toFormErrors, type FormErrors } from "@/lib/forms";
import type { LoginResponse, MfaMethod } from "@/lib/types";
import { useConfig } from "@/providers/ConfigProvider";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const { config } = useConfig();
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const [busy, setBusy] = useState(false);
  const [mfaMethods, setMfaMethods] = useState<MfaMethod[] | null>(null);

  const finishLogin = useFinishLogin(next);

  useDocumentTitle("Sign in");
  useRedirectIfSignedIn(next);

  /** Both the password and the Google step answer with a LoginResponse. */
  const handleLogin = useCallback(
    (res: LoginResponse) => {
      if (res.status === "ok") finishLogin();
      else setMfaMethods(res.methods);
    },
    [finishLogin],
  );

  const handleError = useCallback(
    (error: unknown, emailForVerification: string) => {
      // Verification is mandatory and pending: the server just emailed a new code.
      if (isApiError(error) && error.code === "email_not_verified") {
        const query = new URLSearchParams({ email: emailForVerification });
        if (next !== APP_HOME) query.set("next", next);
        router.push(`/verify-email?${query}`);
        return;
      }
      setErrors(toFormErrors(error, ["email", "password"]));
    },
    [router, next],
  );

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setErrors(NO_ERRORS);
    try {
      handleLogin(await api.post<LoginResponse>("/api/auth/login/", { email: email.trim(), password }));
    } catch (error) {
      handleError(error, email.trim());
    } finally {
      setBusy(false);
    }
  };

  const onGoogle = useCallback(
    async (credential: string) => {
      setErrors(NO_ERRORS);
      try {
        handleLogin(await api.post<LoginResponse>("/api/auth/google/", { credential }));
      } catch (error) {
        handleError(error, "");
      }
    },
    [handleLogin, handleError],
  );

  if (mfaMethods) {
    return <MfaStep methods={mfaMethods} onSuccess={finishLogin} onCancel={() => setMfaMethods(null)} />;
  }

  return (
    <>
      <AuthHeading title="Welcome back" subtitle="Sign in to continue" />

      <form className={styles.form} onSubmit={onSubmit} noValidate>
        <Field label="Email" error={errors.fields.email}>
          {(props) => (
            <input
              {...props}
              className="input"
              type="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          )}
        </Field>
        <Field
          label="Password"
          error={errors.fields.password}
          aside={
            <Link href="/forgot-password" className={styles.smallLink}>
              Forgot password?
            </Link>
          }
        >
          {(props) => (
            <input
              {...props}
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          )}
        </Field>

        {errors.message && (
          <div className="alert alert-error" role="alert">
            {errors.message}
          </div>
        )}

        <button type="submit" className="btn btn-primary btn-block" disabled={busy || !email || !password}>
          {busy && <span className="spinner" aria-hidden />} Sign in
        </button>
      </form>

      {config.google_client_id && (
        <>
          <div className={styles.divider}>or</div>
          <GoogleButton clientId={config.google_client_id} onCredential={(c) => void onGoogle(c)} />
        </>
      )}

      {config.signup_enabled && (
        <p className={styles.links}>
          Don&apos;t have an account?{" "}
          <Link href={next === APP_HOME ? "/signup" : `/signup?next=${encodeURIComponent(next)}`} className="link">
            Sign up
          </Link>
        </p>
      )}
    </>
  );
}

export default function LoginPage() {
  // useSearchParams needs a Suspense boundary so the page can be prerendered.
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
