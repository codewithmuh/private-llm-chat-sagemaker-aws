"use client";

/**
 * The models this deployment offers (GET /api/models/), with their GPU
 * status. SageMaker models can be "stopped" (scaled to zero) or "starting";
 * the chat header shows a banner and polls while that is the case.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, errorMessage } from "@/lib/api";
import type { Model } from "@/lib/types";
import { useSession } from "./SessionProvider";

interface ModelsValue {
  models: Model[];
  loaded: boolean;
  error: string | null;
  refresh: () => Promise<Model[]>;
  /** POST /api/models/{id}/wake/: ask the GPU controller to start it. */
  wake: (id: string) => Promise<void>;
  /** The model a new chat uses unless the user picks another one. */
  defaultModelId: string | null;
  getModel: (id: string | null | undefined) => Model | undefined;
}

const ModelsContext = createContext<ModelsValue | null>(null);

export function ModelsProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const [models, setModels] = useState<Model[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await api.get<Model[]>("/api/models/");
      setModels(list);
      setError(null);
      return list;
    } catch (err) {
      setError(errorMessage(err, "Couldn't load the model list."));
      return [];
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    // Initial load; state is only set after the request resolves.
    void refresh();
  }, [refresh]);

  const wake = useCallback(async (id: string) => {
    const res = await api.post<{ status: Model["status"]; status_detail: string }>(`/api/models/${id}/wake/`);
    setModels((list) =>
      list.map((m) => (m.id === id ? { ...m, status: res.status ?? "starting", status_detail: res.status_detail ?? "" } : m)),
    );
  }, []);

  const getModel = useCallback((id: string | null | undefined) => models.find((m) => m.id === id), [models]);

  const defaultModelId = useMemo(() => {
    const preferred = user.preferences.default_model;
    if (preferred && models.some((m) => m.id === preferred)) return preferred;
    return models.find((m) => m.is_default)?.id ?? models[0]?.id ?? null;
  }, [models, user.preferences.default_model]);

  const value = useMemo(
    () => ({ models, loaded, error, refresh, wake, defaultModelId, getModel }),
    [models, loaded, error, refresh, wake, defaultModelId, getModel],
  );

  return <ModelsContext.Provider value={value}>{children}</ModelsContext.Provider>;
}

export function useModels(): ModelsValue {
  const value = useContext(ModelsContext);
  if (!value) throw new Error("useModels must be used inside <ModelsProvider>");
  return value;
}
