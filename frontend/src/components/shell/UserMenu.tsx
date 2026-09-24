"use client";

import { BookOpen, House, LogOut, Monitor, Moon, ScanText, Settings, Shield, Sun } from "lucide-react";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "@/components/ui/Menu";
import { API_BASE } from "@/lib/api";
import { initial } from "@/lib/format";
import { useSession } from "@/providers/SessionProvider";
import { useTheme } from "@/providers/ThemeProvider";
import styles from "./UserMenu.module.css";

export function UserMenu() {
  const { user, setThemeAndSave, logout } = useSession();
  const { theme } = useTheme();
  const displayName = user.name || user.email;

  return (
    <Menu
      label="Account"
      side="top"
      buttonClassName={styles.button}
      className={styles.panel}
      button={
        <>
          <Avatar name={displayName} url={user.avatar_url} />
          <span className={styles.text}>
            <span className={styles.name}>{displayName}</span>
            {user.name && <span className={styles.email}>{user.email}</span>}
          </span>
        </>
      }
    >
      <MenuItem icon={Settings} href="/settings">
        Settings
      </MenuItem>
      <MenuItem icon={ScanText} href="/ocr">
        OCR tool
      </MenuItem>
      <MenuItem icon={BookOpen} href="/docs">
        Docs
      </MenuItem>
      <MenuItem icon={House} href="/">
        Home
      </MenuItem>
      {user.is_staff && (
        // Django admin is served by the API (same origin in production).
        <MenuItem icon={Shield} href={`${API_BASE}/admin/`} external>
          Admin
        </MenuItem>
      )}
      <MenuSeparator />
      <MenuLabel>Theme</MenuLabel>
      <MenuItem icon={Monitor} checked={theme === "system"} onSelect={() => setThemeAndSave("system")}>
        System
      </MenuItem>
      <MenuItem icon={Sun} checked={theme === "light"} onSelect={() => setThemeAndSave("light")}>
        Light
      </MenuItem>
      <MenuItem icon={Moon} checked={theme === "dark"} onSelect={() => setThemeAndSave("dark")}>
        Dark
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon={LogOut} onSelect={() => void logout()}>
        Log out
      </MenuItem>
    </Menu>
  );
}

export function Avatar({ name, url, size = 30 }: { name: string; url: string | null; size?: number }) {
  if (url) {
    return (
      // A tiny remote avatar (e.g. Google): next/image would add nothing here.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt="" width={size} height={size} className={styles.avatar} referrerPolicy="no-referrer" />
    );
  }
  return (
    <span className={styles.avatar} style={{ width: size, height: size }} aria-hidden>
      {initial(name)}
    </span>
  );
}
