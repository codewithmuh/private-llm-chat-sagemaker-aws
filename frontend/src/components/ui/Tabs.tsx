"use client";

/**
 * Accessible tabs (WAI-ARIA "tabs" pattern): arrow keys move between tabs.
 * The caller renders the active panel; wrap it in <TabPanel>.
 */
import { useId, type KeyboardEvent, type ReactNode } from "react";
import styles from "./Tabs.module.css";

export interface TabItem<T extends string> {
  id: T;
  label: ReactNode;
}

interface TabsProps<T extends string> {
  tabs: TabItem<T>[];
  active: T;
  onChange: (id: T) => void;
  label: string;
  /** Stretch tabs to fill the row (used on small cards). */
  fill?: boolean;
}

export function tabIds(base: string, id: string) {
  return { tab: `${base}-tab-${id}`, panel: `${base}-panel-${id}` };
}

export function Tabs<T extends string>({ tabs, active, onChange, label, fill }: TabsProps<T>) {
  const base = useId();

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex((t) => t.id === active);
    let next = -1;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    if (next < 0) return;
    event.preventDefault();
    onChange(tabs[next].id);
    document.getElementById(tabIds(base, tabs[next].id).tab)?.focus();
  };

  return (
    <div role="tablist" aria-label={label} className={styles.list} data-fill={fill || undefined} onKeyDown={onKeyDown}>
      {tabs.map((tab) => {
        const ids = tabIds(base, tab.id);
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            id={ids.tab}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className={styles.tab}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div role="tabpanel" className={className}>
      {children}
    </div>
  );
}
