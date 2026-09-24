"use client";

/**
 * On-demand SageMaker models scale to zero when idle. When the selected
 * model's GPU is asleep or starting, this banner says so, offers to start it
 * (POST /api/models/{id}/wake/) and polls GET /api/models/ every 15 s until
 * it is ready.
 */
import { useEffect, useRef, useState } from "react";
import { Power, TriangleAlert } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { errorMessage } from "@/lib/api";
import type { Model } from "@/lib/types";
import { useModels } from "@/providers/ModelsProvider";
import styles from "./ModelBanner.module.css";

const POLL_MS = 15_000;

interface ModelBannerProps {
  model: Model | undefined;
  /** A message was refused because the model was starting: say "send again" when ready. */
  awaitingSend?: boolean;
}

export function ModelBanner({ model, awaitingSend = false }: ModelBannerProps) {
  const { refresh, wake } = useModels();
  const toast = useToast();
  const [waking, setWaking] = useState(false);
  const status = model?.status;
  const needsPolling = status === "starting" || status === "stopped";

  useEffect(() => {
    if (!needsPolling) return;
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [needsPolling, refresh]);

  // Say so when the model we were waiting for becomes ready.
  const previous = useRef<{ id: string; status: Model["status"] } | null>(null);
  useEffect(() => {
    const before = previous.current;
    if (model && before?.id === model.id && before.status !== "ready" && model.status === "ready") {
      toast.success(awaitingSend ? `${model.name} is ready — press Send again.` : `${model.name} is ready.`);
    }
    previous.current = model ? { id: model.id, status: model.status } : null;
  }, [model, toast, awaitingSend]);

  if (!model || (status !== "stopped" && status !== "starting" && status !== "failed")) return null;

  const start = async () => {
    setWaking(true);
    try {
      await wake(model.id);
      toast.info(`Starting ${model.name}. This usually takes a few minutes.`);
    } catch (error) {
      toast.error(errorMessage(error, "Couldn't start the model."));
    } finally {
      setWaking(false);
    }
  };

  return (
    <div className={styles.banner} data-status={status} role="status">
      <div className={styles.inner}>
        {status === "failed" ? (
          <TriangleAlert size={18} aria-hidden className={styles.icon} />
        ) : status === "starting" ? (
          <span className={`status-dot ${styles.dot}`} data-status="starting" aria-hidden />
        ) : (
          <Power size={18} aria-hidden className={styles.icon} />
        )}
        <p className={styles.text}>
          {status === "stopped" && (
            <>
              <strong>This model&apos;s GPU is asleep.</strong>{" "}
              {model.status_detail || "Start it now, or send a message and it will wake up (this takes a few minutes)."}
            </>
          )}
          {status === "starting" && (
            <>
              <strong>This model&apos;s GPU is starting.</strong>{" "}
              {model.status_detail || "This usually takes a few minutes."}
            </>
          )}
          {status === "failed" && (
            <>
              <strong>This model is unavailable.</strong> {model.status_detail || "Its endpoint failed to start."}
            </>
          )}
        </p>
        {status === "stopped" && (
          <button type="button" className="btn btn-sm btn-primary" onClick={() => void start()} disabled={waking}>
            {waking ? <span className="spinner" aria-hidden /> : <Power size={14} aria-hidden />}
            Start it
          </button>
        )}
      </div>
    </div>
  );
}
