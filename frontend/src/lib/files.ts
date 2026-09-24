/** Client-side checks run before an upload, using limits from /api/config/. */
import type { AppConfig } from "./types";
import { formatBytes } from "./format";

export const MAX_ATTACHMENTS = 10;

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif"];

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot).toLowerCase() : "";
}

export function isImageFile(file: { name: string; type: string }): boolean {
  return file.type.startsWith("image/") || IMAGE_EXTENSIONS.includes(extensionOf(file.name));
}

/**
 * Returns a human readable reason the file can't be uploaded, or null if it
 * looks fine. The server checks again; this just saves a pointless upload.
 */
export function validateFile(file: File, config: Pick<AppConfig, "max_upload_mb" | "accepted_file_types">): string | null {
  const maxBytes = config.max_upload_mb * 1024 * 1024;
  if (file.size > maxBytes) {
    return `Too large (${formatBytes(file.size)}). The limit is ${config.max_upload_mb} MB.`;
  }
  const accepted = config.accepted_file_types.map((t) => t.toLowerCase());
  if (accepted.length > 0) {
    const ext = extensionOf(file.name);
    // Pasted screenshots are often called "image.png"; also allow by MIME type.
    const mimeOk = accepted.some((t) => t.includes("/") && (t === file.type || (t.endsWith("/*") && file.type.startsWith(t.slice(0, -1)))));
    if (!accepted.includes(ext) && !mimeOk) {
      return `Unsupported file type${ext ? ` (${ext})` : ""}.`;
    }
  }
  return null;
}

/** Give a pasted clipboard image (always named "image.png") a nicer name. */
export function renamePastedFile(file: File, index: number): File {
  if (file.name && file.name !== "image.png") return file;
  const ext = file.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return new File([file], `pasted-${stamp}${index ? `-${index}` : ""}.${ext}`, { type: file.type });
}
