import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "katex/dist/katex.min.css";
import "@/styles/highlight.css";
import "./globals.css";
import { THEME_SCRIPT } from "@/lib/theme";
import { Providers } from "@/providers/Providers";

// The real app name comes from GET /api/config/ at runtime (see
// useDocumentTitle); this is only the title before JavaScript runs.
export const metadata: Metadata = {
  title: "Private LLM Chat",
  description: "A private ChatGPT-like assistant running on your own GPUs in AWS.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // On phones, shrink the page (instead of overlaying it) when the keyboard opens,
  // so the message box stays visible.
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#212121" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // data-theme is set by THEME_SCRIPT before React hydrates, so the server
    // HTML and the live DOM differ on purpose: suppress that one warning.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Runs before first paint: picks light/dark so there is no flash. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
