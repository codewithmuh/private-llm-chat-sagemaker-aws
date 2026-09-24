"use client";

import { memo, useMemo } from "react";
import { Check, CircleAlert, CircleStop, Copy, RefreshCw } from "lucide-react";
import { useCopy } from "@/hooks/useCopy";
import { formatDuration } from "@/lib/format";
import { splitThinking } from "@/lib/thinking";
import type { Message } from "@/lib/types";
import { Markdown } from "./Markdown";
import { MessageAttachments } from "./MessageAttachments";
import { Thinking } from "./Thinking";
import styles from "./MessageItem.module.css";

interface MessageItemProps {
  message: Message;
  /** The last message of the conversation gets the Regenerate button. */
  isLast: boolean;
  /** Something is streaming in this conversation (hide Regenerate meanwhile). */
  busy: boolean;
  modelName?: string;
  onRegenerate: () => void;
}

function CopyButton({ text }: { text: string }) {
  const [copied, copy] = useCopy();
  return (
    <button
      type="button"
      className="icon-btn icon-btn-sm"
      onClick={() => void copy(text)}
      aria-label={copied ? "Copied" : "Copy message"}
      title={copied ? "Copied" : "Copy"}
    >
      {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
    </button>
  );
}

// memo: while an answer streams only that one message re-renders, not the
// whole conversation (each message object keeps its identity in the store).
export const MessageItem = memo(function MessageItem({ message, isLast, busy, modelName, onRegenerate }: MessageItemProps) {
  const streaming = message.status === "streaming";
  // Reasoning models: split "<think>…</think>" from the answer.
  const { thinking, thinkingOpen, answer } = useMemo(
    () => (message.role === "assistant" ? splitThinking(message.content, streaming) : { thinking: null, thinkingOpen: false, answer: message.content }),
    [message.role, message.content, streaming],
  );

  if (message.role === "user") {
    return (
      <div className={styles.user}>
        {message.attachments.length > 0 && <MessageAttachments attachments={message.attachments} />}
        {message.content && <div className={styles.bubble}>{message.content}</div>}
        {message.content && (
          <div className={styles.actions}>
            <CopyButton text={message.content} />
          </div>
        )}
      </div>
    );
  }

  const meta = [
    modelName,
    message.duration_ms ? formatDuration(message.duration_ms) : null,
    message.usage ? `${message.usage.completion_tokens} tokens` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className={styles.assistant} data-last={isLast || undefined}>
      {streaming && !message.content ? (
        <div className={styles.thinking} aria-label="Thinking">
          <span />
          <span />
          <span />
        </div>
      ) : (
        <>
          {thinking !== null && (thinking || (streaming && thinkingOpen)) && (
            <Thinking text={thinking} inProgress={streaming && thinkingOpen} />
          )}
          {answer && <Markdown content={answer} streaming={streaming && !thinkingOpen} />}
        </>
      )}

      {message.status === "stopped" && (
        <p className={styles.note}>
          <CircleStop size={14} aria-hidden /> Stopped
        </p>
      )}

      {message.status === "error" && (
        <div className={`alert alert-error ${styles.error}`} role="alert">
          <CircleAlert size={17} aria-hidden />
          <div className={styles.errorText}>{message.error || "Something went wrong while answering."}</div>
          {isLast && !busy && (
            <button type="button" className="btn btn-sm btn-secondary" onClick={onRegenerate}>
              <RefreshCw size={14} aria-hidden /> Retry
            </button>
          )}
        </div>
      )}

      {!streaming && (
        <div className={styles.actions}>
          {answer && <CopyButton text={answer} />}
          {isLast && !busy && message.status !== "error" && (
            <button
              type="button"
              className="icon-btn icon-btn-sm"
              onClick={onRegenerate}
              aria-label="Regenerate answer"
              title="Regenerate"
            >
              <RefreshCw size={16} aria-hidden />
            </button>
          )}
          {meta && <span className={styles.meta}>{meta}</span>}
        </div>
      )}
    </div>
  );
});
