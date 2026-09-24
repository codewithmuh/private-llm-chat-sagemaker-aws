"use client";

import { useEffect, useRef, useState } from "react";
import { loadGoogleIdentity } from "@/lib/google";
import { useTheme } from "@/providers/ThemeProvider";
import styles from "./auth.module.css";

interface GoogleButtonProps {
  clientId: string;
  /** Receives the Google ID token; POST it to /api/auth/google/. */
  onCredential: (credential: string) => void;
  text?: "signin_with" | "signup_with" | "continue_with";
}

/** Google's own "Sign in with Google" button, rendered by their script. */
export function GoogleButton({ clientId, onCredential, text = "signin_with" }: GoogleButtonProps) {
  const container = useRef<HTMLDivElement>(null);
  const { resolved } = useTheme();
  const [failed, setFailed] = useState(false);
  // Google keeps the callback from the first initialize(); route it through
  // a ref so it always calls the latest handler.
  const callback = useRef(onCredential);
  useEffect(() => {
    callback.current = onCredential;
  }, [onCredential]);

  useEffect(() => {
    let cancelled = false;
    loadGoogleIdentity()
      .then((google) => {
        const el = container.current;
        if (cancelled || !el) return;
        google.initialize({
          client_id: clientId,
          callback: (response) => callback.current(response.credential),
          ux_mode: "popup",
        });
        el.replaceChildren(); // re-render cleanly when the theme changes
        google.renderButton(el, {
          type: "standard",
          theme: resolved === "dark" ? "filled_black" : "outline",
          size: "large",
          text,
          shape: "pill",
          logo_alignment: "center",
          width: Math.max(200, Math.min(400, el.offsetWidth)),
        });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, resolved, text]);

  if (failed) {
    return <p className="hint" style={{ textAlign: "center" }}>Google sign-in couldn&apos;t be loaded.</p>;
  }
  return (
    <div className={styles.google}>
      <div ref={container} className={styles.googleButton} />
    </div>
  );
}
