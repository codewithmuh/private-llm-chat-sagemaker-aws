"use client";

import { ChatView } from "@/components/chat/ChatView";

/** "/": a new, empty chat. The conversation is created by the first message. */
export default function NewChatPage() {
  return <ChatView conversationId={null} />;
}
