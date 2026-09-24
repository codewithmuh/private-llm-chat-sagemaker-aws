/** Turn an API error into inline field errors + one message for the form. */
import { errorMessage, isApiError } from "./api";

export interface FormErrors {
  /** Errors to show under specific inputs, keyed by field name. */
  fields: Record<string, string>;
  /** An error for the whole form (wrong password, rate limited…). */
  message: string | null;
}

export const NO_ERRORS: FormErrors = { fields: {}, message: null };

/**
 * `knownFields` are the inputs this form shows. Validation errors for other
 * fields (or "non_field_errors") are folded into `message` so nothing is lost.
 */
export function toFormErrors(error: unknown, knownFields: string[]): FormErrors {
  if (!isApiError(error)) return { fields: {}, message: errorMessage(error) };
  const fields: Record<string, string> = {};
  const other: string[] = [];
  for (const [key, value] of Object.entries(error.fields)) {
    if (knownFields.includes(key)) fields[key] = value;
    else other.push(value);
  }
  const hasFieldErrors = Object.keys(fields).length > 0;
  const message = other.length ? other.join(" ") : hasFieldErrors ? null : error.message;
  return { fields, message };
}

/** A rough password strength score from 0 (too short) to 4 (strong). */
export function passwordScore(password: string): 0 | 1 | 2 | 3 | 4 {
  if (password.length < 8) return 0;
  const variety = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  let score = 1;
  if (password.length >= 12) score += 1;
  if (variety >= 2) score += 1;
  if (variety >= 3 || password.length >= 16) score += 1;
  return Math.min(score, 4) as 0 | 1 | 2 | 3 | 4;
}
