"use client";

import { Code, FileText, Mail, ScanText, type LucideIcon } from "lucide-react";
import { LogoMark } from "@/components/ui/Logo";
import { useConfig } from "@/providers/ConfigProvider";
import styles from "./EmptyState.module.css";

interface Suggestion {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  prompt: string;
}

const SUGGESTIONS: Suggestion[] = [
  {
    icon: FileText,
    title: "Summarize a PDF",
    subtitle: "Attach a report and get the key points",
    prompt: "Summarize the attached PDF in five bullet points, then list any action items.",
  },
  {
    icon: ScanText,
    title: "Extract text from an image",
    subtitle: "Screenshots, receipts, scanned pages",
    prompt: "Extract all the text from the attached image. Keep the layout using Markdown (headings, lists, tables).",
  },
  {
    icon: Code,
    title: "Explain this code",
    subtitle: "Step by step, in plain language",
    prompt: "Explain what this code does, step by step, and point out any bugs:\n\n```\n\n```",
  },
  {
    icon: Mail,
    title: "Draft an email",
    subtitle: "Clear, friendly and to the point",
    prompt: "Draft a short, friendly email to my team announcing that ",
  },
];

export function EmptyState({ onPick }: { onPick: (prompt: string) => void }) {
  const { config } = useConfig();
  return (
    <div className={styles.empty}>
      <LogoMark size={44} />
      <h1 className={styles.title}>{config.app_name}</h1>
      <p className={styles.subtitle}>Your private assistant, running on your own GPU.</p>
      <div className={styles.cards}>
        {SUGGESTIONS.map(({ icon: Icon, title, subtitle, prompt }) => (
          <button key={title} type="button" className={styles.card} onClick={() => onPick(prompt)}>
            <Icon size={18} aria-hidden className={styles.icon} />
            <span className={styles.cardTitle}>{title}</span>
            <span className={styles.cardSubtitle}>{subtitle}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
