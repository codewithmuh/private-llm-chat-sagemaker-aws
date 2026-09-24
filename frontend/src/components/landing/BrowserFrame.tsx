import type { ReactNode } from "react";
import styles from "./landing.module.css";

/** A screenshot inside a simple browser window. */
export function BrowserFrame({ url, children, small }: { url: string; children: ReactNode; small?: boolean }) {
  return (
    <div className={`${styles.frame} ${small ? styles.frameSmall : ""}`}>
      <div className={styles.frameBar} aria-hidden>
        <span className={styles.frameDot} />
        <span className={styles.frameDot} />
        <span className={styles.frameDot} />
        <span className={styles.frameUrl}>{url}</span>
      </div>
      {children}
    </div>
  );
}
