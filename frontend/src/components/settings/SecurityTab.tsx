"use client";

import { useState, type FormEvent } from "react";
import { KeyRound, LifeBuoy, Link2, Mail, Smartphone } from "lucide-react";
import { PasswordStrength } from "@/components/auth/PasswordStrength";
import { Field } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/api";
import { NO_ERRORS, toFormErrors, type FormErrors } from "@/lib/forms";
import { useSession } from "@/providers/SessionProvider";
import { CodePromptDialog } from "./CodePromptDialog";
import { RecoveryCodesDialog } from "./RecoveryCodesDialog";
import { OnOff, Section, SectionBody, SettingRow } from "./Section";
import { TotpSetupDialog } from "./TotpSetupDialog";
import styles from "./settings.module.css";

type DialogName = "totp-setup" | "totp-disable" | "email-enable" | "email-disable" | "recovery";

export function SecurityTab() {
  const { user, refreshUser } = useSession();
  const toast = useToast();
  const [dialog, setDialog] = useState<DialogName | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const { mfa } = user;

  /** After any 2FA change: close the dialog, reload the user, show new codes. */
  const finish = async (message: string, recoveryCodes: string[] = []) => {
    setDialog(null);
    toast.success(message);
    await refreshUser().catch(() => {});
    if (recoveryCodes.length) setCodes(recoveryCodes);
  };

  return (
    <>
      <PasswordSection />

      <Section
        title="Two-factor authentication"
        description="Ask for a second step when signing in, so a stolen password isn't enough."
      >
        <SettingRow
          icon={Smartphone}
          title="Authenticator app"
          status={<OnOff on={mfa.totp} />}
          description="Codes from Google Authenticator, 1Password, Authy…"
          action={
            mfa.totp ? (
              <button type="button" className="btn btn-sm btn-secondary" onClick={() => setDialog("totp-disable")}>
                Disable
              </button>
            ) : (
              <button type="button" className="btn btn-sm btn-primary" onClick={() => setDialog("totp-setup")}>
                Set up
              </button>
            )
          }
        />
        <SettingRow
          icon={Mail}
          title="Email codes"
          status={<OnOff on={mfa.email} />}
          description={`A code sent to ${user.email} each time you sign in.`}
          action={
            mfa.email ? (
              <button type="button" className="btn btn-sm btn-secondary" onClick={() => setDialog("email-disable")}>
                Disable
              </button>
            ) : (
              <button type="button" className="btn btn-sm btn-primary" onClick={() => setDialog("email-enable")}>
                Enable
              </button>
            )
          }
        />
        {mfa.enabled && (
          <SettingRow
            icon={LifeBuoy}
            title="Recovery codes"
            description={`${mfa.recovery_codes_remaining} unused code${mfa.recovery_codes_remaining === 1 ? "" : "s"} left. Each one signs you in once.`}
            action={
              <button type="button" className="btn btn-sm btn-secondary" onClick={() => setDialog("recovery")}>
                Regenerate
              </button>
            }
          />
        )}
      </Section>

      <Section title="Linked accounts">
        <SettingRow
          icon={Link2}
          title="Google"
          status={<span className={`badge ${user.google_linked ? styles.on : ""}`}>{user.google_linked ? "Linked" : "Not linked"}</span>}
          description={
            user.google_linked
              ? "You can sign in with Google."
              : "Sign in with Google once (same email address) to link it."
          }
        />
      </Section>

      <TotpSetupDialog
        open={dialog === "totp-setup"}
        onClose={() => setDialog(null)}
        onEnabled={(recovery) => void finish("Authenticator app turned on.", recovery)}
      />

      <CodePromptDialog
        open={dialog === "totp-disable"}
        onClose={() => setDialog(null)}
        title="Turn off the authenticator app?"
        description="Enter a code from your authenticator app, or one of your recovery codes."
        placeholder="123456 or xxxx-xxxx"
        submitLabel="Turn off"
        danger
        onSubmit={async (code) => {
          await api.post("/api/auth/mfa/totp/disable/", { code });
          await finish("Authenticator app turned off.");
        }}
      />

      <CodePromptDialog
        open={dialog === "email-enable"}
        onClose={() => setDialog(null)}
        title="Turn on email codes"
        description={`Enter the 6-digit code we sent to ${user.email}.`}
        submitLabel="Turn on"
        canEmailCode
        sendOnOpen
        onSubmit={async (code) => {
          const res = await api.post<{ recovery_codes?: string[] }>("/api/auth/mfa/email/confirm/", { code });
          await finish("Email codes turned on.", res.recovery_codes ?? []);
        }}
      />

      <CodePromptDialog
        open={dialog === "email-disable"}
        onClose={() => setDialog(null)}
        title="Turn off email codes?"
        description={`Enter the code we sent to ${user.email}, or one of your recovery codes.`}
        placeholder="123456 or xxxx-xxxx"
        submitLabel="Turn off"
        danger
        canEmailCode
        sendOnOpen
        onSubmit={async (code) => {
          await api.post("/api/auth/mfa/email/disable/", { code });
          await finish("Email codes turned off.");
        }}
      />

      <CodePromptDialog
        open={dialog === "recovery"}
        onClose={() => setDialog(null)}
        title="New recovery codes"
        description={
          mfa.totp
            ? "Enter a code from your authenticator app. Your old recovery codes will stop working."
            : "We'll email you a code. Your old recovery codes will stop working."
        }
        submitLabel="Generate new codes"
        canEmailCode={mfa.email}
        sendOnOpen={!mfa.totp && mfa.email}
        onSubmit={async (code) => {
          const res = await api.post<{ recovery_codes: string[] }>("/api/auth/mfa/recovery-codes/", { code });
          await finish("New recovery codes generated.", res.recovery_codes);
        }}
      />

      <RecoveryCodesDialog codes={codes} onClose={() => setCodes(null)} />
    </>
  );
}

/** Change the password, or set one for accounts created with Google. */
function PasswordSection() {
  const { user, refreshUser } = useSession();
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const [busy, setBusy] = useState(false);

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
      await api.post("/api/auth/password/change/", {
        ...(user.has_password ? { current_password: current } : {}),
        new_password: password,
      });
      toast.success(user.has_password ? "Password changed." : "Password set.");
      setCurrent("");
      setPassword("");
      setConfirm("");
      await refreshUser().catch(() => {});
    } catch (error) {
      setErrors(toFormErrors(error, ["current_password", "new_password"]));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={onSubmit}>
      <Section
        title={user.has_password ? "Password" : "Set a password"}
        description={
          user.has_password
            ? undefined
            : "Your account signs in with Google. Add a password to also sign in with your email address."
        }
      >
        <SectionBody>
          {user.has_password && (
            <Field label="Current password" error={errors.fields.current_password}>
              {(props) => (
                <input
                  {...props}
                  className="input"
                  type="password"
                  autoComplete="current-password"
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                />
              )}
            </Field>
          )}
          <Field label="New password" error={errors.fields.new_password}>
            {(props) => (
              <input
                {...props}
                className="input"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>
          {password && <PasswordStrength password={password} />}
          <Field label="Confirm new password" error={errors.fields.confirm}>
            {(props) => (
              <input
                {...props}
                className="input"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            )}
          </Field>
          {errors.message && (
            <div className="alert alert-error" role="alert">
              {errors.message}
            </div>
          )}
          <div className={styles.actions}>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={busy || !password || !confirm || (user.has_password && !current)}
            >
              {busy && <span className="spinner" aria-hidden />}
              <KeyRound size={15} aria-hidden /> {user.has_password ? "Change password" : "Set password"}
            </button>
          </div>
        </SectionBody>
      </Section>
    </form>
  );
}
