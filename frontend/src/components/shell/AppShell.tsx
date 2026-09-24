"use client";

/**
 * Sidebar + main area.
 *
 * Wide screens: the sidebar sits beside the content and can be collapsed
 * (remembered in localStorage). Under 768px it becomes a drawer that slides
 * over the content and closes after you pick a chat.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { readLocal, writeLocal } from "@/lib/storage";
import { Sidebar } from "./Sidebar";
import styles from "./AppShell.module.css";

interface ShellValue {
  /** Is the sidebar showing right now (desktop: not collapsed; mobile: drawer open)? */
  sidebarVisible: boolean;
  toggleSidebar: () => void;
  isMobile: boolean;
  /** Start a new chat (sidebar button, header button, Ctrl/Cmd+Shift+O). */
  newChat: () => void;
  /**
   * Changes on every newChat(). The "/" page uses it as a React key, so
   * "New chat" gives a fresh screen even when you are already on "/".
   */
  newChatKey: number;
}

const ShellContext = createContext<ShellValue | null>(null);
const COLLAPSED_KEY = "llmchat:sidebar-collapsed";

/** Asks the composer on the new-chat page to take focus. */
export const FOCUS_COMPOSER_EVENT = "llmchat:focus-composer";

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const isMobile = useMediaQuery("(max-width: 767px)");
  // The shell only renders after the session loaded (client side), so
  // reading localStorage in the initializer can't cause a hydration mismatch.
  const [collapsed, setCollapsed] = useState(() => readLocal(COLLAPSED_KEY) === "1");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [newChatKey, setNewChatKey] = useState(0);

  const toggleSidebar = useCallback(() => {
    if (isMobile) {
      setDrawerOpen((open) => !open);
      return;
    }
    setCollapsed((value) => {
      writeLocal(COLLAPSED_KEY, value ? "0" : "1");
      return !value;
    });
  }, [isMobile]);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  const newChat = useCallback(() => {
    setDrawerOpen(false);
    setNewChatKey((n) => n + 1);
    router.push("/");
    window.dispatchEvent(new Event(FOCUS_COMPOSER_EVENT));
  }, [router]);

  // Keyboard: Ctrl/Cmd+Shift+O = new chat, Escape closes the drawer.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "o") {
        event.preventDefault();
        newChat();
      } else if (event.key === "Escape" && drawerOpen) {
        setDrawerOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [newChat, drawerOpen]);

  // Close the mobile drawer whenever the page changes (e.g. Settings from the
  // user menu). Done during render: React's pattern for "reset state when a
  // value changes", no effect needed.
  const pathname = usePathname();
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setDrawerOpen(false);
  }

  const sidebarVisible = isMobile ? drawerOpen : !collapsed;
  const value = useMemo(
    () => ({ sidebarVisible, toggleSidebar, isMobile, newChat, newChatKey }),
    [sidebarVisible, toggleSidebar, isMobile, newChat, newChatKey],
  );

  return (
    <ShellContext.Provider value={value}>
      <div
        className={styles.shell}
        data-collapsed={(!isMobile && collapsed) || undefined}
        data-drawer-open={(isMobile && drawerOpen) || undefined}
      >
        <Sidebar hidden={!sidebarVisible} onNavigate={isMobile ? closeDrawer : undefined} />
        {isMobile && drawerOpen && <div className={styles.backdrop} onClick={closeDrawer} aria-hidden />}
        <main className={styles.main}>{children}</main>
      </div>
    </ShellContext.Provider>
  );
}

export function useShell(): ShellValue {
  const value = useContext(ShellContext);
  if (!value) throw new Error("useShell must be used inside <AppShell>");
  return value;
}
