"use client";

import { useParams } from "next/navigation";
import { ChatView } from "@/components/chat/ChatView";

/** "/c/<id>": an existing conversation. */
export default function ConversationPage() {
  const { id } = useParams<{ id: string }>();
  // key: a different conversation gets a fresh ChatView (and an empty composer).
  return <ChatView key={id} conversationId={id} />;
}
