"use client";

/**
 * The header of the public pages (landing page and docs).
 *
 * Right side: "Log in" + "Get started", or "Open app" when this browser is
 * signed in. We only ask the API (GET /api/auth/me/) when the browser signed
 * in before (lib/session-hint.ts), so anonymous visitors get no 401 at all.
 * On small screens the section links fold into a menu; "Log in" stays visible.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, Menu, Moon, Sun, X } from "lucide-react";
import { GithubIcon } from "@/components/ui/GithubIcon";
import { LogoMark } from "@/components/ui/Logo";
import { api } from "@/lib/api";
import { APP_HOME } from "@/lib/browser";
import { markSignedOut, maybeSignedIn } from "@/lib/session-hint";
import { GITHUB_URL } from "@/lib/site";
import type { User } from "@/lib/types";
import { useConfig } from "@/providers/ConfigProvider";
import { useTheme } from "@/providers/ThemeProvider";
import styles from "./SiteHeader.module.css";

const NAV = [
  { label: "Features", href: "/#features" },
  { label: "How it works", href: "/#how-it-works" },
  { label: "Architecture", href: "/#architecture" },
  { label: "Models", href: "/#models" },
  { label: "Docs", href: "/docs" },
];

function useSignedIn(): boolean {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    if (!maybeSignedIn()) return;
    let cancelled = false;
    api
      .get<User>("/api/auth/me/")
      .then(() => !cancelled && setSignedIn(true))
      .catch(() => markSignedOut()); // expired: quietly forget
    return () => {
      cancelled = true;
    };
  }, []);
  return signedIn;
}

function ThemeToggle() {
  const { resolved, setTheme } = useTheme();
  const next = resolved === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className="icon-btn"
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
    >
      {resolved === "dark" ? <Sun size={18} aria-hidden /> : <Moon size={18} aria-hidden />}
    </button>
  );
}

export function SiteHeader() {
  const pathname = usePathname();
  const { config } = useConfig();
  const signedIn = useSignedIn();
  const [menuOpen, setMenuOpen] = useState(false);
  // Close the mobile menu when the page changes.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setMenuOpen(false);
  }

  const isActive = (href: string) => href === "/docs" && pathname.startsWith("/docs");

  const links = (
    <>
      {NAV.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={styles.navLink}
          aria-current={isActive(item.href) ? "page" : undefined}
          onClick={() => setMenuOpen(false)}
        >
          {item.label}
        </Link>
      ))}
      <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className={styles.navLink}>
        GitHub <ArrowUpRight size={14} aria-hidden />
      </a>
    </>
  );

  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <Link href="/" className={styles.brand} aria-label={`${config.app_name} home`}>
          <LogoMark size={28} />
          <span>{config.app_name}</span>
        </Link>

        <nav className={styles.nav} aria-label="Main">
          {links}
        </nav>

        <div className={styles.actions}>
          <ThemeToggle />
          {signedIn ? (
            <Link href={APP_HOME} className="btn btn-primary btn-sm">
              Open app
            </Link>
          ) : (
            <>
              <Link href="/login" className="btn btn-secondary btn-sm">
                Log in
              </Link>
              {config.signup_enabled && (
                <Link href="/signup" className={`btn btn-primary btn-sm ${styles.getStarted}`}>
                  Get started
                </Link>
              )}
            </>
          )}
          <button
            type="button"
            className={`icon-btn ${styles.menuButton}`}
            aria-expanded={menuOpen}
            aria-controls="site-menu"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X size={20} aria-hidden /> : <Menu size={20} aria-hidden />}
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav id="site-menu" className={styles.mobileMenu} aria-label="Main">
          {links}
          {!signedIn && config.signup_enabled && (
            <Link href="/signup" className="btn btn-primary" onClick={() => setMenuOpen(false)}>
              Get started
            </Link>
          )}
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className={styles.menuGithub}>
            <GithubIcon size={16} /> Star it on GitHub
          </a>
        </nav>
      )}
    </header>
  );
}
