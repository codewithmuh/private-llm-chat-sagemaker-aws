/**
 * Light / dark theme.
 *
 * The user's choice ("system" | "light" | "dark") is saved in localStorage and
 * in their server-side preferences. The page shows the RESOLVED theme through
 * `<html data-theme="light|dark">`; globals.css switches its color variables on
 * that attribute.
 *
 * To avoid a white flash before React loads, layout.tsx runs THEME_SCRIPT
 * inline in <head>. It sets data-theme before the first paint.
 */
import type { ThemePreference } from "./types";

export const THEME_STORAGE_KEY = "llmchat:theme";

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function readStoredTheme(): ThemePreference {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(value) ? value : "system";
  } catch {
    return "system";
  }
}

export function resolveTheme(preference: ThemePreference): "light" | "dark" {
  if (preference !== "system") return preference;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Private mode: the theme still applies for this page view.
  }
  document.documentElement.dataset.theme = resolveTheme(preference);
}

/** Runs before paint. Keep it tiny and dependency-free: it is a string. */
export const THEME_SCRIPT = `(function(){try{var p=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(p!=="light"&&p!=="dark"){p=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.dataset.theme=p}catch(e){document.documentElement.dataset.theme="light"}})();`;
