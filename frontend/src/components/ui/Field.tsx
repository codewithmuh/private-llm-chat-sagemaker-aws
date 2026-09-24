"use client";

/**
 * A labelled form field with an optional hint and error message, wired up
 * for screen readers (aria-invalid, aria-describedby).
 *
 *   <Field label="Email" error={errors.email}>
 *     {(props) => <input {...props} className="input" type="email" />}
 *   </Field>
 */
import { useId, type ReactNode } from "react";

export interface FieldControlProps {
  id: string;
  "aria-invalid": boolean | undefined;
  "aria-describedby": string | undefined;
}

interface FieldProps {
  label: ReactNode;
  error?: string | null;
  hint?: ReactNode;
  /** Something next to the label, e.g. a "Forgot password?" link. */
  aside?: ReactNode;
  children: (props: FieldControlProps) => ReactNode;
}

export function Field({ label, error, hint, aside, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className="field">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <label className="label" htmlFor={id}>
          {label}
        </label>
        {aside}
      </div>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy })}
      {hint && !error && (
        <div id={hintId} className="hint">
          {hint}
        </div>
      )}
      {error && (
        <div id={errorId} className="field-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
