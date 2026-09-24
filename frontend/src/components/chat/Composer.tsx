"use client";

/**
 * The message box.
 *
 * - Enter sends, Shift+Enter adds a new line. While an IME is composing
 *   (Chinese, Japanese, Korean input) Enter confirms the composition instead,
 *   so we ignore it. On touch screens Enter always adds a new line.
 * - Files: paperclip button, drag and drop (handled by ChatView, which calls
 *   `addFiles` through the ref), or paste a screenshot. They upload at once.
 * - While an answer streams, the Send button becomes Stop.
 */
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  type Ref,
} from "react";
import { ArrowUp, Paperclip, Square } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { errorMessage } from "@/lib/api";
import { takeComposerHandoff } from "@/lib/browser";
import { renamePastedFile } from "@/lib/files";
import type { Attachment, Model } from "@/lib/types";
import { useConfig } from "@/providers/ConfigProvider";
import { FOCUS_COMPOSER_EVENT } from "@/components/shell/AppShell";
import { ComposerChip } from "./ComposerChip";
import { useUploads } from "./useUploads";
import styles from "./Composer.module.css";

export interface ComposerHandle {
  setText: (text: string) => void;
  addFiles: (files: File[]) => void;
  focus: () => void;
}

interface ComposerProps {
  ref?: Ref<ComposerHandle>;
  conversationId: string | null;
  model: Model | undefined;
  streaming: boolean;
  /** Resolve true when the message was accepted (the composer then clears). */
  onSend: (content: string, attachments: Attachment[]) => Promise<boolean>;
  onStop: () => void;
}

export function Composer({ ref, conversationId, model, streaming, onSend, onStop }: ComposerProps) {
  const { config } = useConfig();
  const toast = useToast();
  // Files handed over by the OCR tool's "Ask about it in a new chat".
  // (A lazy initializer runs once, before the first render.)
  const [handoff] = useState(() => (conversationId ? takeComposerHandoff(conversationId) : null));
  const [text, setText] = useState(handoff?.text ?? "");
  const [sending, setSending] = useState(false);
  const uploads = useUploads(handoff?.attachments);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addUploads = uploads.addFiles;
  const addFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      const problem = addUploads(files);
      if (problem) toast.error(problem);
    },
    [addUploads, toast],
  );

  const focus = useCallback(() => textareaRef.current?.focus(), []);

  useImperativeHandle(
    ref,
    () => ({
      setText: (value: string) => {
        setText(value);
        requestAnimationFrame(() => {
          const el = textareaRef.current;
          if (!el) return;
          el.focus();
          el.setSelectionRange(value.length, value.length);
        });
      },
      addFiles,
      focus,
    }),
    [addFiles, focus],
  );

  // Grow with the content, up to 40% of the screen height.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.4)}px`;
  }, [text]);

  // Focus on open (not on phones, where it would pop the keyboard up), and
  // when the "new chat" shortcut fires.
  useEffect(() => {
    if (!window.matchMedia("(pointer: coarse)").matches) focus();
    window.addEventListener(FOCUS_COMPOSER_EVENT, focus);
    return () => window.removeEventListener(FOCUS_COMPOSER_EVENT, focus);
  }, [focus]);

  const content = text.trim();
  const canSend = !streaming && !sending && !uploads.uploading && (content.length > 0 || uploads.ready.length > 0);

  const submit = async () => {
    if (!canSend) return;
    // Clear the box right away (the message shows up in the chat), but keep
    // the draft: if the server refuses it (e.g. 503 model_starting) nothing
    // was saved, so the text and files go back into the box.
    const draftText = text;
    const draftItems = uploads.detach();
    const attachments = draftItems.filter((i) => i.status === "ready" && i.attachment).map((i) => i.attachment as Attachment);
    setText("");
    setSending(true);
    const ok = await onSend(content, attachments);
    setSending(false);
    if (ok) {
      uploads.release(draftItems);
    } else {
      setText((typed) => (typed.trim() ? typed : draftText));
      uploads.restore(draftItems);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    // keyCode 229 = "an IME is processing this key" (older Safari).
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (window.matchMedia("(pointer: coarse)").matches) return; // phones: newline
    event.preventDefault();
    void submit();
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files);
    if (files.length === 0) return;
    // A pasted screenshot has no text; keep any text the clipboard also has.
    if (!event.clipboardData.getData("text/plain")) event.preventDefault();
    addFiles(files.map(renamePastedFile));
  };

  const onOcr = async (key: string) => {
    try {
      const extracted = await uploads.runOcr(key);
      if (!extracted.trim()) {
        toast.info("No text found in that image.");
        return;
      }
      setText((current) => (current.trim() ? `${current.trimEnd()}\n\n${extracted}` : extracted));
      toast.success("Text extracted and added to your message.");
    } catch (error) {
      toast.error(errorMessage(error, "Couldn't extract text from that image."));
    }
  };

  const hasImages = uploads.items.some((i) => i.isImage && i.status !== "error");

  return (
    <form className={styles.composer} onSubmit={onSubmit}>
      {uploads.items.length > 0 && (
        <ul className={styles.chips} aria-label="Attachments">
          {uploads.items.map((item) => (
            <ComposerChip
              key={item.key}
              item={item}
              onRemove={() => uploads.remove(item.key)}
              onOcr={item.isImage ? () => void onOcr(item.key) : undefined}
            />
          ))}
        </ul>
      )}

      <textarea
        ref={textareaRef}
        className={styles.textarea}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        placeholder={model ? `Message ${model.name}` : "Send a message"}
        aria-label="Message"
        rows={1}
      />

      <div className={styles.toolbar}>
        <button
          type="button"
          className="icon-btn"
          onClick={() => fileInputRef.current?.click()}
          aria-label="Attach files"
          title={`Attach files (up to ${config.max_upload_mb} MB each)`}
        >
          <Paperclip size={19} aria-hidden />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          accept={config.accepted_file_types.join(",")}
          onChange={(event) => {
            addFiles(Array.from(event.target.files ?? []));
            event.target.value = ""; // allow picking the same file again
          }}
        />

        {model && !model.vision && hasImages && (
          <span className={styles.hint}>Images are converted to text for this model</span>
        )}

        {streaming ? (
          <button type="button" className={styles.send} onClick={onStop} aria-label="Stop generating" title="Stop">
            <Square size={14} fill="currentColor" aria-hidden />
          </button>
        ) : (
          <button
            type="submit"
            className={styles.send}
            disabled={!canSend}
            aria-label={uploads.uploading ? "Waiting for uploads to finish" : "Send message"}
            title={uploads.uploading ? "Waiting for uploads…" : "Send"}
          >
            {sending ? <span className="spinner" aria-hidden /> : <ArrowUp size={19} strokeWidth={2.4} aria-hidden />}
          </button>
        )}
      </div>
    </form>
  );
}
