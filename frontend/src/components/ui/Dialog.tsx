"use client";

/**
 * A modal dialog built on the native <dialog> element. `showModal()` gives us
 * the hard parts for free: focus moves into the dialog, the rest of the page
 * becomes inert (focus can't Tab out), and Escape fires a "cancel" event.
 * We add: close on backdrop click, and return focus to where it was.
 *
 * Render it with `open`; when `open` is false nothing is in the DOM, so the
 * dialog's contents start fresh every time it opens. Mark the element that
 * should get focus first with `data-autofocus`.
 */
import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import styles from "./Dialog.module.css";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "full";
  /** false while something is running that must not be interrupted. */
  dismissible?: boolean;
  /** Hide the title visually (still read by screen readers). */
  hideTitle?: boolean;
  className?: string;
}

export function Dialog(props: DialogProps) {
  if (!props.open) return null;
  return <DialogInner {...props} />;
}

function DialogInner({
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  dismissible = true,
  hideTitle = false,
  className,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const pressedBackdrop = useRef(false);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    // showModal() focuses the first focusable element, which would be the
    // close button. Prefer an element marked data-autofocus, then the first
    // field in the body.
    const preferred =
      dialog.querySelector<HTMLElement>("[data-autofocus]") ??
      dialog.querySelector<HTMLElement>(`.${styles.body} input, .${styles.body} textarea, .${styles.body} select`);
    preferred?.focus();
    return () => {
      if (dialog.open) dialog.close();
      // Put focus back on the button that opened us (if it still exists).
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className={`${styles.dialog} ${className ?? ""}`}
      data-size={size}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        // Escape key. We decide whether to close, not the browser.
        event.preventDefault();
        if (dismissible) onClose();
      }}
      onClose={onClose /* the browser closed it anyway (e.g. Escape pressed twice) */}
      onMouseDown={(event) => {
        pressedBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        // A click on the <dialog> itself (not its panel) is a click on the backdrop.
        if (dismissible && pressedBackdrop.current && event.target === event.currentTarget) onClose();
      }}
    >
      <div className={styles.panel}>
        <header className={hideTitle ? "sr-only" : styles.header}>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          {dismissible && !hideTitle && (
            <button type="button" className="icon-btn icon-btn-sm" onClick={onClose} aria-label="Close">
              <X size={18} aria-hidden />
            </button>
          )}
        </header>
        {description && (
          <p id={descriptionId} className={styles.description}>
            {description}
          </p>
        )}
        {children && <div className={styles.body}>{children}</div>}
        {footer && <footer className={styles.footer}>{footer}</footer>}
      </div>
    </dialog>
  );
}
