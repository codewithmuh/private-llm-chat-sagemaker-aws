"use client";

import { useEffect } from "react";
import { api } from "@/lib/api";
import { maybeSignedIn, markSignedOut } from "@/lib/session-hint";
import type { User } from "@/lib/types";
import { useFinishLogin } from "./useFinishLogin";

/** On login/sign-up pages: if a session already exists, skip ahead to `next`. */
export function useRedirectIfSignedIn(next: string): void {
  const finishLogin = useFinishLogin(next);
  useEffect(() => {
    // Only ask when this browser signed in before (see lib/session-hint.ts).
    if (!maybeSignedIn()) return;
    let cancelled = false;
    api
      .get<User>("/api/auth/me/")
      .then(() => {
        if (!cancelled) finishLogin();
      })
      .catch(() => {
        // The session expired: forget the hint.
        markSignedOut();
      });
    return () => {
      cancelled = true;
    };
  }, [finishLogin]);
}
