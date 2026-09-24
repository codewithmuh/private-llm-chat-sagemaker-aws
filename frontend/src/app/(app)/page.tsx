"use client";

import { ChatView } from "@/components/chat/ChatView";
import { useShell } from "@/components/shell/AppShell";

/** "/": a new, empty chat. The conversation is created by the first message. */
export default function NewChatPage() {
  const { newChatKey } = useShell();
  return <ChatView key={newChatKey} conversationId={null} />;
}
