import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import styles from "./settings.module.css";

/** A bordered card with a title, used to group settings. */
export function Section({
  title,
  description,
  children,
  danger,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  danger?: boolean;
}) {
  return (
    <section className={`${styles.section} ${danger ? styles.dangerSection : ""}`} aria-label={title}>
      <header className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>{title}</h2>
        {description && <p className={styles.sectionDescription}>{description}</p>}
      </header>
      {children}
    </section>
  );
}

export function SectionBody({ children }: { children: ReactNode }) {
  return <div className={styles.sectionBody}>{children}</div>;
}

/** One line inside a section: icon, title + description, and an action. */
export function SettingRow({
  icon: Icon,
  title,
  status,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  status?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={styles.row}>
      <span className={styles.rowIcon}>
        <Icon size={18} aria-hidden />
      </span>
      <div className={styles.rowText}>
        <div className={styles.rowTitle}>
          {title} {status}
        </div>
        {description && <div className={styles.rowDescription}>{description}</div>}
      </div>
      {action}
    </div>
  );
}

export function OnOff({ on }: { on: boolean }) {
  return <span className={`badge ${on ? styles.on : ""}`}>{on ? "On" : "Off"}</span>;
}
