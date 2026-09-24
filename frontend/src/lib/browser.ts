/** Browser helpers: clipboard, downloads, safe redirects, session handoff. */
import type { Attachment } from "./types";

/** Copy text to the clipboard. Returns false if the browser refused. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers / insecure contexts: fall back to a hidden textarea.
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** Save `text` as a file the user downloads. */
export function downloadText(filename: string, text: string, type = "text/plain"): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Only follow `?next=` values that point inside this app. Anything else
 * ("https://evil.example", "//evil.example") would be an open redirect.
 */
export function safeNext(next: string | null | undefined, fallback = "/"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}

/* ------------------------------------------------ composer handoff */

/**
 * The OCR tool's "Ask about it in a new chat" button opens a conversation
 * with the file already attached. The attachment travels in sessionStorage
 * (per tab, cleared when read), keyed by the conversation id.
 */
const HANDOFF_KEY = "llmchat:composer-handoff";

interface Handoff {
  conversationId: string;
  attachments: Attachment[];
  text: string;
}

export function saveComposerHandoff(handoff: Handoff): void {
  try {
    sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(handoff));
  } catch {
    // Storage full or disabled: the chat simply opens without the file.
  }
}

export function takeComposerHandoff(conversationId: string): Handoff | null {
  try {
    const raw = sessionStorage.getItem(HANDOFF_KEY);
    if (!raw) return null;
    const handoff = JSON.parse(raw) as Handoff;
    if (handoff.conversationId !== conversationId) return null;
    sessionStorage.removeItem(HANDOFF_KEY);
    return handoff;
  } catch {
    return null;
  }
}
