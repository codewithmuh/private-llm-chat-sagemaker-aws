"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import { DATE_GROUPS, dateGroup } from "@/lib/format";
import type { Conversation } from "@/lib/types";
import { useStreamingIds } from "@/providers/ChatProvider";
import { useConversations } from "@/providers/ConversationsProvider";
import { ConversationItem } from "./ConversationItem";
import styles from "./ConversationList.module.css";

interface Group {
  label: string;
  items: Conversation[];
}

const byUpdatedDesc = (a: Conversation, b: Conversation) => b.updated_at.localeCompare(a.updated_at);

/** Pinned first, then Today / Yesterday / Previous 7 days / … */
function groupConversations(conversations: Conversation[], now: Date): Group[] {
  const pinned = conversations.filter((c) => c.pinned).sort(byUpdatedDesc);
  const groups: Group[] = pinned.length ? [{ label: "Pinned", items: pinned }] : [];
  const rest = conversations.filter((c) => !c.pinned).sort(byUpdatedDesc);
  for (const label of DATE_GROUPS) {
    const items = rest.filter((c) => dateGroup(c.updated_at, now) === label);
    if (items.length) groups.push({ label, items });
  }
  return groups;
}

export function ConversationList({ query, onNavigate }: { query: string; onNavigate?: () => void }) {
  const { conversations, loaded, error, refresh } = useConversations();
  const streamingIds = useStreamingIds();
  const params = useParams<{ id?: string }>();
  const activeId = params?.id ?? null;

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? conversations.filter((c) => (c.title || "New chat").toLowerCase().includes(q)) : conversations;
    return groupConversations(filtered, new Date());
  }, [conversations, query]);

  if (!loaded) {
    return (
      <div className={styles.scroll} aria-busy="true">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className={styles.skeleton} style={{ width: `${55 + ((i * 17) % 35)}%` }} />
        ))}
      </div>
    );
  }

  return (
    <nav className={styles.scroll} aria-label="Chats">
      {error && (
        <div className={styles.empty}>
          <p>{error}</p>
          <button type="button" className="btn btn-sm btn-secondary" onClick={() => void refresh()}>
            Retry
          </button>
        </div>
      )}
      {!error && groups.length === 0 && (
        <p className={styles.empty}>{query ? "No chats match your search." : "Your chats will appear here."}</p>
      )}
      {groups.map((group) => (
        <section key={group.label} className={styles.group} aria-label={group.label}>
          <h3 className={styles.groupLabel}>{group.label}</h3>
          <ul className={styles.items}>
            {group.items.map((c) => (
              <ConversationItem
                key={c.id}
                conversation={c}
                active={c.id === activeId}
                streaming={streamingIds.includes(c.id)}
                onNavigate={onNavigate}
              />
            ))}
          </ul>
        </section>
      ))}
    </nav>
  );
}
