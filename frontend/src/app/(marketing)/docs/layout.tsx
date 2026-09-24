import type { ReactNode } from "react";
import { DocsMobileNav, DocsSidebar, type NavGroupItem } from "@/components/docs/DocsNav";
import styles from "@/components/docs/docs.module.css";
import { docsNav } from "@/content/docs";

/** /docs: navigation on the left (a menu bar on phones), the page on the right. */
export default function DocsLayout({ children }: { children: ReactNode }) {
  const nav: NavGroupItem[] = docsNav().map((group) => ({
    title: group.title,
    items: group.items.map((doc) => ({ href: doc.slug ? `/docs/${doc.slug}` : "/docs", label: doc.label })),
  }));
  return (
    <>
      <DocsMobileNav nav={nav} />
      <div className={styles.shell}>
        <DocsSidebar nav={nav} />
        {children}
      </div>
    </>
  );
}
