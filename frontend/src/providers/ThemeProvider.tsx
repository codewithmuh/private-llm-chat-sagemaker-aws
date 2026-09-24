"use client";

/**
 * Theme state for React components. The source of truth is outside React
 * (localStorage + <html data-theme>, set before paint by the inline script in
 * layout.tsx), so we read it with useSyncExternalStore.
 */
import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { applyTheme, readStoredTheme } from "@/lib/theme";
import type { ThemePreference } from "@/lib/types";

interface ThemeValue {
  /** What the user picked. */
  theme: ThemePreference;
  /** What is actually shown right now. */
  resolved: "light" | "dark";
  setTheme: (theme: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);
const CHANGE_EVENT = "llmchat:theme-change";

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  // Follow the operating system while the preference is "system".
  const onSystemChange = () => {
    if (readStoredTheme() === "system") applyTheme("system");
    onChange();
  };
  media.addEventListener("change", onSystemChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onSystemChange); // another tab changed it
  return () => {
    media.removeEventListener("change", onSystemChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onSystemChange);
  };
}

// Snapshots must be primitives (or cached objects), so encode both values.
const getSnapshot = () =>
  `${readStoredTheme()}|${document.documentElement.dataset.theme === "dark" ? "dark" : "light"}`;
const getServerSnapshot = () => "system|light";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [theme, resolved] = snapshot.split("|") as [ThemePreference, "light" | "dark"];

  const setTheme = useCallback((next: ThemePreference) => {
    applyTheme(next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  const value = useMemo(() => ({ theme, resolved, setTheme }), [theme, resolved, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside <ThemeProvider>");
  return value;
}
