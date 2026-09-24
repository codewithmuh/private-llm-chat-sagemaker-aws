"use client";

/** Opened from the reset email: /reset-password?uid=…&token=… */
import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CircleCheck } from "lucide-react";
import { AuthHeading } from "@/components/auth/AuthShell";
import { PasswordStrength } from "@/components/auth/PasswordStrength";
import styles from "@/components/auth/auth.module.css";
import { Field } from "@/components/ui/Field";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { api } from "@/lib/api";
import { NO_ERRORS, toFormErrors, type FormErrors } from "@/lib/forms";

function ResetPasswordForm() {
  const params = useSearchParams();
  const uid = params.get("uid");
  const token = params.get("token");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useDocumentTitle("Choose a new password");

  if (!uid || !token) {
    return (
      <>
        <AuthHeading
          title="This link is incomplete"
          subtitle="Copy the whole link from the email, or request a new one."
        />
        <Link href="/forgot-password" className="btn btn-primary btn-block">
          Request a new link
        </Link>
      </>
    );
  }

  if (done) {
    return (
      <div className={styles.center}>
        <CircleCheck size={36} aria-hidden style={{ color: "var(--success)" }} />
        <AuthHeading title="Password updated" subtitle="You can now sign in with your new password." />
        <Link href="/login" className="btn btn-primary btn-block">
          Sign in
        </Link>
      </div>
    );
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (password.length < 8) {
      setErrors({ fields: { new_password: "Use at least 8 characters." }, message: null });
      return;
    }
    if (password !== confirm) {
      setErrors({ fields: { confirm: "The passwords don't match." }, message: null });
      return;
    }
    setBusy(true);
    setErrors(NO_ERRORS);
    try {
      await api.post("/api/auth/password/reset/confirm/", { uid, token, new_password: password });
      setDone(true);
    } catch (error) {
      setErrors(toFormErrors(error, ["new_password"]));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <AuthHeading title="Choose a new password" />
      <form className={styles.form} onSubmit={onSubmit} noValidate>
        <Field label="New password" error={errors.fields.new_password}>
          {(props) => (
            <input
              {...props}
              className="input"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          )}
        </Field>
        <PasswordStrength password={password} />
        <Field label="Confirm new password" error={errors.fields.confirm}>
          {(props) => (
            <input
              {...props}
              className="input"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
            />
          )}
        </Field>
        {errors.message && (
          <div className="alert alert-error" role="alert">
            {errors.message}{" "}
            <Link href="/forgot-password" className="link">
              Request a new link
            </Link>
          </div>
        )}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy || !password || !confirm}>
          {busy && <span className="spinner" aria-hidden />} Update password
        </button>
      </form>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
