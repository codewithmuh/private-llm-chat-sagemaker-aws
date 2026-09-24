"use client";

/**
 * The chat store: messages of every open conversation, and the streaming
 * logic that sends a message and reads the answer token by token.
 *
 * WHY A STORE ABOVE THE PAGES
 * This provider sits in app/(app)/layout.tsx, which stays mounted while the
 * user moves between "/chat" and "/c/[id]". That is what makes the new-chat flow
 * work: on the first message from "/chat" we create the conversation, start the
 * stream here, and only then change the URL to /c/<id>. The page swaps, but
 * the stream keeps writing into this store, so nothing is lost or refetched.
 *
 * SENDING, STEP BY STEP
 *   1. The user's message appears at once (an optimistic "local-…" message)
 *      with an empty assistant message after it.
 *   2. POST /api/conversations/{id}/messages/. If the server refuses before
 *      streaming (400, 404, 503 model_starting…) nothing was saved: we remove
 *      both local messages and `send()` rejects, so the composer can put the
 *      text and files back.
 *   3. Otherwise `send()` resolves as soon as the stream opens, and the
 *      events keep arriving in the background:
 *        start -> the saved user message + the empty assistant message
 *        delta -> a piece of text to append
 *        done  -> the final saved assistant message
 *        error -> replaces `done`; the assistant message has status "error"
 *        title -> the conversation got a generated title
 *
 * Deltas are buffered and applied once per animation frame, so a fast model
 * doesn't re-render (and re-parse the Markdown) hundreds of times a second.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api, errorMessage, isAbortError, isApiError } from "@/lib/api";
import { postEventStream, type SseEvent } from "@/lib/sse";
import type { Attachment, ChatStreamEvent, ConversationDetail, Message } from "@/lib/types";
import { useConversations } from "./ConversationsProvider";
import { useModels } from "./ModelsProvider";

/* ================================================================= state */

/** A request that failed before streaming started, shown in the thread. */
export interface SendError {
  message: string;
  code: string;
  /** Offer a Retry button (only for Regenerate; a failed send goes back to the composer). */
  canRetry: boolean;
}

export interface Thread {
  status: "loading" | "ready" | "error";
  loadError: string | null;
  messages: Message[];
  streaming: boolean;
  sendError: SendError | null;
}

type Threads = Record<string, Thread>;

type Action =
  | { type: "load-start"; id: string }
  | { type: "load-ok"; id: string; messages: Message[] }
  | { type: "load-error"; id: string; error: string }
  | { type: "init"; id: string }
  | { type: "add"; id: string; messages: Message[] }
  | { type: "replace"; id: string; messageId: string; message: Message }
  | { type: "patch"; id: string; messageId: string; patch: Partial<Message> }
  | { type: "append"; id: string; messageId: string; text: string }
  | { type: "remove"; id: string; messageIds: string[] }
  | { type: "streaming"; id: string; streaming: boolean }
  | { type: "send-error"; id: string; error: SendError | null }
  | { type: "drop"; id: string }
  | { type: "reset" };

const emptyThread = (status: Thread["status"]): Thread => ({
  status,
  loadError: null,
  messages: [],
  streaming: false,
  sendError: null,
});

function updateThread(state: Threads, id: string, fn: (thread: Thread) => Thread): Threads {
  const thread = state[id];
  if (!thread) return state;
  return { ...state, [id]: fn(thread) };
}

const mapMessages = (thread: Thread, messageId: string, fn: (m: Message) => Message): Thread => ({
  ...thread,
  messages: thread.messages.map((m) => (m.id === messageId ? fn(m) : m)),
});

function reducer(state: Threads, action: Action): Threads {
  switch (action.type) {
    case "load-start":
      return { ...state, [action.id]: { ...(state[action.id] ?? emptyThread("loading")), status: "loading" } };
    case "load-ok":
      return {
        ...state,
        [action.id]: {
          ...(state[action.id] ?? emptyThread("ready")),
          status: "ready",
          loadError: null,
          messages: action.messages,
        },
      };
    case "load-error":
      return { ...state, [action.id]: { ...emptyThread("error"), loadError: action.error } };
    case "init":
      return state[action.id] ? state : { ...state, [action.id]: emptyThread("ready") };
    case "add":
      return updateThread(state, action.id, (t) => ({ ...t, messages: [...t.messages, ...action.messages] }));
    case "replace":
      return updateThread(state, action.id, (t) => mapMessages(t, action.messageId, () => action.message));
    case "patch":
      return updateThread(state, action.id, (t) =>
        mapMessages(t, action.messageId, (m) => ({ ...m, ...action.patch })),
      );
    case "append":
      return updateThread(state, action.id, (t) =>
        mapMessages(t, action.messageId, (m) => ({ ...m, content: m.content + action.text })),
      );
    case "remove":
      return updateThread(state, action.id, (t) => ({
        ...t,
        messages: t.messages.filter((m) => !action.messageIds.includes(m.id)),
      }));
    case "streaming":
      return updateThread(state, action.id, (t) => ({ ...t, streaming: action.streaming }));
    case "send-error":
      return updateThread(state, action.id, (t) => ({ ...t, sendError: action.error }));
    case "drop": {
      const next = { ...state };
      delete next[action.id];
      return next;
    }
    case "reset":
      return {};
  }
}

/* =============================================================== context */

export interface SendInput {
  content: string;
  attachments: Attachment[];
  model: string | null;
  /** Called as soon as a new conversation exists (only when conversationId was null). */
  onCreated?: (id: string) => void;
}

interface ChatActions {
  /** Fetch a conversation's messages (once, unless `force`). */
  loadThread: (id: string, force?: boolean) => void;
  /**
   * Send a message; with `conversationId = null` a conversation is created
   * first. Resolves with the conversation id once the server ACCEPTED the
   * message (the stream opened); the answer keeps streaming into the store.
   * Rejects with an ApiError if it was refused and nothing was saved.
   */
  send: (conversationId: string | null, input: SendInput) => Promise<string>;
  /** Answer the last user message again. Errors are shown in the thread. */
  regenerate: (conversationId: string, model: string | null) => void;
  stop: (conversationId: string) => void;
  dismissError: (conversationId: string) => void;
  /** Forget local state after a conversation (or all: null) was deleted. */
  forget: (conversationId: string | null) => void;
  /** The model picked on the "new chat" screen (null = the default). */
  newChatModel: string | null;
  setNewChatModel: (id: string | null) => void;
}

const ThreadsContext = createContext<Threads>({});
const ActionsContext = createContext<ChatActions | null>(null);
const StreamingContext = createContext<string[]>([]);

let localCounter = 0;
function localMessage(
  role: Message["role"],
  content: string,
  attachments: Attachment[],
  model: string | null,
): Message {
  localCounter += 1;
  return {
    id: `local-${role}-${localCounter}`,
    role,
    content,
    model,
    status: role === "assistant" ? "streaming" : "complete",
    error: null,
    attachments,
    usage: null,
    duration_ms: null,
    created_at: new Date().toISOString(),
  };
}

function parseStreamEvent(raw: SseEvent): ChatStreamEvent | null {
  try {
    return { event: raw.event, data: JSON.parse(raw.data) } as ChatStreamEvent;
  } catch {
    return null; // not JSON: ignore
  }
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const [threads, dispatch] = useReducer(reducer, {});
  const [streamingIds, setStreamingIds] = useState<string[]>([]);
  const [newChatModel, setNewChatModel] = useState<string | null>(null);
  const { create: createConversation, patchLocal, upsert } = useConversations();
  const { refresh: refreshModels } = useModels();

  // Conversations we have loaded / are loading / created in this tab. A ref
  // (not state) so loadThread can check it synchronously.
  const known = useRef(new Set<string>());
  // Running streams: how to cancel them, and the assistant message id the
  // server gave us (needed for POST /api/messages/{id}/stop/).
  const streams = useRef(new Map<string, { controller: AbortController; assistantId: string | null }>());
  // `regenerate` needs the current messages without re-creating callbacks.
  const threadsRef = useRef<Threads>(threads);
  useEffect(() => {
    threadsRef.current = threads;
  }, [threads]);

  // Cancel everything if the provider goes away (e.g. logout).
  useEffect(() => {
    const running = streams.current;
    return () => running.forEach((s) => s.controller.abort());
  }, []);

  const loadThread = useCallback(
    (id: string, force = false) => {
      if (known.current.has(id) && !force) return;
      known.current.add(id);
      if (!force) dispatch({ type: "load-start", id });
      api
        .get<ConversationDetail>(`/api/conversations/${id}/`)
        .then(({ messages, ...conversation }) => {
          upsert(conversation);
          dispatch({ type: "load-ok", id, messages });
        })
        .catch((error: unknown) => {
          known.current.delete(id);
          dispatch({
            type: "load-error",
            id,
            error:
              isApiError(error) && error.status === 404
                ? "This chat doesn't exist or was deleted."
                : errorMessage(error, "Couldn't load this chat."),
          });
        });
    },
    [upsert],
  );

  /**
   * POST to `path` and apply the event stream to conversation `id`.
   * The returned promise settles when the stream OPENS (or is refused);
   * reading the answer continues in the background.
   */
  const startStream = useCallback(
    (id: string, path: string, body: Record<string, unknown>, localUser: Message | null): Promise<void> => {
      const controller = new AbortController();
      const entry = { controller, assistantId: null as string | null };
      streams.current.set(id, entry);
      setStreamingIds((ids) => [...ids.filter((x) => x !== id), id]);

      const placeholder = localMessage("assistant", "", [], typeof body.model === "string" ? body.model : null);
      const localIds = localUser ? [localUser.id, placeholder.id] : [placeholder.id];
      let assistantId = placeholder.id;
      let opened = false;
      let started = false;
      let finished = false;

      dispatch({ type: "send-error", id, error: null });
      dispatch({ type: "add", id, messages: localUser ? [localUser, placeholder] : [placeholder] });
      dispatch({ type: "streaming", id, streaming: true });

      // Buffer deltas and flush them at most once per frame.
      let pending = "";
      let frame = 0;
      const flush = () => {
        frame = 0;
        if (!pending) return;
        dispatch({ type: "append", id, messageId: assistantId, text: pending });
        pending = "";
      };
      const flushNow = () => {
        if (frame) cancelAnimationFrame(frame);
        flush();
      };

      const onEvent = (raw: SseEvent) => {
        const event = parseStreamEvent(raw);
        if (!event) return;
        switch (event.event) {
          case "start": {
            started = true;
            const { user_message, assistant_message } = event.data;
            if (localUser && user_message)
              dispatch({ type: "replace", id, messageId: localUser.id, message: user_message });
            dispatch({ type: "replace", id, messageId: assistantId, message: assistant_message });
            assistantId = assistant_message.id;
            entry.assistantId = assistant_message.id;
            break;
          }
          case "delta":
            pending += event.data.content;
            if (!frame) frame = requestAnimationFrame(flush);
            break;
          case "done":
            flushNow();
            finished = true;
            dispatch({ type: "replace", id, messageId: assistantId, message: event.data.message });
            patchLocal(id, { updated_at: new Date().toISOString() });
            break;
          case "error":
            flushNow();
            finished = true;
            if (event.data.message) {
              dispatch({ type: "replace", id, messageId: assistantId, message: event.data.message });
            } else {
              dispatch({
                type: "patch",
                id,
                messageId: assistantId,
                patch: { status: "error", error: event.data.error },
              });
            }
            if (event.data.code === "model_starting") void refreshModels();
            break;
          case "title":
            patchLocal(event.data.conversation_id, { title: event.data.title });
            break;
        }
      };

      return new Promise<void>((resolveOpened, rejectRefused) => {
        const onOpen = () => {
          opened = true;
          resolveOpened();
        };

        postEventStream(path, body, onEvent, controller.signal, onOpen)
          .then(() => {
            flushNow();
            if (!finished) {
              // The server closed the stream without `done`/`error`.
              dispatch({
                type: "patch",
                id,
                messageId: assistantId,
                patch: { status: "error", error: "The connection closed before the answer finished." },
              });
            }
          })
          .catch((error: unknown) => {
            flushNow();
            if (isAbortError(error)) {
              // The user pressed Stop.
              if (started) {
                dispatch({ type: "patch", id, messageId: assistantId, patch: { status: "stopped" } });
              } else {
                // Stopped before the server answered: we don't know what it
                // saved, so ask it.
                dispatch({ type: "remove", id, messageIds: [placeholder.id] });
                window.setTimeout(() => loadThread(id, true), 600);
              }
              resolveOpened(); // not a refusal: don't hand the text back
            } else if (!opened) {
              // Refused before streaming began: nothing was saved.
              dispatch({ type: "remove", id, messageIds: localIds });
              if (isApiError(error) && error.code === "model_starting") {
                // The GPU banner (which polls) explains this one.
                void refreshModels();
              } else {
                dispatch({
                  type: "send-error",
                  id,
                  error: {
                    message: errorMessage(error),
                    code: isApiError(error) ? error.code : "error",
                    canRetry: false,
                  },
                });
              }
              rejectRefused(error);
            } else {
              dispatch({
                type: "patch",
                id,
                messageId: assistantId,
                patch: { status: "error", error: "The connection was lost while the answer was streaming." },
              });
            }
          })
          .finally(() => {
            streams.current.delete(id);
            dispatch({ type: "streaming", id, streaming: false });
            setStreamingIds((ids) => ids.filter((x) => x !== id));
          });
      });
    },
    [loadThread, patchLocal, refreshModels],
  );

  const send = useCallback(
    async (conversationId: string | null, { content, attachments, model, onCreated }: SendInput) => {
      let id = conversationId;
      if (!id) {
        // New chat: create the conversation first (it needs an id to stream to).
        const conversation = await createConversation({ model });
        id = conversation.id;
        known.current.add(id);
        dispatch({ type: "init", id });
        onCreated?.(id);
      }
      if (streams.current.has(id)) return id; // already answering

      const localUser = localMessage("user", content, attachments, model);
      const body: Record<string, unknown> = { content, attachment_ids: attachments.map((a) => a.id) };
      if (model) body.model = model;
      await startStream(id, `/api/conversations/${id}/messages/`, body, localUser);
      patchLocal(id, { updated_at: new Date().toISOString(), ...(model ? { model } : {}) });
      return id;
    },
    [createConversation, patchLocal, startStream],
  );

  const regenerate = useCallback(
    (conversationId: string, model: string | null) => {
      if (streams.current.has(conversationId)) return;
      // The server deletes the last assistant message; mirror that locally.
      const thread = threadsRef.current[conversationId];
      const last = thread?.messages[thread.messages.length - 1];
      if (last?.role === "assistant") dispatch({ type: "remove", id: conversationId, messageIds: [last.id] });
      startStream(
        conversationId,
        `/api/conversations/${conversationId}/regenerate/`,
        model ? { model } : {},
        null,
      ).catch((error: unknown) => {
        dispatch({
          type: "send-error",
          id: conversationId,
          error: {
            message: errorMessage(error),
            code: isApiError(error) ? error.code : "error",
            canRetry: true,
          },
        });
        // We removed the old answer locally; get the server's version back.
        loadThread(conversationId, true);
      });
    },
    [startStream, loadThread],
  );

  const stop = useCallback((conversationId: string) => {
    const running = streams.current.get(conversationId);
    if (!running) return;
    // Tell the server explicitly (reliable behind proxies), then close our
    // side of the connection, which also stops generation.
    if (running.assistantId) {
      api.post(`/api/messages/${running.assistantId}/stop/`).catch(() => {});
    }
    running.controller.abort();
  }, []);

  const dismissError = useCallback((conversationId: string) => {
    dispatch({ type: "send-error", id: conversationId, error: null });
  }, []);

  const forget = useCallback((conversationId: string | null) => {
    if (conversationId === null) {
      streams.current.forEach((s) => s.controller.abort());
      known.current.clear();
      dispatch({ type: "reset" });
      return;
    }
    streams.current.get(conversationId)?.controller.abort();
    known.current.delete(conversationId);
    dispatch({ type: "drop", id: conversationId });
  }, []);

  const actions = useMemo<ChatActions>(
    () => ({ loadThread, send, regenerate, stop, dismissError, forget, newChatModel, setNewChatModel }),
    [loadThread, send, regenerate, stop, dismissError, forget, newChatModel],
  );

  return (
    <ActionsContext.Provider value={actions}>
      <StreamingContext.Provider value={streamingIds}>
        <ThreadsContext.Provider value={threads}>{children}</ThreadsContext.Provider>
      </StreamingContext.Provider>
    </ActionsContext.Provider>
  );
}

/** Messages & status of one conversation (undefined until loaded). */
export function useThread(conversationId: string | null): Thread | undefined {
  const threads = useContext(ThreadsContext);
  return conversationId ? threads[conversationId] : undefined;
}

export function useChatActions(): ChatActions {
  const value = useContext(ActionsContext);
  if (!value) throw new Error("useChatActions must be used inside <ChatProvider>");
  return value;
}

/** Ids of conversations currently streaming (for the sidebar). */
export function useStreamingIds(): string[] {
  return useContext(StreamingContext);
}
