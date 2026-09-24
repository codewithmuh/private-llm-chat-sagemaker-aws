"use client";

/**
 * The docs navigation: a sticky sidebar on wide screens, and on phones a bar
 * under the header ("Docs menu · <this page>") that opens the same list.
 */
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, List } from "lucide-react";
import styles from "./docs.module.css";

export interface NavLinkItem {
  href: string;
  label: string;
}

export interface NavGroupItem {
  title: string;
  items: NavLinkItem[];
}

function NavList({ nav, pathname, onNavigate }: { nav: NavGroupItem[]; pathname: string; onNavigate?: () => void }) {
  return (
    <nav aria-label="Documentation">
      {nav.map((group) => (
        <div key={group.title} className={styles.navGroup}>
          <div className={styles.navTitle}>{group.title}</div>
          <ul className={styles.navList}>
            {group.items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={styles.navLink}
                  aria-current={pathname === item.href ? "page" : undefined}
                  onClick={onNavigate}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function DocsSidebar({ nav }: { nav: NavGroupItem[] }) {
  const pathname = usePathname();
  return (
    <aside className={styles.sidebar}>
      <NavList nav={nav} pathname={pathname} />
    </aside>
  );
}

export function DocsMobileNav({ nav }: { nav: NavGroupItem[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // Close the menu when the page changes (adjusting state during render).
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }
  const current = nav.flatMap((g) => g.items).find((i) => i.href === pathname);

  return (
    <div className={styles.mobileNav}>
      <button
        type="button"
        className={styles.mobileToggle}
        aria-expanded={open}
        aria-controls="docs-mobile-menu"
        onClick={() => setOpen((value) => !value)}
      >
        <List size={17} aria-hidden />
        <span>Docs</span>
        <strong>{current?.label ?? "Menu"}</strong>
        <ChevronDown size={17} aria-hidden className={styles.mobileChevron} />
      </button>
      {open && (
        <div id="docs-mobile-menu" className={styles.mobilePanel}>
          <NavList nav={nav} pathname={pathname} onNavigate={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
