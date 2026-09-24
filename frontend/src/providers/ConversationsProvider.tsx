"use client";

/**
 * The sidebar's conversation list (GET /api/conversations/) and the actions
 * that change it. Changes are applied optimistically (the UI updates at once)
 * and rolled back with a toast if the server refuses.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, errorMessage } from "@/lib/api";
import type { Conversation } from "@/lib/types";
import { useToast } from "@/components/ui/Toast";

export type ConversationPatch = Partial<Pick<Conversation, "title" | "model" | "pinned" | "system_prompt">>;

interface ConversationsValue {
  conversations: Conversation[];
  loaded: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  create: (body: { model?: string | null; title?: string }) => Promise<Conversation>;
  update: (id: string, patch: ConversationPatch) => Promise<Conversation | null>;
  remove: (id: string) => Promise<boolean>;
  removeAll: () => Promise<boolean>;
  /** Add or replace one conversation in the list (no request). */
  upsert: (conversation: Conversation) => void;
  /** Change fields locally only (e.g. a title that arrived on the stream). */
  patchLocal: (id: string, patch: Partial<Conversation>) => void;
}

const ConversationsContext = createContext<ConversationsValue | null>(null);

export function ConversationsProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A copy of the latest list for rollbacks inside async callbacks.
  const latest = useRef<Conversation[]>([]);

  useEffect(() => {
    latest.current = conversations;
  }, [conversations]);

  const refresh = useCallback(
    () =>
      api.get<{ results: Conversation[] }>("/api/conversations/").then(
        (res) => {
          setConversations(res.results);
          setError(null);
          setLoaded(true);
        },
        (err: unknown) => {
          setError(errorMessage(err, "Couldn't load your chats."));
          setLoaded(true);
        },
      ),
    [],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const upsert = useCallback((conversation: Conversation) => {
    setConversations((list) =>
      list.some((c) => c.id === conversation.id)
        ? list.map((c) => (c.id === conversation.id ? conversation : c))
        : [conversation, ...list],
    );
  }, []);

  const patchLocal = useCallback((id: string, patch: Partial<Conversation>) => {
    setConversations((list) => list.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }, []);

  const create = useCallback(
    async (body: { model?: string | null; title?: string }) => {
      const payload: Record<string, string> = {};
      if (body.model) payload.model = body.model;
      if (body.title) payload.title = body.title;
      const conversation = await api.post<Conversation>("/api/conversations/", payload);
      upsert(conversation);
      return conversation;
    },
    [upsert],
  );

  const update = useCallback(
    async (id: string, patch: ConversationPatch) => {
      const before = latest.current.find((c) => c.id === id);
      patchLocal(id, patch);
      try {
        const saved = await api.patch<Conversation>(`/api/conversations/${id}/`, patch);
        upsert(saved);
        return saved;
      } catch (err) {
        if (before) upsert(before);
        toast.error(errorMessage(err, "Couldn't update the chat."));
        return null;
      }
    },
    [patchLocal, upsert, toast],
  );

  const remove = useCallback(
    async (id: string) => {
      const before = latest.current;
      setConversations((list) => list.filter((c) => c.id !== id));
      try {
        await api.del(`/api/conversations/${id}/`);
        return true;
      } catch (err) {
        setConversations(before);
        toast.error(errorMessage(err, "Couldn't delete the chat."));
        return false;
      }
    },
    [toast],
  );

  const removeAll = useCallback(async () => {
    try {
      await api.del("/api/conversations/");
      setConversations([]);
      return true;
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't delete your chats."));
      return false;
    }
  }, [toast]);

  const value = useMemo(
    () => ({ conversations, loaded, error, refresh, create, update, remove, removeAll, upsert, patchLocal }),
    [conversations, loaded, error, refresh, create, update, remove, removeAll, upsert, patchLocal],
  );

  return <ConversationsContext.Provider value={value}>{children}</ConversationsContext.Provider>;
}

export function useConversations(): ConversationsValue {
  const value = useContext(ConversationsContext);
  if (!value) throw new Error("useConversations must be used inside <ConversationsProvider>");
  return value;
}
