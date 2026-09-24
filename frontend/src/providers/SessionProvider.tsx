"use client";

/**
 * The signed-in user. This is also the AUTH GUARD for everything under
 * app/(app)/: it asks GET /api/auth/me/ and
 *   - 200 -> renders the app with `user` available through useSession()
 *   - 401 -> sends the browser to /login?next=<this page>
 * Any later request that gets a 401 (session expired) does the same.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { api, errorMessage, isApiError, setUnauthorizedHandler } from "@/lib/api";
import { APP_HOME } from "@/lib/browser";
import { markSignedIn, markSignedOut } from "@/lib/session-hint";
import { isThemePreference } from "@/lib/theme";
import type { ThemePreference, User, UserPreferences } from "@/lib/types";
import { useTheme } from "./ThemeProvider";
import { useToast } from "@/components/ui/Toast";

export interface MePatch {
  name?: string;
  preferences?: Partial<UserPreferences>;
}

interface SessionValue {
  user: User;
  setUser: (user: User) => void;
  refreshUser: () => Promise<void>;
  /** PATCH /api/auth/me/ and keep the result. Throws ApiError on failure. */
  updateMe: (patch: MePatch) => Promise<User>;
  /** Apply a theme now and save it to the user's preferences. */
  setThemeAndSave: (theme: ThemePreference) => void;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

type State = { status: "loading" } | { status: "ready"; user: User } | { status: "error"; message: string };

export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const toast = useToast();
  const { setTheme } = useTheme();
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const redirecting = useRef(false);

  const redirectToLogin = useCallback(() => {
    if (redirecting.current) return;
    redirecting.current = true;
    markSignedOut();
    const here = `${window.location.pathname}${window.location.search}`;
    router.replace(here === APP_HOME ? "/login" : `/login?next=${encodeURIComponent(here)}`);
  }, [router]);

  // Any 401 from any API call while signed in -> back to the login page.
  useEffect(() => {
    setUnauthorizedHandler(redirectToLogin);
    return () => setUnauthorizedHandler(null);
  }, [redirectToLogin]);

  useEffect(() => {
    let cancelled = false;
    api
      .get<User>("/api/auth/me/")
      .then((user) => {
        if (cancelled) return;
        markSignedIn();
        setState({ status: "ready", user });
        // The saved preference wins, so the theme follows the user across devices.
        if (isThemePreference(user.preferences?.theme)) setTheme(user.preferences.theme);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (isApiError(error) && error.status === 401) redirectToLogin();
        else setState({ status: "error", message: errorMessage(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt, redirectToLogin, setTheme]);

  const setUser = useCallback((user: User) => setState({ status: "ready", user }), []);

  const refreshUser = useCallback(async () => {
    const user = await api.get<User>("/api/auth/me/");
    setState({ status: "ready", user });
  }, []);

  const updateMe = useCallback(async (patch: MePatch) => {
    const user = await api.patch<User>("/api/auth/me/", patch);
    setState({ status: "ready", user });
    return user;
  }, []);

  const setThemeAndSave = useCallback(
    (theme: ThemePreference) => {
      setTheme(theme);
      updateMe({ preferences: { theme } }).catch((error: unknown) =>
        toast.error(errorMessage(error, "Couldn't save your theme.")),
      );
    },
    [setTheme, updateMe, toast],
  );

  const logout = useCallback(async () => {
    try {
      await api.post("/api/auth/logout/");
    } catch {
      // Leave anyway; the session cookie is gone or will expire.
    }
    markSignedOut();
    // /login is outside this layout, so every provider here (messages,
    // streams, the user) unmounts and its state is dropped.
    router.replace("/login");
  }, [router]);

  const value = useMemo<SessionValue | null>(
    () =>
      state.status === "ready" ? { user: state.user, setUser, refreshUser, updateMe, setThemeAndSave, logout } : null,
    [state, setUser, refreshUser, updateMe, setThemeAndSave, logout],
  );

  if (state.status === "error") {
    return (
      <div className="center-screen">
        <div style={{ display: "grid", gap: 14, justifyItems: "center", maxWidth: 360 }}>
          <p>{state.message}</p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setState({ status: "loading" });
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!value) {
    return (
      <div className="center-screen" aria-busy="true">
        <span className="spinner spinner-lg" aria-label="Loading" />
      </div>
    );
  }

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside <SessionProvider>");
  return value;
}
