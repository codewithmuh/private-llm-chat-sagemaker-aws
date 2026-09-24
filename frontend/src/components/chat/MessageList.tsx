"use client";

/**
 * The scrolling list of messages.
 *
 * Auto-scroll: while you are at the bottom, new content (streamed tokens,
 * images finishing loading) keeps you at the bottom. Scroll up to read and it
 * stops following; a "scroll to bottom" button appears instead.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDown, CircleAlert, RefreshCw, X } from "lucide-react";
import type { Message } from "@/lib/types";
import type { SendError } from "@/providers/ChatProvider";
import { MessageItem } from "./MessageItem";
import styles from "./MessageList.module.css";

interface MessageListProps {
  messages: Message[];
  busy: boolean;
  sendError: SendError | null;
  onRegenerate: () => void;
  onDismissError: () => void;
  modelName: (id: string | null) => string | undefined;
  /** Shown instead of messages when there are none (the empty state). */
  empty?: ReactNode;
}

const NEAR_BOTTOM_PX = 80;

export function MessageList({
  messages,
  busy,
  sendError,
  onRegenerate,
  onDismissError,
  modelName,
  empty,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // Should new content keep us at the bottom? Not for the empty state (its
  // top would be cut off on small screens); sending a message turns it on.
  const follow = useRef(messages.length > 0);
  const [atBottom, setAtBottom] = useState(true);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    follow.current = near;
    setAtBottom(near);
  };

  // Start at the bottom of the conversation.
  useLayoutEffect(() => {
    if (follow.current) scrollToBottom();
  }, [scrollToBottom]);

  // Whenever the content grows and we are following, stay at the bottom.
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const observer = new ResizeObserver(() => {
      if (follow.current) scrollToBottom();
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [scrollToBottom]);

  // Sending a new message always jumps to the bottom.
  useLayoutEffect(() => {
    if (!busy) return;
    follow.current = true;
    scrollToBottom();
  }, [busy, scrollToBottom]);

  const lastIndex = messages.length - 1;

  return (
    <div className={styles.wrap}>
      <div ref={scrollRef} className={styles.scroll} onScroll={onScroll}>
        <div ref={contentRef} className={styles.content}>
          {messages.length === 0 && !sendError
            ? empty
            : messages.map((message, index) => (
                <MessageItem
                  key={message.id}
                  message={message}
                  isLast={index === lastIndex}
                  busy={busy}
                  modelName={message.role === "assistant" ? modelName(message.model) : undefined}
                  onRegenerate={onRegenerate}
                />
              ))}

          {sendError && (
            <div className={`alert alert-error ${styles.sendError}`} role="alert">
              <CircleAlert size={17} aria-hidden />
              <div className={styles.sendErrorText}>
                <strong>{sendError.canRetry ? "Couldn't regenerate." : "Your message wasn't sent."}</strong>{" "}
                {sendError.message}
              </div>
              {sendError.canRetry && (
                <button type="button" className="btn btn-sm btn-secondary" onClick={onRegenerate} disabled={busy}>
                  <RefreshCw size={14} aria-hidden /> Retry
                </button>
              )}
              <button type="button" className="icon-btn icon-btn-sm" onClick={onDismissError} aria-label="Dismiss">
                <X size={16} aria-hidden />
              </button>
            </div>
          )}
        </div>
      </div>

      {!atBottom && messages.length > 0 && (
        <button
          type="button"
          className={styles.toBottom}
          onClick={() => {
            follow.current = true;
            scrollToBottom(true);
          }}
          aria-label="Scroll to the latest message"
        >
          <ArrowDown size={18} aria-hidden />
        </button>
      )}
    </div>
  );
}
