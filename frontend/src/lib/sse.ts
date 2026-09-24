/**
 * POST + Server-Sent Events.
 *
 * The browser's built-in `EventSource` can only do GET requests without a
 * body, but sending a chat message is a POST with JSON. So we POST with
 * `fetch` and parse the event stream from the response body ourselves.
 *
 * The SSE wire format is simple text. Events are separated by a blank line;
 * each line inside an event is `field: value`:
 *
 *     event: delta
 *     data: {"content": "Hello"}
 *
 *     : keep-alive          <- a comment (starts with ":"), ignored
 *
 * If the request fails validation before streaming starts, the server
 * answers with a normal JSON error instead (e.g. 503 model_starting). That
 * becomes a thrown ApiError, exactly like any other API call, and `onOpen`
 * is never called.
 *
 * Cancelling: pass an AbortSignal. Aborting closes the connection and makes
 * this function throw an AbortError (check with `isAbortError`).
 */
import { rawRequest } from "./api";

export interface SseEvent {
  event: string;
  data: string;
}

/** Parse one raw event block (the text between two blank lines). */
function parseBlock(block: string): SseEvent | null {
  let event = "message";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line === "" || line.startsWith(":")) continue; // keep-alive comment
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    // A single space after the colon is part of the syntax, not the value.
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  }
  if (data.length === 0) return null;
  return { event, data: data.join("\n") };
}

/**
 * POST `body` to `path` and call `onEvent` for every event in the stream.
 * Resolves when the server closes the stream.
 */
export async function postEventStream(
  path: string,
  body: unknown,
  onEvent: (event: SseEvent) => void,
  signal?: AbortSignal,
  /** Called once the server accepted the request and the stream is open. */
  onOpen?: () => void,
): Promise<void> {
  const res = await rawRequest("POST", path, body, { signal, accept: "text/event-stream" });
  onOpen?.();
  if (!res.body) return;

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      // Normalise line endings so "\r\n\r\n" also separates events.
      buffer += value.replace(/\r\n?/g, "\n");
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const event = parseBlock(block);
        if (event) onEvent(event);
      }
    }
    // A final event without the trailing blank line.
    const last = parseBlock(buffer.replace(/\n+$/, ""));
    if (last) onEvent(last);
  } finally {
    reader.releaseLock();
  }
}
