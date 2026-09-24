"use client";

import { Check, Copy, Download } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { useCopy } from "@/hooks/useCopy";
import { downloadText } from "@/lib/browser";
import { useConfig } from "@/providers/ConfigProvider";
import styles from "./settings.module.css";

/**
 * Shows freshly generated recovery codes ONCE. The server only stores
 * hashes, so this is the user's only chance to save them.
 */
export function RecoveryCodesDialog({ codes, onClose }: { codes: string[] | null; onClose: () => void }) {
  const { config } = useConfig();
  const [copied, copy] = useCopy();
  const text = (codes ?? []).join("\n");

  const download = () => {
    const header = `${config.app_name} recovery codes\nGenerated ${new Date().toLocaleString()}\nEach code can be used once.\n\n`;
    downloadText("recovery-codes.txt", `${header}${text}\n`);
  };

  return (
    <Dialog
      open={codes !== null}
      onClose={onClose}
      dismissible={false}
      title="Save your recovery codes"
      description="If you lose your phone or can't get email codes, each of these signs you in once. Keep them somewhere safe: they won't be shown again."
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={() => void copy(text)}>
            {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />} {copied ? "Copied" : "Copy all"}
          </button>
          <button type="button" className="btn btn-secondary" onClick={download}>
            <Download size={16} aria-hidden /> Download .txt
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose} data-autofocus>
            I saved them
          </button>
        </>
      }
    >
      <ul className={styles.codes} aria-label="Recovery codes">
        {(codes ?? []).map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
    </Dialog>
  );
}
