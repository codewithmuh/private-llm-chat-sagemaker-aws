"use client";

import { useEffect } from "react";
import { useConfig } from "@/providers/ConfigProvider";

/** Sets the browser tab title to "<title> · <app name>". */
export function useDocumentTitle(title: string | null | undefined): void {
  const { config } = useConfig();
  useEffect(() => {
    document.title = title ? `${title} · ${config.app_name}` : config.app_name;
  }, [title, config.app_name]);
}
