"use client";

/**
 * The second login step for accounts with two-factor authentication.
 *
 * After the password (or Google) step the server answers
 * {"status": "mfa_required", "methods": [...]} and holds a pending login for
 * 10 minutes. We finish it with POST /api/auth/login/mfa/ {method, code}.
 */
import { useState, type FormEvent } from "react";
import { Tabs } from "@/components/ui/Tabs";
import { OtpInput } from "@/components/ui/OtpInput";
import { useCooldown } from "@/hooks/useCooldown";
import { api, errorMessage, isApiError } from "@/lib/api";
import type { MfaMethod, User } from "@/lib/types";
import { AuthHeading } from "./AuthShell";
import styles from "./auth.module.css";

const LABELS: Record<MfaMethod, string> = {
  totp: "Authenticator",
  email: "Email code",
  recovery: "Recovery code",
};

const ORDER: MfaMethod[] = ["totp", "email", "recovery"];

interface MfaStepProps {
  methods: MfaMethod[];
  onSuccess: (user: User) => void;
  /** Go back to the password step (e.g. the pending login expired). */
  onCancel: () => void;
}

export function MfaStep({ methods, onSuccess, onCancel }: MfaStepProps) {
  const available = ORDER.filter((m) => methods.includes(m));
  const [method, setMethod] = useState<MfaMethod>(available[0] ?? "totp");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [cooldown, startCooldown] = useCooldown(30);

  const verify = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ status: "ok"; user: User }>("/api/auth/login/mfa/", { method, code: trimmed });
      onSuccess(res.user);
    } catch (err) {
      setCode("");
      if (isApiError(err) && (err.code === "invalid_code" || err.code === "expired_code" || err.code === "invalid")) {
        setError(err.message || "That code didn't work. Try again.");
      } else {
        // Most likely the 10-minute pending login expired.
        setError(errorMessage(err));
        setExpired(isApiError(err) && (err.status === 401 || err.status === 400));
      }
    } finally {
      setBusy(false);
    }
  };

  const sendEmailCode = async () => {
    setSending(true);
    setError(null);
    try {
      await api.post("/api/auth/login/mfa/email/");
      setEmailSent(true);
      startCooldown();
    } catch (err) {
      setError(errorMessage(err, "Couldn't send the code."));
    } finally {
      setSending(false);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void verify(code);
  };

  const switchTo = (next: MfaMethod) => {
    setMethod(next);
    setCode("");
    setError(null);
  };

  return (
    <div>
      <AuthHeading title="Two-factor authentication" subtitle="One more step to confirm it's you." />

      {available.length > 1 && (
        <div style={{ marginBottom: 18 }}>
          <Tabs
            label="Verification method"
            tabs={available.map((m) => ({ id: m, label: LABELS[m] }))}
            active={method}
            onChange={switchTo}
            fill
          />
        </div>
      )}

      <form className={styles.form} onSubmit={onSubmit}>
        {method === "totp" && (
          <>
            <p className="muted" style={{ fontSize: 14, textAlign: "center" }}>
              Enter the 6-digit code from your authenticator app.
            </p>
            <OtpInput
              value={code}
              onChange={setCode}
              onComplete={(v) => void verify(v)}
              autoFocus
              disabled={busy}
              invalid={!!error}
              label="Authenticator code"
            />
          </>
        )}

        {method === "email" && (
          <>
            {!emailSent ? (
              <>
                <p className="muted" style={{ fontSize: 14, textAlign: "center" }}>
                  We&apos;ll email a 6-digit code to your account&apos;s address.
                </p>
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  onClick={() => void sendEmailCode()}
                  disabled={sending}
                >
                  {sending && <span className="spinner" aria-hidden />} Send code
                </button>
              </>
            ) : (
              <>
                <p className="muted" style={{ fontSize: 14, textAlign: "center" }}>
                  Enter the 6-digit code we emailed you.
                </p>
                <OtpInput
                  value={code}
                  onChange={setCode}
                  onComplete={(v) => void verify(v)}
                  autoFocus
                  disabled={busy}
                  invalid={!!error}
                  label="Email code"
                />
                <div className={styles.resend}>
                  <button
                    type="button"
                    className={styles.textButton}
                    onClick={() => void sendEmailCode()}
                    disabled={cooldown > 0 || sending}
                  >
                    {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {method === "recovery" && (
          <>
            <p className="muted" style={{ fontSize: 14, textAlign: "center" }}>
              Enter one of the recovery codes you saved when you set up two-factor authentication. Each code works once.
            </p>
            <input
              className="input mono"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="xxxx-xxxx"
              aria-label="Recovery code"
              autoComplete="one-time-code"
              autoCapitalize="none"
              spellCheck={false}
              disabled={busy}
              aria-invalid={error ? true : undefined}
            />
          </>
        )}

        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}

        {(method !== "email" || emailSent) && (
          <button type="submit" className="btn btn-primary btn-block" disabled={busy || !code.trim()}>
            {busy && <span className="spinner" aria-hidden />} Verify
          </button>
        )}
      </form>

      <p className={styles.links}>
        <button type="button" className={styles.textButton} onClick={onCancel}>
          {expired ? "Start over" : "Back to sign in"}
        </button>
      </p>
    </div>
  );
}
