"use client";

/**
 * "Enter a code to continue" dialog, used for the two-factor actions that
 * need proof it's really you: turning email codes on/off, turning the
 * authenticator app off, and regenerating recovery codes.
 */
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { useCooldown } from "@/hooks/useCooldown";
import { api, errorMessage } from "@/lib/api";
import styles from "./settings.module.css";

interface CodePromptDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description: ReactNode;
  submitLabel: string;
  danger?: boolean;
  placeholder?: string;
  /** Offer "Email me a code" (POST /api/auth/mfa/email/send/). */
  canEmailCode?: boolean;
  /** Send the email code as soon as the dialog opens. */
  sendOnOpen?: boolean;
  /** Do the action. Throw (ApiError) to show the error in the dialog. */
  onSubmit: (code: string) => Promise<void>;
}

export function CodePromptDialog(props: CodePromptDialogProps) {
  return (
    <Dialog open={props.open} onClose={props.onClose} title={props.title} size="sm">
      <CodePromptBody {...props} />
    </Dialog>
  );
}

function CodePromptBody({
  onClose,
  description,
  submitLabel,
  danger,
  placeholder = "123456",
  canEmailCode,
  sendOnOpen,
  onSubmit,
}: CodePromptDialogProps) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [cooldown, startCooldown] = useCooldown(30);
  const sentOnOpen = useRef(false);

  const sendEmail = async () => {
    setSending(true);
    setError(null);
    try {
      await api.post("/api/auth/mfa/email/send/");
      setNotice("We emailed you a 6-digit code.");
      startCooldown();
    } catch (err) {
      setError(errorMessage(err, "Couldn't send the code."));
    } finally {
      setSending(false);
    }
  };

  useEffect(() => {
    // The ref guard stops React's development double-run from sending two emails.
    if (!sendOnOpen || sentOnOpen.current) return;
    sentOnOpen.current = true;
    api
      .post("/api/auth/mfa/email/send/")
      .then(() => {
        setNotice("We emailed you a 6-digit code.");
        startCooldown();
      })
      .catch((err: unknown) => setError(errorMessage(err, "Couldn't send the code.")));
  }, [sendOnOpen, startCooldown]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(code.trim());
    } catch (err) {
      setError(errorMessage(err, "That code didn't work."));
      setBusy(false);
    }
  };

  return (
    <form className={styles.stack} onSubmit={submit}>
      <p className="muted" style={{ fontSize: 14 }}>
        {description}
      </p>
      <input
        className="input mono"
        value={code}
        onChange={(event) => setCode(event.target.value)}
        placeholder={placeholder}
        aria-label="Code"
        autoComplete="one-time-code"
        autoCapitalize="none"
        spellCheck={false}
        aria-invalid={error ? true : undefined}
      />
      {canEmailCode && (
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          style={{ alignSelf: "flex-start" }}
          onClick={() => void sendEmail()}
          disabled={sending || cooldown > 0}
        >
          {sending && <span className="spinner" aria-hidden />}
          {cooldown > 0 ? `Resend email code in ${cooldown}s` : notice ? "Resend email code" : "Email me a code"}
        </button>
      )}
      {notice && !error && (
        <div className="alert alert-info" role="status">
          {notice}
        </div>
      )}
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
      <div className={styles.actions} style={{ paddingBottom: 16 }}>
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          type="submit"
          className={`btn ${danger ? "btn-danger" : "btn-primary"}`}
          disabled={busy || !code.trim()}
        >
          {busy && <span className="spinner" aria-hidden />} {submitLabel}
        </button>
      </div>
    </form>
  );
}
