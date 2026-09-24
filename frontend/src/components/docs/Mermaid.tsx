"use client";

/**
 * A ```mermaid diagram from the docs, drawn in the browser.
 *
 * The mermaid library is big (~1 MB), so it is loaded with a dynamic
 * import() only when a page actually contains a diagram. It is re-drawn when
 * the theme changes, using the site's color tokens. If drawing fails, the
 * diagram's source is shown as a code block instead.
 */
import { useEffect, useId, useState } from "react";
import { useTheme } from "@/providers/ThemeProvider";
import styles from "./docs.module.css";

function token(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export function Mermaid({ source }: { source: string }) {
  const { resolved } = useTheme();
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    import("mermaid")
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict", // no clicks/scripts from diagram text
          theme: "base",
          fontFamily: token("--font-sans", "sans-serif"),
          themeVariables: {
            darkMode: resolved === "dark",
            background: token("--bg", "#ffffff"),
            primaryColor: token("--surface-2", "#f4f4f4"),
            primaryTextColor: token("--text", "#0d0d0d"),
            primaryBorderColor: token("--border-strong", "#d0d0d0"),
            secondaryColor: token("--accent-soft", "#e6f2f1"),
            tertiaryColor: token("--surface", "#ffffff"),
            lineColor: token("--text-3", "#8f8f8f"),
            textColor: token("--text", "#0d0d0d"),
            noteBkgColor: token("--surface-2", "#f4f4f4"),
            noteTextColor: token("--text", "#0d0d0d"),
            actorBkg: token("--surface-2", "#f4f4f4"),
            actorBorder: token("--border-strong", "#d0d0d0"),
            signalColor: token("--text-2", "#5d5d5d"),
            signalTextColor: token("--text", "#0d0d0d"),
          },
        });
        const result = await mermaid.render(`mermaid-${id}-${resolved}`, source);
        if (!cancelled) {
          setSvg(result.svg);
          setFailed(false);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [source, resolved, id]);

  if (failed) {
    return (
      <div className={styles.codeBlock}>
        <div className={styles.codeHeader}>
          <span>mermaid (diagram could not be drawn)</span>
        </div>
        <pre>
          <code>{source}</code>
        </pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className={styles.diagram} aria-busy="true">
        <span className="spinner" aria-label="Drawing diagram" />
      </div>
    );
  }

  return (
    <figure
      className={styles.diagram}
      // mermaid returns an SVG string built from our own docs and sanitised
      // by mermaid itself (securityLevel "strict").
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
