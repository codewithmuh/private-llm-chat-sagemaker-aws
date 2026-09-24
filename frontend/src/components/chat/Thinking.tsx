"use client";

/**
 * The collapsible "Thinking" section of a reasoning model's answer.
 * Open while the model is still thinking; collapses once the answer starts.
 */
import { useEffect, useRef, useState } from "react";
import { Brain, ChevronRight } from "lucide-react";
import { Markdown } from "./Markdown";
import styles from "./Thinking.module.css";

interface ThinkingProps {
  text: string;
  /** The model is still thinking (streaming, no </think> yet). */
  inProgress: boolean;
}

export function Thinking({ text, inProgress }: ThinkingProps) {
  const [expanded, setExpanded] = useState(inProgress);
  const [wasInProgress, setWasInProgress] = useState(inProgress);
  // When thinking finishes, fold it away (React's "adjust state when a prop
  // changes" pattern: done during render, no effect needed).
  if (wasInProgress !== inProgress) {
    setWasInProgress(inProgress);
    setExpanded(inProgress);
  }

  // Count the seconds while thinking; the last value becomes "Thought for Ns".
  // (Answers loaded from history weren't timed, so they just say "Thoughts".)
  const startedAt = useRef<number | null>(null);
  const [seconds, setSeconds] = useState<number | null>(null);
  useEffect(() => {
    if (!inProgress) return;
    startedAt.current ??= Date.now();
    const tick = () => setSeconds(Math.max(1, Math.round((Date.now() - (startedAt.current ?? Date.now())) / 1000)));
    const timer = window.setInterval(tick, 1000);
    return () => {
      window.clearInterval(timer);
      tick();
    };
  }, [inProgress]);

  const label = inProgress
    ? `Thinking${seconds ? ` · ${seconds}s` : "…"}`
    : seconds
      ? `Thought for ${seconds}s`
      : "Thoughts";

  return (
    <div className={styles.thinking} data-in-progress={inProgress || undefined}>
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <Brain size={15} aria-hidden className={styles.icon} />
        <span>{label}</span>
        <ChevronRight size={15} aria-hidden className={styles.chevron} />
      </button>
      {expanded && text && (
        <div className={styles.body}>
          <Markdown content={text} streaming={inProgress} />
        </div>
      )}
    </div>
  );
}
