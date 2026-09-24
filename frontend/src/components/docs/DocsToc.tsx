"use client";

/** "On this page": the h2/h3 headings, highlighting the one you are reading. */
import { useEffect, useState } from "react";
import type { TocItem } from "@/content/types";
import styles from "./docs.module.css";

export function DocsToc({ toc }: { toc: TocItem[] }) {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const headings = toc
      .map((item) => document.getElementById(item.id))
      .filter((el): el is HTMLElement => el !== null);
    if (headings.length === 0) return;
    // A heading counts as "current" once it scrolls into the top third.
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-72px 0px -66% 0px" },
    );
    headings.forEach((h) => observer.observe(h));
    return () => observer.disconnect();
  }, [toc]);

  if (toc.length < 2) return <div className={styles.toc} />;

  return (
    <aside className={styles.toc} aria-label="On this page">
      <div className={styles.tocTitle}>On this page</div>
      <ul className={styles.tocList}>
        {toc.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              className={styles.tocLink}
              data-depth={item.depth}
              data-active={active === item.id || undefined}
            >
              {item.text}
            </a>
          </li>
        ))}
      </ul>
    </aside>
  );
}
