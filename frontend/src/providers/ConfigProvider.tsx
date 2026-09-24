"use client";

/**
 * Runtime configuration from GET /api/config/ (app name, Google client id,
 * upload limits…). Fetched once per page load, so one web image works in
 * every environment without rebuilding.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import type { AppConfig } from "@/lib/types";

/** Used until the real config arrives (and if the API can't be reached). */
export const DEFAULT_CONFIG: AppConfig = {
  app_name: "Private LLM Chat",
  google_client_id: null,
  signup_enabled: true,
  email_verification: "mandatory",
  max_upload_mb: 20,
  accepted_file_types: [".pdf", ".docx", ".txt", ".md", ".csv", ".json", ".png", ".jpg", ".jpeg", ".webp", ".gif"],
};

interface ConfigValue {
  config: AppConfig;
  /** True once /api/config/ answered (or failed). */
  loaded: boolean;
}

const ConfigContext = createContext<ConfigValue>({ config: DEFAULT_CONFIG, loaded: false });

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<ConfigValue>({ config: DEFAULT_CONFIG, loaded: false });

  useEffect(() => {
    let cancelled = false;
    api
      .get<AppConfig>("/api/config/")
      .then((config) => {
        if (!cancelled) setValue({ config: { ...DEFAULT_CONFIG, ...config }, loaded: true });
      })
      .catch(() => {
        if (!cancelled) setValue({ config: DEFAULT_CONFIG, loaded: true });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}

export function useConfig(): ConfigValue {
  return useContext(ConfigContext);
}
