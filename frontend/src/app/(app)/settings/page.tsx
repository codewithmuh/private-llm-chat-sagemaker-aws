"use client";

import { Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/chat/ChatHeader";
import { DataTab } from "@/components/settings/DataTab";
import { GeneralTab } from "@/components/settings/GeneralTab";
import { SecurityTab } from "@/components/settings/SecurityTab";
import styles from "@/components/settings/settings.module.css";
import { TabPanel, Tabs } from "@/components/ui/Tabs";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

type Tab = "general" | "security" | "data";
const TABS: { id: Tab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "security", label: "Security" },
  { id: "data", label: "Data" },
];

function SettingsContent() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // The tab lives in the URL (?tab=security) so it can be linked to.
  const requested = params.get("tab");
  const tab: Tab = TABS.some((t) => t.id === requested) ? (requested as Tab) : "general";

  useDocumentTitle("Settings");

  return (
    <div className={styles.page}>
      <div className={styles.content}>
        <div className={styles.tabs}>
          <Tabs
            label="Settings sections"
            tabs={TABS}
            active={tab}
            onChange={(next) => router.replace(next === "general" ? pathname : `${pathname}?tab=${next}`, { scroll: false })}
          />
        </div>
        <TabPanel>
          {tab === "general" && <GeneralTab />}
          {tab === "security" && <SecurityTab />}
          {tab === "data" && <DataTab />}
        </TabPanel>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <>
      <PageHeader>
        <h1 className={styles.pageTitle} style={{ paddingLeft: 8 }}>
          Settings
        </h1>
      </PageHeader>
      <Suspense>
        <SettingsContent />
      </Suspense>
    </>
  );
}
