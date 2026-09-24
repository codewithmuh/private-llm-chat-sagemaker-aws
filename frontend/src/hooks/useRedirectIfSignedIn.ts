"use client";

import { useEffect } from "react";
import { api } from "@/lib/api";
import type { User } from "@/lib/types";
import { useFinishLogin } from "./useFinishLogin";

/** On login/sign-up pages: if a session already exists, skip ahead to `next`. */
export function useRedirectIfSignedIn(next: string): void {
  const finishLogin = useFinishLogin(next);
  useEffect(() => {
    let cancelled = false;
    api
      .get<User>("/api/auth/me/")
      .then(() => {
        if (!cancelled) finishLogin();
      })
      .catch(() => {
        // 401: not signed in, which is what we expect here.
      });
    return () => {
      cancelled = true;
    };
  }, [finishLogin]);
}
