"use client";

import { Check, Copy } from "lucide-react";
import { useCopy } from "@/hooks/useCopy";
import styles from "./docs.module.css";

/** The "Copy" button in a code block's header. */
export function CopyCodeButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, copy] = useCopy();
  return (
    <button type="button" className={styles.codeCopy} onClick={() => void copy(text)} aria-label="Copy code">
      {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
      {copied ? "Copied" : label}
    </button>
  );
}
