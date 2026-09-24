import { passwordScore } from "@/lib/forms";
import styles from "./auth.module.css";

const LABELS = ["At least 8 characters", "Weak", "Okay", "Good", "Strong"];

/** A 4-segment strength meter under a new-password field. */
export function PasswordStrength({ password }: { password: string }) {
  const score = passwordScore(password);
  return (
    <div className={styles.strength} data-score={score} aria-live="polite">
      <div className={styles.bars} aria-hidden>
        {[1, 2, 3, 4].map((n) => (
          <span key={n} className={styles.bar} data-on={score >= n || undefined} />
        ))}
      </div>
      <span>{password ? LABELS[score] : LABELS[0]}</span>
    </div>
  );
}
