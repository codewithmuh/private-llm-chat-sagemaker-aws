"use client";

import { useState } from "react";
import { ExternalLink, FileText } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { apiUrl } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import type { Attachment } from "@/lib/types";
import styles from "./MessageAttachments.module.css";

/** Files sent with a message: image thumbnails (click to enlarge) and file chips. */
export function MessageAttachments({ attachments }: { attachments: Attachment[] }) {
  const [open, setOpen] = useState<Attachment | null>(null);
  const images = attachments.filter((a) => a.kind === "image");
  const files = attachments.filter((a) => a.kind !== "image");

  return (
    <div className={styles.wrap}>
      {images.length > 0 && (
        <div className={styles.images} data-count={Math.min(images.length, 3)}>
          {images.map((image) => (
            <button
              key={image.id}
              type="button"
              className={styles.thumb}
              onClick={() => setOpen(image)}
              aria-label={`View ${image.filename}`}
            >
              {/* Served by the API with the session cookie; next/image can't proxy that. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={apiUrl(image.url)} alt={image.filename} loading="lazy" />
            </button>
          ))}
        </div>
      )}

      {files.map((file) => (
        <a
          key={file.id}
          href={apiUrl(file.url)}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.file}
          title={`Open ${file.filename}`}
        >
          <span className={styles.fileIcon}>
            <FileText size={18} aria-hidden />
          </span>
          <span className={styles.fileText}>
            <span className={styles.fileName}>{file.filename}</span>
            <span className={styles.fileMeta}>
              {[
                formatBytes(file.size),
                file.page_count ? `${file.page_count} page${file.page_count === 1 ? "" : "s"}` : null,
                file.status === "error" ? "text not readable" : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
        </a>
      ))}

      <Dialog open={open !== null} onClose={() => setOpen(null)} title={open?.filename ?? "Image"} size="full">
        {open && (
          <figure className={styles.lightbox}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={apiUrl(open.url)} alt={open.filename} />
            <figcaption>
              <a href={apiUrl(open.url)} target="_blank" rel="noopener noreferrer" className="link">
                Open original <ExternalLink size={13} aria-hidden style={{ display: "inline" }} />
              </a>
            </figcaption>
          </figure>
        )}
      </Dialog>
    </div>
  );
}
