"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * A countdown for "Resend code" buttons.
 *
 *   const [secondsLeft, startCooldown] = useCooldown(30);
 *   <button disabled={secondsLeft > 0}>Resend{secondsLeft ? ` (${secondsLeft})` : ""}</button>
 */
export function useCooldown(seconds: number, startImmediately = false): [number, () => void] {
  const [until, setUntil] = useState<number>(() => (startImmediately ? Date.now() + seconds * 1000 : 0));
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    if (until === 0) return;
    const timer = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= until) window.clearInterval(timer);
    }, 250);
    return () => window.clearInterval(timer);
  }, [until]);

  const start = useCallback(() => {
    const t = Date.now();
    setNow(t);
    setUntil(t + seconds * 1000);
  }, [seconds]);

  return [Math.max(0, Math.ceil((until - now) / 1000)), start];
}
