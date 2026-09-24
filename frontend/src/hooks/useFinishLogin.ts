"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { API_BASE } from "@/lib/api";
import { markSignedIn } from "@/lib/session-hint";

/** Django admin pages live on the API server, not in this Next.js app. */
export function isAdminPath(path: string): boolean {
  return path === "/admin" || path.startsWith("/admin/") || path.startsWith("/admin?");
}

/**
 * Where to go after a successful sign-in. `next` must already be a safe,
 * relative path (see safeNext in lib/browser.ts).
 *
 * Django's /admin/login/ sends people to /login?next=/admin/. The admin is
 * served by the API (another origin in local dev), so that needs a full page
 * load on the API origin instead of a client-side route change.
 */
export function useFinishLogin(next: string): () => void {
  const router = useRouter();
  return useCallback(() => {
    markSignedIn();
    if (isAdminPath(next)) {
      // Not a Next.js page (it's Django), so a full navigation is intended here.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`${API_BASE}${next}`);
      return;
    }
    router.replace(next);
  }, [router, next]);
}
