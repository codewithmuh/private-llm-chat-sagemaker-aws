/**
 * A hint (not a secret) that this browser has signed in before.
 *
 * Public pages (the landing page, /login) want to know "is someone signed
 * in?" to show "Open app" instead of "Log in". Asking GET /api/auth/me/ tells
 * us, but for an anonymous visitor it answers 401, which the browser prints in
 * the console as a failed request. So we only ask when this hint is set.
 * The real session is still the HttpOnly `sessionid` cookie.
 */
import { readLocal, writeLocal } from "./storage";

const KEY = "llmchat:signed-in";

export function markSignedIn(): void {
  writeLocal(KEY, "1");
}

export function markSignedOut(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Storage unavailable: nothing to clear.
  }
}

export function maybeSignedIn(): boolean {
  return readLocal(KEY) === "1";
}
