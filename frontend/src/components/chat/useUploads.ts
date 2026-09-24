"use client";

/**
 * The composer's attachment list. Files upload as soon as they are added
 * (paperclip, drag and drop, paste), each with its own progress, so they are
 * ready by the time the user presses Send.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api, apiUrl, errorMessage, isAbortError } from "@/lib/api";
import { isImageFile, MAX_ATTACHMENTS, validateFile } from "@/lib/files";
import type { Attachment, OcrResult } from "@/lib/types";
import { uploadFile, type UploadHandle } from "@/lib/upload";
import { useConfig } from "@/providers/ConfigProvider";

export interface UploadItem {
  key: string;
  name: string;
  size: number;
  isImage: boolean;
  /** Thumbnail: a local blob: URL while uploading, the API URL for existing files. */
  previewUrl: string | null;
  status: "uploading" | "ready" | "error";
  progress: number;
  error: string | null;
  /** Server-side problem that doesn't block sending (e.g. text extraction failed). */
  warning: string | null;
  attachment: Attachment | null;
  ocr: "idle" | "running" | "done";
}

let keyCounter = 0;
const nextKey = () => `upload-${++keyCounter}`;

export function itemFromAttachment(attachment: Attachment): UploadItem {
  return {
    key: nextKey(),
    name: attachment.filename,
    size: attachment.size,
    isImage: attachment.kind === "image",
    previewUrl: attachment.kind === "image" ? apiUrl(attachment.url) : null,
    status: "ready",
    progress: 1,
    error: null,
    warning: attachment.status === "error" ? attachment.error : null,
    attachment,
    ocr: attachment.ocr_done ? "done" : "idle",
  };
}

export function useUploads(initial: Attachment[] = []) {
  const { config } = useConfig();
  const [items, setItems] = useState<UploadItem[]>(() => initial.map(itemFromAttachment));
  const handles = useRef(new Map<string, UploadHandle>());
  const itemsRef = useRef(items);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // On unmount: cancel uploads still running and free blob: URLs.
  useEffect(() => {
    const running = handles.current;
    const current = itemsRef;
    return () => {
      running.forEach((handle) => handle.abort());
      current.current.forEach((item) => {
        if (item.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(item.previewUrl);
      });
    };
  }, []);

  const update = useCallback((key: string, patch: Partial<UploadItem>) => {
    setItems((list) => list.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }, []);

  /** Add files and start uploading them. Returns a message if some were refused. */
  const addFiles = useCallback(
    (files: File[]): string | null => {
      const inUse = itemsRef.current.filter((i) => i.status !== "error").length;
      const room = Math.max(0, MAX_ATTACHMENTS - inUse);
      const accepted = files.slice(0, room);
      const newItems: UploadItem[] = accepted.map((file) => {
        const problem = validateFile(file, config);
        const isImage = isImageFile(file);
        return {
          key: nextKey(),
          name: file.name,
          size: file.size,
          isImage,
          previewUrl: isImage && !problem ? URL.createObjectURL(file) : null,
          status: problem ? "error" : "uploading",
          progress: 0,
          error: problem,
          warning: null,
          attachment: null,
          ocr: "idle",
        };
      });
      setItems((list) => [...list, ...newItems]);

      newItems.forEach((item, index) => {
        if (item.status !== "uploading") return;
        const handle = uploadFile(accepted[index], (progress) => update(item.key, { progress }));
        handles.current.set(item.key, handle);
        handle.promise
          .then((attachment) =>
            update(item.key, {
              status: "ready",
              progress: 1,
              attachment,
              warning: attachment.status === "error" ? attachment.error : null,
            }),
          )
          .catch((error: unknown) => {
            if (isAbortError(error)) return;
            update(item.key, { status: "error", error: errorMessage(error, "Upload failed.") });
          })
          .finally(() => handles.current.delete(item.key));
      });

      return files.length > accepted.length ? `You can attach up to ${MAX_ATTACHMENTS} files per message.` : null;
    },
    [config, update],
  );

  /** Add files that are already uploaded (e.g. handed over from the OCR tool). */
  const addExisting = useCallback((attachments: Attachment[]) => {
    setItems((list) => [...list, ...attachments.map(itemFromAttachment)]);
  }, []);

  /** Remove a chip: cancel its upload, or delete the unsent file on the server. */
  const remove = useCallback((key: string) => {
    const item = itemsRef.current.find((i) => i.key === key);
    handles.current.get(key)?.abort();
    handles.current.delete(key);
    if (item?.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(item.previewUrl);
    if (item?.attachment) api.del(`/api/files/${item.attachment.id}/`).catch(() => {});
    setItems((list) => list.filter((i) => i.key !== key));
  }, []);

  /**
   * Take all chips out of the composer (while a message is being sent) and
   * return them, so they can be put back if the server refuses the message.
   */
  const detach = useCallback((): UploadItem[] => {
    const current = itemsRef.current;
    setItems([]);
    return current;
  }, []);

  /** Put detached chips back (the message was refused). */
  const restore = useCallback((restored: UploadItem[]) => {
    setItems((list) => [...restored, ...list]);
  }, []);

  /** The message was sent: the files belong to it now; free the previews. */
  const release = useCallback((released: UploadItem[]) => {
    released.forEach((item) => {
      if (item.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(item.previewUrl);
    });
  }, []);

  /** Run OCR on an uploaded file and return the text. */
  const runOcr = useCallback(
    async (key: string): Promise<string> => {
      const item = itemsRef.current.find((i) => i.key === key);
      if (!item?.attachment) throw new Error("not uploaded");
      update(key, { ocr: "running" });
      try {
        const result = await api.post<OcrResult>(`/api/files/${item.attachment.id}/ocr/`, {});
        update(key, { ocr: "done", attachment: result.attachment });
        return result.text;
      } catch (error) {
        update(key, { ocr: "idle" });
        throw error;
      }
    },
    [update],
  );

  const uploading = items.some((i) => i.status === "uploading");
  const ready = items.filter((i) => i.status === "ready" && i.attachment).map((i) => i.attachment as Attachment);

  return { items, addFiles, addExisting, remove, detach, restore, release, runOcr, uploading, ready };
}
