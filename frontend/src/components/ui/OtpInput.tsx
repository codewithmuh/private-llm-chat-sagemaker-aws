"use client";

/**
 * A row of single-digit boxes for one-time codes ("123456").
 *
 * - Typing moves to the next box, Backspace on an empty box goes back.
 * - Pasting (or iOS/Android SMS autofill) of a whole code fills every box.
 * - `onComplete` fires once all boxes are filled, so forms can auto-submit.
 */
import { useRef, type ClipboardEvent, type KeyboardEvent } from "react";
import styles from "./OtpInput.module.css";

interface OtpInputProps {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  length?: number;
  disabled?: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
  /** Accessible name for the group, e.g. "Verification code". */
  label?: string;
}

export function OtpInput({
  value,
  onChange,
  onComplete,
  length = 6,
  disabled,
  invalid,
  autoFocus,
  label = "One-time code",
}: OtpInputProps) {
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  // `value` keeps a space for an empty box in the middle ("12 456"), so the
  // other digits stay in place. A complete code is always six digits.
  const digits = Array.from({ length }, (_, i) => (value[i] ?? "").trim());
  const emit = (next: string[]) => onChange(next.map((d) => d || " ").join("").trimEnd());

  const focusBox = (index: number) => {
    const box = inputs.current[Math.max(0, Math.min(index, length - 1))];
    box?.focus();
    box?.select();
  };

  // Write `text` into the boxes starting at `start`.
  const fill = (start: number, text: string) => {
    const clean = text.replace(/\D/g, "");
    if (!clean) return;
    const next = digits.slice();
    for (let i = 0; i < clean.length && start + i < length; i += 1) next[start + i] = clean[i];
    emit(next);
    focusBox(start + clean.length);
    if (next.every((d) => d !== "")) onComplete?.(next.join(""));
  };

  const onKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Backspace") {
      event.preventDefault();
      const next = digits.slice();
      if (next[index]) {
        next[index] = "";
      } else if (index > 0) {
        next[index - 1] = "";
        focusBox(index - 1);
      }
      emit(next);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      focusBox(index - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      focusBox(index + 1);
    }
  };

  const onPaste = (index: number, event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    fill(index, event.clipboardData.getData("text"));
  };

  return (
    <div className={styles.group} role="group" aria-label={label}>
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(el) => {
            inputs.current[index] = el;
          }}
          className={styles.box}
          value={digit}
          inputMode="numeric"
          pattern="[0-9]*"
          // Lets phones offer the code from an SMS/email in the first box.
          autoComplete={index === 0 ? "one-time-code" : "off"}
          autoFocus={autoFocus && index === 0}
          maxLength={length} // allows autofill of the whole code into one box
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-label={`Digit ${index + 1} of ${length}`}
          onChange={(event) => {
            const raw = event.target.value;
            if (raw === "") {
              // Some mobile keyboards delete without a Backspace keydown.
              const next = digits.slice();
              next[index] = "";
              emit(next);
              return;
            }
            // A single typed digit next to the old one: keep only the new one.
            // A whole code (autofill): use all of it.
            fill(index, raw.length > 1 && raw.length < length ? raw.replace(digit, "") : raw);
          }}
          onKeyDown={(event) => onKeyDown(index, event)}
          onPaste={(event) => onPaste(index, event)}
          onFocus={(event) => event.target.select()}
        />
      ))}
    </div>
  );
}
