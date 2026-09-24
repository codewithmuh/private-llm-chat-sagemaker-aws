/**
 * File upload with a progress bar.
 *
 * `fetch` cannot report upload progress, so uploads use the older
 * XMLHttpRequest API, which has `xhr.upload.onprogress`. The same auth rules
 * apply as for `fetch`: `withCredentials = true` sends the session cookie and
 * the `X-CSRFToken` header carries the CSRF token (see lib/api.ts).
 */
import { apiUrl, csrfHeaders, networkError, toApiError } from "./api";
import type { Attachment } from "./types";

export interface UploadHandle {
  /** Resolves with the saved Attachment, or rejects with an ApiError / AbortError. */
  promise: Promise<Attachment>;
  /** Cancel the upload (the promise rejects with an AbortError). */
  abort: () => void;
}

const abortError = () => new DOMException("Upload cancelled", "AbortError");

export function uploadFile(file: File, onProgress?: (fraction: number) => void): UploadHandle {
  let xhr: XMLHttpRequest | null = null;
  let cancelled = false;

  const promise = (async () => {
    const headers = await csrfHeaders();
    if (cancelled) throw abortError();

    return new Promise<Attachment>((resolve, reject) => {
      const request = new XMLHttpRequest();
      xhr = request;
      request.open("POST", apiUrl("/api/files/"));
      request.withCredentials = true;
      request.setRequestHeader("Accept", "application/json");
      for (const [key, value] of Object.entries(headers)) request.setRequestHeader(key, value);

      request.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress?.(event.loaded / event.total);
      };
      request.onload = () => {
        if (request.status >= 200 && request.status < 300) {
          try {
            resolve(JSON.parse(request.responseText) as Attachment);
          } catch {
            reject(networkError());
          }
          return;
        }
        if (request.status < 200) {
          reject(networkError());
          return;
        }
        // Reuse the fetch error parser by wrapping the body in a Response.
        const body = new Response(request.responseText || null, { status: request.status });
        void toApiError(body).then(reject);
      };
      request.onerror = () => reject(networkError());
      request.onabort = () => reject(abortError());

      // The field name "file" is what POST /api/files/ expects.
      const form = new FormData();
      form.append("file", file, file.name);
      request.send(form);
    });
  })();

  return {
    promise,
    abort: () => {
      cancelled = true;
      xhr?.abort();
    },
  };
}
