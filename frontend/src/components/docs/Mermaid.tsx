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

/*
 * Mermaid mixes and lightens colors itself, so it needs solid hex values
 * (not the translucent CSS tokens). These match globals.css.
 */
const PALETTES = {
  light: {
    background: "#ffffff",
    primaryColor: "#f4f4f4",
    primaryTextColor: "#0d0d0d",
    primaryBorderColor: "#c9c9c9",
    secondaryColor: "#e3f1ef",
    tertiaryColor: "#fafafa",
    lineColor: "#8f8f8f",
    textColor: "#0d0d0d",
    edgeLabelBackground: "#ffffff",
    clusterBkg: "#fafafa",
    clusterBorder: "#d0d0d0",
    noteBkgColor: "#f4f4f4",
    noteTextColor: "#0d0d0d",
    noteBorderColor: "#d0d0d0",
    actorBkg: "#f4f4f4",
    actorBorder: "#c9c9c9",
    actorTextColor: "#0d0d0d",
    signalColor: "#5d5d5d",
    signalTextColor: "#0d0d0d",
    labelBoxBkgColor: "#f4f4f4",
    labelTextColor: "#0d0d0d",
    loopTextColor: "#0d0d0d",
    activationBkgColor: "#e3f1ef",
  },
  dark: {
    background: "#212121",
    primaryColor: "#2c2c2c",
    primaryTextColor: "#ececec",
    primaryBorderColor: "#4a4a4a",
    secondaryColor: "#1d3b38",
    tertiaryColor: "#262626",
    lineColor: "#8b8b8b",
    textColor: "#ececec",
    edgeLabelBackground: "#212121",
    clusterBkg: "#262626",
    clusterBorder: "#3b3b3b",
    noteBkgColor: "#2c2c2c",
    noteTextColor: "#ececec",
    noteBorderColor: "#4a4a4a",
    actorBkg: "#2c2c2c",
    actorBorder: "#4a4a4a",
    actorTextColor: "#ececec",
    signalColor: "#b4b4b4",
    signalTextColor: "#ececec",
    labelBoxBkgColor: "#2c2c2c",
    labelTextColor: "#ececec",
    loopTextColor: "#ececec",
    activationBkgColor: "#1d3b38",
  },
};

export function Mermaid({ source }: { source: string }) {
  const { resolved } = useTheme();
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    import("mermaid")
      .then(async ({ default: mermaid }) => {
        const fontFamily = getComputedStyle(document.body).fontFamily || "sans-serif";
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict", // no clicks/scripts from diagram text
          theme: "base",
          fontFamily,
          themeVariables: { darkMode: resolved === "dark", fontFamily, fontSize: "15px", ...PALETTES[resolved] },
          // Tighter spacing: wide left-to-right charts get scaled down to the
          // page width, so less empty space means bigger text.
          flowchart: { nodeSpacing: 28, rankSpacing: 36, padding: 10 },
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
