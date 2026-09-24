"use client";

import { CircleAlert, FileText, ScanText, TriangleAlert, X } from "lucide-react";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { formatBytes } from "@/lib/format";
import type { UploadItem } from "./useUploads";
import styles from "./ComposerChip.module.css";

interface ComposerChipProps {
  item: UploadItem;
  onRemove: () => void;
  /** Only for images: extract the text and put it in the message box. */
  onOcr?: () => void;
}

export function ComposerChip({ item, onRemove, onOcr }: ComposerChipProps) {
  const failed = item.status === "error";
  const uploading = item.status === "uploading";
  const pages = item.attachment?.page_count;

  const status = failed
    ? item.error
    : uploading
      ? `Uploading ${Math.round(item.progress * 100)}%`
      : item.warning
        ? item.warning
        : [formatBytes(item.size), pages ? `${pages} page${pages === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ");

  return (
    <li className={styles.chip} data-kind={item.isImage && item.previewUrl ? "image" : "file"} data-error={failed || undefined}>
      {item.isImage && item.previewUrl ? (
        <div className={styles.thumb}>
          {/* A local blob: preview or an API URL; next/image can't optimise either. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={item.previewUrl} alt={item.name} />
          {uploading && (
            <span className={styles.overlay}>
              <ProgressRing value={item.progress} />
            </span>
          )}
        </div>
      ) : (
        <div className={styles.file}>
          <span className={styles.fileIcon}>
            {uploading ? (
              <ProgressRing value={item.progress} size={26} />
            ) : failed ? (
              <CircleAlert size={18} aria-hidden />
            ) : (
              <FileText size={18} aria-hidden />
            )}
          </span>
          <span className={styles.fileText}>
            <span className={styles.name} title={item.name}>
              {item.name}
            </span>
            <span className={styles.meta} title={status ?? undefined}>
              {item.warning && !failed && <TriangleAlert size={11} aria-hidden />} {status}
            </span>
          </span>
        </div>
      )}

      {item.isImage && item.previewUrl && failed && (
        <span className={styles.imageError} title={item.error ?? undefined}>
          <CircleAlert size={16} aria-hidden />
          <span className="sr-only">{item.error}</span>
        </span>
      )}

      {onOcr && item.status === "ready" && item.previewUrl && (
        <button
          type="button"
          className={styles.ocr}
          onClick={onOcr}
          disabled={item.ocr === "running"}
          aria-label={`Extract text (OCR) from ${item.name}`}
          title="Extract text (OCR)"
        >
          {item.ocr === "running" ? <span className="spinner" aria-hidden /> : <ScanText size={14} aria-hidden />}
        </button>
      )}

      <button type="button" className={styles.remove} onClick={onRemove} aria-label={`Remove ${item.name}`} title="Remove">
        <X size={12} strokeWidth={2.6} aria-hidden />
      </button>

      {item.isImage && !item.previewUrl && failed && <span className="sr-only">{item.error}</span>}
    </li>
  );
}
