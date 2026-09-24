"use client";

import type { ReactNode } from "react";
import { Menu as MenuIcon, PanelLeftOpen, SquarePen } from "lucide-react";
import { useShell } from "@/components/shell/AppShell";
import styles from "./ChatHeader.module.css";

/**
 * The top bar of the main area. Shows the sidebar toggle when the sidebar is
 * hidden, whatever `children` the page puts in the middle (the model picker,
 * a page title…) and a New chat button when the sidebar can't show one.
 */
export function PageHeader({ children }: { children?: ReactNode }) {
  const { sidebarVisible, toggleSidebar, isMobile, newChat } = useShell();
  return (
    <header className={styles.header}>
      {!sidebarVisible && (
        <button
          type="button"
          className="icon-btn"
          onClick={toggleSidebar}
          aria-label="Open sidebar"
          title="Open sidebar"
        >
          {isMobile ? <MenuIcon size={20} aria-hidden /> : <PanelLeftOpen size={20} aria-hidden />}
        </button>
      )}
      <div className={styles.middle}>{children}</div>
      {!sidebarVisible && (
        <button type="button" className="icon-btn" onClick={newChat} aria-label="New chat" title="New chat">
          <SquarePen size={20} aria-hidden />
        </button>
      )}
    </header>
  );
}
