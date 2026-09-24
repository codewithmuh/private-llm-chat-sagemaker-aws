/**
 * Google Identity Services ("Sign in with Google").
 *
 * We load Google's script only on pages that show the button, and only when
 * the server has a Google client id configured (GET /api/config/). Google
 * gives us a signed ID token ("credential"); the Django API verifies it.
 */

interface GoogleCredentialResponse {
  credential: string;
}

interface GoogleButtonOptions {
  type?: "standard" | "icon";
  theme?: "outline" | "filled_blue" | "filled_black";
  size?: "large" | "medium" | "small";
  text?: "signin_with" | "signup_with" | "continue_with" | "signin";
  shape?: "rectangular" | "pill" | "circle" | "square";
  logo_alignment?: "left" | "center";
  width?: number;
}

interface GoogleAccountsId {
  initialize: (config: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
    ux_mode?: "popup" | "redirect";
    auto_select?: boolean;
    cancel_on_tap_outside?: boolean;
  }) => void;
  renderButton: (parent: HTMLElement, options: GoogleButtonOptions) => void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleAccountsId } };
  }
}

const SCRIPT_URL = "https://accounts.google.com/gsi/client";
let loading: Promise<GoogleAccountsId> | null = null;

/** Load the Google script once; resolves with `google.accounts.id`. */
export function loadGoogleIdentity(): Promise<GoogleAccountsId> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);
  if (!loading) {
    loading = new Promise<GoogleAccountsId>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = SCRIPT_URL;
      script.async = true;
      script.defer = true;
      script.onload = () =>
        window.google?.accounts?.id ? resolve(window.google.accounts.id) : reject(new Error("Google script failed"));
      script.onerror = () => {
        loading = null; // allow a retry on the next page
        script.remove();
        reject(new Error("Google script failed to load"));
      };
      document.head.appendChild(script);
    });
  }
  return loading;
}

export type { GoogleButtonOptions };
