"use client";

/**
 * Authenticator app (TOTP) setup:
 *   1. POST mfa/totp/setup/   -> a secret + QR code (nothing enabled yet)
 *   2. the user scans it and types the 6-digit code their app shows
 *   3. POST mfa/totp/confirm/ -> enabled (+ recovery codes if it's the first method)
 */
import { useEffect, useState, type FormEvent } from "react";
import { Check, Copy } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { OtpInput } from "@/components/ui/OtpInput";
import { useCopy } from "@/hooks/useCopy";
import { api, errorMessage } from "@/lib/api";
import type { TotpSetup } from "@/lib/types";
import styles from "./settings.module.css";

interface TotpSetupDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called once TOTP is on, with any recovery codes to show. */
  onEnabled: (recoveryCodes: string[]) => void;
}

export function TotpSetupDialog({ open, onClose, onEnabled }: TotpSetupDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title="Set up an authenticator app" size="lg">
      <TotpSetupBody onCancel={onClose} onEnabled={onEnabled} />
    </Dialog>
  );
}

function TotpSetupBody({ onCancel, onEnabled }: { onCancel: () => void; onEnabled: (codes: string[]) => void }) {
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, copy] = useCopy();

  useEffect(() => {
    let cancelled = false;
    api
      .post<TotpSetup>("/api/auth/mfa/totp/setup/")
      .then((result) => !cancelled && setSetup(result))
      .catch((err: unknown) => !cancelled && setLoadError(errorMessage(err, "Couldn't start the setup.")));
    return () => {
      cancelled = true;
    };
  }, []);

  const confirm = async (value: string) => {
    if (busy || !/^\d{6}$/.test(value)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ status: string; recovery_codes?: string[] }>("/api/auth/mfa/totp/confirm/", {
        code: value,
      });
      onEnabled(res.recovery_codes ?? []);
    } catch (err) {
      setCode("");
      setError(errorMessage(err, "That code didn't work. Check your phone's clock and try again."));
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void confirm(code);
  };

  if (loadError) {
    return (
      <div className="alert alert-error" role="alert" style={{ marginBottom: 16 }}>
        {loadError}
      </div>
    );
  }

  if (!setup) {
    return (
      <div style={{ display: "grid", placeItems: "center", padding: 40 }}>
        <span className="spinner spinner-lg" aria-label="Loading" />
      </div>
    );
  }

  // The QR code is an SVG string from our API. We show it as an <img> data URL
  // (never innerHTML), so any markup in it can't run in our page.
  const qrSrc = `data:image/svg+xml;utf8,${encodeURIComponent(setup.qr_svg)}`;
  const groupedSecret = setup.secret.match(/.{1,4}/g)?.join(" ") ?? setup.secret;

  return (
    <form className={styles.steps} onSubmit={onSubmit}>
      <div className={styles.qrWrap}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={styles.qr} src={qrSrc} alt="QR code to scan with your authenticator app" />
        <div className={styles.step}>
          <p>
            <strong>1. Scan this QR code</strong> with an authenticator app such as Google Authenticator, 1Password,
            Authy or Microsoft Authenticator.
          </p>
          <p style={{ marginTop: 10 }}>Can&apos;t scan it? Enter this key manually:</p>
          <div className={styles.secret}>
            <span>{groupedSecret}</span>
            <button
              type="button"
              className="icon-btn icon-btn-sm"
              onClick={() => void copy(setup.secret)}
              aria-label="Copy setup key"
            >
              {copied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
            </button>
          </div>
          <p style={{ marginTop: 8 }}>
            <a href={setup.otpauth_url} className="link">
              Open in an authenticator app on this device
            </a>
          </p>
        </div>
      </div>

      <div className={styles.stack}>
        <p className={styles.step}>
          <strong>2. Enter the 6-digit code</strong> the app shows.
        </p>
        <OtpInput
          value={code}
          onChange={setCode}
          onComplete={(v) => void confirm(v)}
          disabled={busy}
          invalid={!!error}
          label="Authenticator code"
        />
        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}
      </div>

      <div className={styles.actions} style={{ paddingBottom: 16 }}>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy || !/^\d{6}$/.test(code)}>
          {busy && <span className="spinner" aria-hidden />} Turn on
        </button>
      </div>
    </form>
  );
}
