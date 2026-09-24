"use client";

import { useState } from "react";
import Link from "next/link";
import { PanelLeftClose, ScanText, Search, SquarePen, X } from "lucide-react";
import { LogoMark } from "@/components/ui/Logo";
import { useConfig } from "@/providers/ConfigProvider";
import { useShell } from "./AppShell";
import { ConversationList } from "./ConversationList";
import { UserMenu } from "./UserMenu";
import styles from "./Sidebar.module.css";

interface SidebarProps {
  /** Off-screen (collapsed / drawer closed): also made `inert` so Tab skips it. */
  hidden: boolean;
  /** Called after a navigation from inside the sidebar (closes the mobile drawer). */
  onNavigate?: () => void;
}

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);

export function Sidebar({ hidden, onNavigate }: SidebarProps) {
  const { config } = useConfig();
  const { toggleSidebar, newChat, isMobile } = useShell();
  const [query, setQuery] = useState("");
  const shortcut = isMac() ? "⌘ ⇧ O" : "Ctrl ⇧ O";

  return (
    <aside className={styles.sidebar} data-hidden={hidden || undefined} inert={hidden} aria-label="Sidebar">
      <div className={styles.top}>
        <Link href="/" className={styles.brand} onClick={onNavigate}>
          <LogoMark size={26} />
          <span className={styles.brandName}>{config.app_name}</span>
        </Link>
        <button
          type="button"
          className="icon-btn"
          onClick={toggleSidebar}
          aria-label="Close sidebar"
          title="Close sidebar"
        >
          {isMobile ? <X size={20} aria-hidden /> : <PanelLeftClose size={20} aria-hidden />}
        </button>
      </div>

      <div className={styles.actions}>
        <button type="button" className={styles.action} onClick={newChat}>
          <SquarePen size={18} aria-hidden />
          <span>New chat</span>
          <kbd className={styles.kbd} aria-label={`Shortcut ${shortcut}`}>
            {shortcut}
          </kbd>
        </button>
        <Link href="/ocr" className={styles.action} onClick={onNavigate}>
          <ScanText size={18} aria-hidden />
          <span>OCR tool</span>
        </Link>
      </div>

      <div className={styles.search}>
        <Search size={16} aria-hidden className={styles.searchIcon} />
        <input
          type="search"
          className={styles.searchInput}
          placeholder="Search chats"
          aria-label="Search chats"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <ConversationList query={query} onNavigate={onNavigate} />

      <div className={styles.bottom}>
        <UserMenu />
      </div>
    </aside>
  );
}
