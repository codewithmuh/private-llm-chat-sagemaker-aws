"use client";

import type { ReactNode } from "react";
import { LogoMark } from "@/components/ui/Logo";
import { useConfig } from "@/providers/ConfigProvider";
import styles from "./auth.module.css";

/** The centered card every auth page sits in. */
export function AuthShell({ children }: { children: ReactNode }) {
  const { config } = useConfig();
  return (
    <div className={styles.page}>
      <main className={styles.card}>
        <div className={styles.brand}>
          <LogoMark size={40} />
          <span className={styles.brandName}>{config.app_name}</span>
        </div>
        {children}
      </main>
      <p className={styles.footer}>Private by design: your chats and files stay in your own cloud account.</p>
    </div>
  );
}

/** Title + optional subtitle at the top of an auth card. */
export function AuthHeading({ title, subtitle }: { title: string; subtitle?: ReactNode }) {
  return (
    <div className={styles.heading}>
      <h1 className={styles.title}>{title}</h1>
      {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
    </div>
  );
}
