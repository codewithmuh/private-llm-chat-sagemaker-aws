"use client";

/**
 * One conversation: header with the model picker, GPU status banner,
 * messages, and the composer. Used by both "/" (conversationId = null, a new
 * chat) and "/c/[id]".
 */
import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { errorMessage, isApiError } from "@/lib/api";
import type { Attachment } from "@/lib/types";
import { useChatActions, useThread } from "@/providers/ChatProvider";
import { useConversations } from "@/providers/ConversationsProvider";
import { useModels } from "@/providers/ModelsProvider";
import { PageHeader } from "./ChatHeader";
import { Composer, type ComposerHandle } from "./Composer";
import { EmptyState } from "./EmptyState";
import { MessageList } from "./MessageList";
import { ModelBanner } from "./ModelBanner";
import { ModelPicker } from "./ModelPicker";
import styles from "./ChatView.module.css";

export function ChatView({ conversationId: routeId }: { conversationId: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const actions = useChatActions();
  const { conversations, update } = useConversations();
  const { defaultModelId, getModel } = useModels();
  const composerRef = useRef<ComposerHandle>(null);

  // On "/", the conversation is created by the first send. We show it right
  // away (createdId) while the URL changes to /c/<id> in the background.
  const [createdId, setCreatedId] = useState<string | null>(null);
  const conversationId = routeId ?? createdId;
  const thread = useThread(conversationId);
  const conversation = conversations.find((c) => c.id === conversationId);

  const { loadThread, send, stop, regenerate, dismissError, newChatModel, setNewChatModel } = actions;
  // A send was refused with 503 model_starting: when the model turns ready,
  // the banner says "press Send again" (we never re-send on our own).
  const [awaitingModel, setAwaitingModel] = useState(false);

  useEffect(() => {
    if (routeId) loadThread(routeId);
  }, [routeId, loadThread]);

  useDocumentTitle(conversation?.title || (conversationId ? "Chat" : "New chat"));

  // Which model answers: the conversation's, or for a new chat the one picked
  // on this screen, falling back to the user's / deployment's default.
  const modelId = (conversationId ? conversation?.model : newChatModel) ?? defaultModelId;
  const model = getModel(modelId);
  const busy = thread?.streaming ?? false;

  const selectModel = (id: string) => {
    if (conversationId) void update(conversationId, { model: id });
    else setNewChatModel(id);
  };

  const onSend = useCallback(
    async (content: string, attachments: Attachment[]) => {
      let exists = conversationId !== null;
      try {
        const id = await send(conversationId, {
          content,
          attachments,
          model: modelId,
          onCreated: (newId) => {
            exists = true;
            setCreatedId(newId); // later sends from this screen reuse it
          },
        });
        setAwaitingModel(false);
        // replace (not push): Back shouldn't return to an empty "new chat".
        if (!routeId) router.replace(`/c/${id}`);
        return true;
      } catch (error) {
        // Returning false puts the text and files back in the composer.
        if (isApiError(error) && error.code === "model_starting") {
          setAwaitingModel(true);
          const wait = error.retryAfter ? ` (about ${Math.max(1, Math.round(error.retryAfter / 60))} min)` : "";
          toast.info(
            `The model is starting up${wait}. Your message is still in the box; send it again once it's ready.`,
          );
        } else if (!exists) {
          toast.error(errorMessage(error, "Couldn't start a new chat."));
        }
        // Other refusals are shown in the thread by the chat store.
        return false;
      }
    },
    [send, conversationId, routeId, modelId, router, toast],
  );

  const onStop = useCallback(() => {
    if (conversationId) stop(conversationId);
  }, [stop, conversationId]);

  const onRegenerate = useCallback(() => {
    if (conversationId) regenerate(conversationId, modelId);
  }, [regenerate, conversationId, modelId]);

  const onDismissError = useCallback(() => {
    if (conversationId) dismissError(conversationId);
  }, [dismissError, conversationId]);

  const modelName = useCallback((id: string | null) => getModel(id)?.name ?? id ?? undefined, [getModel]);

  /* ---- drag and drop files anywhere on the chat ---- */
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0); // dragenter/leave fire for every child element
  const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes("Files");
  const onDragEnter = (event: DragEvent) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  };
  const onDragLeave = (event: DragEvent) => {
    if (!hasFiles(event)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };
  const onDrop = (event: DragEvent) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    composerRef.current?.addFiles(Array.from(event.dataTransfer.files));
  };

  /* ---- what goes in the middle ---- */
  let body;
  if (thread?.status === "loading" && thread.messages.length === 0) {
    body = (
      <div className={styles.center} aria-busy="true">
        <span className="spinner spinner-lg" aria-label="Loading chat" />
      </div>
    );
  } else if (thread?.status === "error") {
    body = (
      <div className={styles.center}>
        <p>{thread.loadError}</p>
        <div className={styles.row}>
          {conversationId && (
            <button type="button" className="btn btn-secondary" onClick={() => loadThread(conversationId, true)}>
              Try again
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={() => router.push("/")}>
            New chat
          </button>
        </div>
      </div>
    );
  } else {
    body = (
      <MessageList
        messages={thread?.messages ?? []}
        busy={busy}
        sendError={thread?.sendError ?? null}
        onRegenerate={onRegenerate}
        onDismissError={onDismissError}
        modelName={modelName}
        empty={<EmptyState onPick={(prompt) => composerRef.current?.setText(prompt)} />}
      />
    );
  }

  return (
    <div
      className={styles.chat}
      onDragEnter={onDragEnter}
      onDragOver={(event) => hasFiles(event) && event.preventDefault()}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <PageHeader>
        <ModelPicker value={modelId} onChange={selectModel} />
      </PageHeader>
      <ModelBanner model={model} awaitingSend={awaitingModel} />

      {body}

      <div className={styles.composerArea}>
        <Composer
          ref={composerRef}
          conversationId={conversationId}
          model={model}
          streaming={busy}
          onSend={onSend}
          onStop={onStop}
        />
        <p className={styles.disclaimer}>Runs privately on your own infrastructure. Answers can be wrong.</p>
      </div>

      {dragging && (
        <div className={styles.dropOverlay} aria-hidden>
          <div className={styles.dropCard}>
            <Upload size={28} aria-hidden />
            <strong>Drop files to attach</strong>
            <span>Images, PDFs and documents</span>
          </div>
        </div>
      )}
    </div>
  );
}
