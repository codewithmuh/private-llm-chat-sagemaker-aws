"use client";

/**
 * Everything a signed-in user sees. The providers are nested so each one can
 * use the ones above it:
 *
 *   SessionProvider        who is signed in (redirects to /login if nobody)
 *   └ ModelsProvider       GET /api/models/ (+ GPU status)
 *     └ ConversationsProvider   the sidebar list
 *       └ ChatProvider     messages + streaming; survives "/chat" -> "/c/<id>"
 *         └ AppShell       sidebar + main area
 */
import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { ChatProvider } from "@/providers/ChatProvider";
import { ConversationsProvider } from "@/providers/ConversationsProvider";
import { ModelsProvider } from "@/providers/ModelsProvider";
import { SessionProvider } from "@/providers/SessionProvider";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <ModelsProvider>
        <ConversationsProvider>
          <ChatProvider>
            <AppShell>{children}</AppShell>
          </ChatProvider>
        </ConversationsProvider>
      </ModelsProvider>
    </SessionProvider>
  );
}
