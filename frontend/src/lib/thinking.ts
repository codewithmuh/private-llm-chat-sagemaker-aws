/**
 * Reasoning models "think out loud" before answering. The backend wraps that
 * part in <think>…</think>; while it streams, the closing tag may not have
 * arrived yet. We split it out so the UI can show it as a collapsible
 * "Thinking" section above the answer (and Copy copies only the answer).
 */

export interface SplitAnswer {
  /** The reasoning text, or null if there is none. */
  thinking: string | null;
  /** The last <think> has no </think> yet (still thinking). */
  thinkingOpen: boolean;
  /** Everything outside the think blocks. */
  answer: string;
}

const OPEN = "<think>";
const CLOSE = "</think>";

/** While streaming, hide a tag that has only partly arrived ("<thi"). */
function trimPartialTag(text: string): string {
  for (const tag of [OPEN, CLOSE]) {
    for (let len = tag.length - 1; len > 0; len -= 1) {
      if (text.endsWith(tag.slice(0, len))) return text.slice(0, -len);
    }
  }
  return text;
}

export function splitThinking(content: string, streaming = false): SplitAnswer {
  const text = streaming ? trimPartialTag(content) : content;
  if (!text.includes(OPEN) && !text.includes(CLOSE)) return { thinking: null, thinkingOpen: false, answer: text };

  const thoughts: string[] = [];
  let answer = "";
  let rest = text;
  let open = false;

  // Some chat templates put <think> in the prompt, so the output starts with
  // the reasoning and only has the closing tag.
  const firstClose = rest.indexOf(CLOSE);
  const firstOpen = rest.indexOf(OPEN);
  if (firstClose >= 0 && (firstOpen < 0 || firstClose < firstOpen)) {
    thoughts.push(rest.slice(0, firstClose));
    rest = rest.slice(firstClose + CLOSE.length);
  }

  for (;;) {
    const start = rest.indexOf(OPEN);
    if (start < 0) {
      answer += rest;
      break;
    }
    answer += rest.slice(0, start);
    const inside = rest.slice(start + OPEN.length);
    const end = inside.indexOf(CLOSE);
    if (end < 0) {
      thoughts.push(inside);
      open = true;
      break;
    }
    thoughts.push(inside.slice(0, end));
    rest = inside.slice(end + CLOSE.length);
  }

  return {
    thinking: thoughts
      .map((t) => t.trim())
      .filter(Boolean)
      .join("\n\n"),
    thinkingOpen: open,
    answer: answer.replace(/^\s+/, ""),
  };
}
