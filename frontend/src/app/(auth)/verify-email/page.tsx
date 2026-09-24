"use client";

/**
 * Email verification: the user types (or pastes) the 6-digit code we
 * emailed. A correct code also signs them in.
 */
import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthHeading } from "@/components/auth/AuthShell";
import { MfaStep } from "@/components/auth/MfaStep";
import styles from "@/components/auth/auth.module.css";
import { Field } from "@/components/ui/Field";
import { OtpInput } from "@/components/ui/OtpInput";
import { useCooldown } from "@/hooks/useCooldown";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useFinishLogin } from "@/hooks/useFinishLogin";
import { api, errorMessage } from "@/lib/api";
import { safeNext } from "@/lib/browser";
import type { LoginResponse, MfaMethod } from "@/lib/types";

function VerifyEmailForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const emailFromLink = params.get("email") ?? "";
  const [email, setEmail] = useState(emailFromLink);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mfaMethods, setMfaMethods] = useState<MfaMethod[] | null>(null);
  // A code was emailed just before we got here, so start with a cooldown.
  const [cooldown, startCooldown] = useCooldown(30, Boolean(emailFromLink));

  const finishLogin = useFinishLogin(next);

  useDocumentTitle("Verify your email");

  const verify = async (value: string) => {
    if (busy || !/^\d{6}$/.test(value) || !email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<LoginResponse>("/api/auth/verify-email/", { email: email.trim(), code: value });
      if (res.status === "ok") finishLogin();
      else setMfaMethods(res.methods);
    } catch (err) {
      setCode("");
      setError(errorMessage(err, "That code didn't work."));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (!email.trim()) {
      setError("Enter your email address first.");
      return;
    }
    setError(null);
    try {
      await api.post("/api/auth/verify-email/resend/", { email: email.trim() });
      setNotice("If that address needs verifying, a new code is on its way.");
      startCooldown();
    } catch (err) {
      setError(errorMessage(err, "Couldn't send a new code."));
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void verify(code);
  };

  if (mfaMethods) {
    return <MfaStep methods={mfaMethods} onSuccess={finishLogin} onCancel={() => router.replace("/login")} />;
  }

  return (
    <>
      <AuthHeading
        title="Check your email"
        subtitle={
          emailFromLink ? (
            <>
              We sent a 6-digit code to <strong>{emailFromLink}</strong>. It&apos;s valid for 15 minutes.
            </>
          ) : (
            "Enter your email and the 6-digit code we sent you."
          )
        }
      />

      <form className={styles.form} onSubmit={onSubmit}>
        {!emailFromLink && (
          <Field label="Email">
            {(props) => (
              <input
                {...props}
                className="input"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            )}
          </Field>
        )}

        <OtpInput
          value={code}
          onChange={setCode}
          onComplete={(value) => void verify(value)}
          autoFocus={Boolean(emailFromLink)}
          disabled={busy}
          invalid={!!error}
          label="Verification code"
        />

        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}
        {notice && !error && (
          <div className="alert alert-info" role="status">
            {notice}
          </div>
        )}

        <button type="submit" className="btn btn-primary btn-block" disabled={busy || !/^\d{6}$/.test(code)}>
          {busy && <span className="spinner" aria-hidden />} Verify email
        </button>

        <div className={styles.resend}>
          Didn&apos;t get it?&nbsp;
          <button type="button" className={styles.textButton} onClick={() => void resend()} disabled={cooldown > 0}>
            {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
          </button>
        </div>
      </form>

      <p className={styles.links}>
        <Link href="/login" className="link">
          Back to sign in
        </Link>
      </p>
    </>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmailForm />
    </Suspense>
  );
}
