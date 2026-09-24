import Link from "next/link";
import { GithubIcon } from "@/components/ui/GithubIcon";
import { LogoMark } from "@/components/ui/Logo";
import { GITHUB_URL, SITE_NAME, repoFileUrl } from "@/lib/site";
import styles from "./landing.module.css";

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={`${styles.container} ${styles.footerInner}`}>
        <div className={styles.footerBrand}>
          <LogoMark size={24} />
          <span>{SITE_NAME}</span>
          <span className={styles.footerNote}>Open source · MIT</span>
        </div>
        <nav className={styles.footerLinks} aria-label="Footer">
          <Link href="/docs">Docs</Link>
          <Link href="/docs/architecture">Architecture</Link>
          <Link href="/docs/cost">Cost</Link>
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
            <GithubIcon size={14} /> GitHub
          </a>
          <a href={repoFileUrl("LICENSE")} target="_blank" rel="noopener noreferrer">
            License (MIT)
          </a>
          <a href={repoFileUrl("SECURITY.md")} target="_blank" rel="noopener noreferrer">
            Security
          </a>
        </nav>
      </div>
    </footer>
  );
}
