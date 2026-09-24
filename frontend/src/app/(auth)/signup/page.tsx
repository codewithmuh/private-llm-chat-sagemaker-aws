"use client";

import { Suspense, useCallback, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthHeading } from "@/components/auth/AuthShell";
import { GoogleButton } from "@/components/auth/GoogleButton";
import { MfaStep } from "@/components/auth/MfaStep";
import { PasswordStrength } from "@/components/auth/PasswordStrength";
import styles from "@/components/auth/auth.module.css";
import { Field } from "@/components/ui/Field";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useFinishLogin } from "@/hooks/useFinishLogin";
import { useRedirectIfSignedIn } from "@/hooks/useRedirectIfSignedIn";
import { api } from "@/lib/api";
import { safeNext } from "@/lib/browser";
import { NO_ERRORS, toFormErrors, type FormErrors } from "@/lib/forms";
import type { LoginResponse, MfaMethod, SignupResponse } from "@/lib/types";
import { useConfig } from "@/providers/ConfigProvider";

function SignupForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const { config, loaded } = useConfig();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const [busy, setBusy] = useState(false);
  const [mfaMethods, setMfaMethods] = useState<MfaMethod[] | null>(null);

  const finishLogin = useFinishLogin(next);

  useDocumentTitle("Create account");
  useRedirectIfSignedIn(next);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (password.length < 8) {
      setErrors({ fields: { password: "Use at least 8 characters." }, message: null });
      return;
    }
    setBusy(true);
    setErrors(NO_ERRORS);
    try {
      const res = await api.post<SignupResponse>("/api/auth/signup/", {
        email: email.trim(),
        password,
        ...(name.trim() ? { name: name.trim() } : {}),
      });
      if (res.status === "verification_required") {
        const query = new URLSearchParams({ email: res.email || email.trim() });
        if (next !== "/") query.set("next", next);
        router.push(`/verify-email?${query}`);
      } else {
        finishLogin();
      }
    } catch (error) {
      setErrors(toFormErrors(error, ["name", "email", "password"]));
    } finally {
      setBusy(false);
    }
  };

  // Google sign-up is the same call as Google sign-in: the account is created
  // on first use.
  const onGoogle = useCallback(
    async (credential: string) => {
      setErrors(NO_ERRORS);
      try {
        const res = await api.post<LoginResponse>("/api/auth/google/", { credential });
        if (res.status === "ok") finishLogin();
        else setMfaMethods(res.methods);
      } catch (error) {
        setErrors(toFormErrors(error, []));
      }
    },
    [finishLogin],
  );

  if (mfaMethods) {
    return <MfaStep methods={mfaMethods} onSuccess={finishLogin} onCancel={() => setMfaMethods(null)} />;
  }

  if (loaded && !config.signup_enabled) {
    return (
      <>
        <AuthHeading
          title="Sign-up is closed"
          subtitle="New accounts are created by an administrator. Ask them to invite you."
        />
        <Link href="/login" className="btn btn-primary btn-block">
          Back to sign in
        </Link>
      </>
    );
  }

  return (
    <>
      <AuthHeading title="Create your account" subtitle="Chat with private models running on your own GPUs." />

      <form className={styles.form} onSubmit={onSubmit} noValidate>
        <Field label="Name" error={errors.fields.name} hint="Optional">
          {(props) => (
            <input
              {...props}
              className="input"
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>
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
        <Field label="Password" error={errors.fields.password}>
          {(props) => (
            <input
              {...props}
              className="input"
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          )}
        </Field>
        <PasswordStrength password={password} />

        {errors.message && (
          <div className="alert alert-error" role="alert">
            {errors.message}
          </div>
        )}

        <button type="submit" className="btn btn-primary btn-block" disabled={busy || !email || !password}>
          {busy && <span className="spinner" aria-hidden />} Create account
        </button>
      </form>

      {config.google_client_id && (
        <>
          <div className={styles.divider}>or</div>
          <GoogleButton clientId={config.google_client_id} onCredential={(c) => void onGoogle(c)} text="signup_with" />
        </>
      )}

      <p className={styles.links}>
        Already have an account?{" "}
        <Link href={next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`} className="link">
          Sign in
        </Link>
      </p>
    </>
  );
}

export default function SignupPage() {
  return (
    <Suspense>
      <SignupForm />
    </Suspense>
  );
}
