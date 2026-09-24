"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { copyText } from "@/lib/browser";

/** Copy to clipboard and flip `copied` to true for a moment (for a ✓ icon). */
export function useCopy(resetAfterMs = 1500): [boolean, (text: string) => Promise<boolean>] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = useCallback(
    async (text: string) => {
      const ok = await copyText(text);
      if (ok) {
        setCopied(true);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), resetAfterMs);
      }
      return ok;
    },
    [resetAfterMs],
  );

  return [copied, copy];
}
