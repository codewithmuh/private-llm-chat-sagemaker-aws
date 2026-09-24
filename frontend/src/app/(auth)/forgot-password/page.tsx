"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { MailCheck } from "lucide-react";
import { AuthHeading } from "@/components/auth/AuthShell";
import styles from "@/components/auth/auth.module.css";
import { Field } from "@/components/ui/Field";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { api } from "@/lib/api";
import { NO_ERRORS, toFormErrors, type FormErrors } from "@/lib/forms";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  useDocumentTitle("Reset password");

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setErrors(NO_ERRORS);
    try {
      // Always "sent", whether or not the account exists (no account enumeration).
      await api.post("/api/auth/password/reset/", { email: email.trim() });
      setSent(true);
    } catch (error) {
      setErrors(toFormErrors(error, ["email"]));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className={styles.center}>
        <MailCheck size={36} aria-hidden style={{ color: "var(--accent)" }} />
        <AuthHeading
          title="Check your email"
          subtitle={
            <>
              If an account exists for <strong>{email.trim()}</strong>, we emailed a link to reset your password.
            </>
          }
        />
        <Link href="/login" className="btn btn-primary btn-block">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <>
      <AuthHeading title="Forgot your password?" subtitle="Enter your email and we'll send you a reset link." />
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
        {errors.message && (
          <div className="alert alert-error" role="alert">
            {errors.message}
          </div>
        )}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy || !email.trim()}>
          {busy && <span className="spinner" aria-hidden />} Send reset link
        </button>
      </form>
      <p className={styles.links}>
        <Link href="/login" className="link">
          Back to sign in
        </Link>
      </p>
    </>
  );
}
