"use client";

import { memo, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ellipsis, Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import { useConfirm } from "@/components/ui/Confirm";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/Menu";
import type { Conversation } from "@/lib/types";
import { useChatActions } from "@/providers/ChatProvider";
import { useConversations } from "@/providers/ConversationsProvider";
import styles from "./ConversationItem.module.css";

interface ConversationItemProps {
  conversation: Conversation;
  active: boolean;
  streaming: boolean;
  onNavigate?: () => void;
}

export const ConversationItem = memo(function ConversationItem({
  conversation,
  active,
  streaming,
  onNavigate,
}: ConversationItemProps) {
  const router = useRouter();
  const confirm = useConfirm();
  const { update, remove } = useConversations();
  const { forget } = useChatActions();
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const title = conversation.title || "New chat";

  const saveTitle = (value: string) => {
    setEditing(false);
    const next = value.trim();
    if (next && next !== conversation.title) void update(conversation.id, { title: next });
  };

  const onRenameKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      saveTitle(event.currentTarget.value);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation(); // don't also close the mobile drawer
      setEditing(false);
    }
  };

  const onDelete = async () => {
    const ok = await confirm({
      title: "Delete chat?",
      message: (
        <>
          This will permanently delete <strong>{title}</strong> and its messages.
        </>
      ),
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    if (await remove(conversation.id)) {
      forget(conversation.id);
      if (active) router.push("/");
    }
  };

  return (
    <li className={styles.item} data-active={active || undefined} data-menu-open={menuOpen || undefined}>
      {editing ? (
        <input
          className={styles.rename}
          defaultValue={conversation.title}
          aria-label="Chat title"
          maxLength={200}
          autoFocus
          onFocus={(event) => event.currentTarget.select()}
          onKeyDown={onRenameKey}
          onBlur={(event) => saveTitle(event.currentTarget.value)}
        />
      ) : (
        <>
          <Link
            href={`/c/${conversation.id}`}
            className={styles.link}
            aria-current={active ? "page" : undefined}
            onClick={onNavigate}
            title={title}
          >
            {conversation.pinned && <Pin size={13} aria-label="Pinned" className={styles.pin} />}
            <span className={styles.title}>{title}</span>
            {streaming && <span className={`spinner ${styles.spinner}`} aria-label="Answering" />}
          </Link>
          <Menu
            label={`Options for ${title}`}
            buttonLabel={`Options for ${title}`}
            buttonClassName={styles.more}
            button={<Ellipsis size={16} aria-hidden />}
            onOpenChange={setMenuOpen}
          >
            <MenuItem icon={Pencil} onSelect={() => setEditing(true)}>
              Rename
            </MenuItem>
            <MenuItem
              icon={conversation.pinned ? PinOff : Pin}
              onSelect={() => void update(conversation.id, { pinned: !conversation.pinned })}
            >
              {conversation.pinned ? "Unpin" : "Pin"}
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={Trash2} danger onSelect={() => void onDelete()}>
              Delete
            </MenuItem>
          </Menu>
        </>
      )}
    </li>
  );
});
