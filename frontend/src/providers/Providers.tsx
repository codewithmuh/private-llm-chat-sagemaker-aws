"use client";

import type { ReactNode } from "react";
import { ConfirmProvider } from "@/components/ui/Confirm";
import { ToastProvider } from "@/components/ui/Toast";
import { ConfigProvider } from "./ConfigProvider";
import { ThemeProvider } from "./ThemeProvider";

/** Context shared by every page, signed in or not. */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ConfigProvider>
      <ThemeProvider>
        <ToastProvider>
          <ConfirmProvider>{children}</ConfirmProvider>
        </ToastProvider>
      </ThemeProvider>
    </ConfigProvider>
  );
}
