"use client";

import { ChevronDown } from "lucide-react";
import { Menu, MenuItem } from "@/components/ui/Menu";
import type { Model } from "@/lib/types";
import { useModels } from "@/providers/ModelsProvider";
import styles from "./ModelPicker.module.css";

const STATUS_LABEL: Record<Model["status"], string> = {
  ready: "Ready",
  starting: "Starting",
  stopped: "Asleep",
  failed: "Unavailable",
  unknown: "Status unknown",
};

export function ModelBadges({ model }: { model: Model }) {
  return (
    <>
      {model.vision && <span className="badge">Vision</span>}
      {model.ocr && <span className="badge badge-accent">OCR</span>}
    </>
  );
}

interface ModelPickerProps {
  value: string | null;
  onChange: (id: string) => void;
  /** Only offer models that pass this filter (e.g. OCR-capable ones). */
  filter?: (model: Model) => boolean;
  compact?: boolean;
}

export function ModelPicker({ value, onChange, filter, compact }: ModelPickerProps) {
  const { models, loaded, error, refresh } = useModels();
  const list = filter ? models.filter(filter) : models;
  const current = models.find((m) => m.id === value);

  const label = current?.name ?? (value ? value : loaded ? "Choose a model" : "Loading models…");

  return (
    <Menu
      label="Choose a model"
      buttonClassName={styles.trigger}
      buttonTitle={current ? `${current.name} — ${STATUS_LABEL[current.status]}` : undefined}
      className={styles.panel}
      disabled={!loaded}
      button={
        <>
          {current && <span className="status-dot" data-status={current.status} aria-hidden />}
          <span className={styles.triggerLabel} data-compact={compact || undefined}>
            {label}
          </span>
          <ChevronDown size={16} aria-hidden className={styles.chevron} />
        </>
      }
    >
      {list.length === 0 && (
        <div className={styles.emptyNote}>
          {error ?? "No models are configured yet."}{" "}
          {error && (
            <button type="button" className="link" onClick={() => void refresh()}>
              Retry
            </button>
          )}
        </div>
      )}
      {list.map((model) => (
        <MenuItem
          key={model.id}
          checked={model.id === value}
          onSelect={() => onChange(model.id)}
          className={styles.item}
          description={
            <>
              {model.description && <span className={styles.description}>{model.description}</span>}
              {model.status !== "ready" && (
                <span className={styles.status} data-status={model.status}>
                  <span className="status-dot" data-status={model.status} aria-hidden />
                  {model.status_detail || STATUS_LABEL[model.status]}
                </span>
              )}
            </>
          }
        >
          <span className={styles.nameRow}>
            <span className="status-dot" data-status={model.status} aria-label={STATUS_LABEL[model.status]} />
            <span className={styles.name}>{model.name}</span>
            <ModelBadges model={model} />
          </span>
        </MenuItem>
      ))}
    </Menu>
  );
}
