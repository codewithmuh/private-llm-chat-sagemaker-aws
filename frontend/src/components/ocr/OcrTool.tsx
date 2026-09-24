"use client";

/**
 * OCR tool: drop an image or PDF, get its text.
 *   1. POST /api/files/            upload (with progress)
 *   2. POST /api/files/{id}/ocr/   run OCR now (5-60 s). Cached on the server;
 *                                  "Run again" sends force: true.
 */
import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  FileText,
  MessageSquarePlus,
  RefreshCw,
  ScanText,
  Upload,
  X,
} from "lucide-react";
import { Markdown } from "@/components/chat/Markdown";
import { Tabs } from "@/components/ui/Tabs";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { useToast } from "@/components/ui/Toast";
import { useCopy } from "@/hooks/useCopy";
import { api, apiUrl, errorMessage, isAbortError } from "@/lib/api";
import { downloadText, saveComposerHandoff } from "@/lib/browser";
import { extensionOf, isImageFile, validateFile } from "@/lib/files";
import { formatBytes, formatDuration, slugify } from "@/lib/format";
import type { Attachment, OcrResult } from "@/lib/types";
import { uploadFile, type UploadHandle } from "@/lib/upload";
import { useConfig } from "@/providers/ConfigProvider";
import { useConversations } from "@/providers/ConversationsProvider";
import { useModels } from "@/providers/ModelsProvider";
import styles from "./OcrTool.module.css";

const OCR_TYPES = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".pdf"];

interface Picked {
  name: string;
  size: number;
  isImage: boolean;
  previewUrl: string | null;
}

type Phase = "idle" | "uploading" | "running" | "done" | "error";

export function OcrTool() {
  const router = useRouter();
  const toast = useToast();
  const { config } = useConfig();
  const { models, defaultModelId } = useModels();
  const { create } = useConversations();
  const [copied, copy] = useCopy();

  const ocrModels = models.filter((m) => m.ocr || m.vision);
  const [modelId, setModelId] = useState<string>("");
  const [picked, setPicked] = useState<Picked | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [result, setResult] = useState<OcrResult | null>(null);
  const [resultModel, setResultModel] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"rendered" | "raw">("rendered");
  const [dragging, setDragging] = useState(false);
  const [asking, setAsking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<UploadHandle | null>(null);

  // Free the local preview and cancel an upload when leaving the page.
  useEffect(() => {
    const url = picked?.previewUrl;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [picked]);
  useEffect(() => () => uploadRef.current?.abort(), []);

  const accepted = config.accepted_file_types.filter((t) => OCR_TYPES.includes(t.toLowerCase()));
  const acceptList = accepted.length ? accepted : OCR_TYPES;

  const runOcr = useCallback(
    async (file: Attachment, force = false) => {
      setPhase("running");
      setError(null);
      try {
        const body: Record<string, unknown> = {};
        if (modelId) body.model = modelId;
        if (force) body.force = true;
        const res = await api.post<OcrResult>(`/api/files/${file.id}/ocr/`, body);
        setResult(res);
        setResultModel(modelId);
        setAttachment(res.attachment);
        setPhase("done");
      } catch (err) {
        setError(errorMessage(err, "Text extraction failed."));
        setPhase("error");
      }
    },
    [modelId],
  );

  const start = (file: File) => {
    const ext = extensionOf(file.name);
    if (!acceptList.includes(ext) && !file.type.startsWith("image/") && file.type !== "application/pdf") {
      toast.error("The OCR tool reads images and PDFs.");
      return;
    }
    const problem = validateFile(file, config);
    if (problem) {
      toast.error(problem);
      return;
    }
    uploadRef.current?.abort();
    const isImage = isImageFile(file);
    setPicked({ name: file.name, size: file.size, isImage, previewUrl: isImage ? URL.createObjectURL(file) : null });
    setAttachment(null);
    setResult(null);
    setError(null);
    setProgress(0);
    setPhase("uploading");

    const handle = uploadFile(file, setProgress);
    uploadRef.current = handle;
    handle.promise
      .then((saved) => {
        setAttachment(saved);
        void runOcr(saved);
      })
      .catch((err: unknown) => {
        if (isAbortError(err)) return;
        setError(errorMessage(err, "Upload failed."));
        setPhase("error");
      });
  };

  const reset = () => {
    uploadRef.current?.abort();
    setPicked(null);
    setAttachment(null);
    setResult(null);
    setError(null);
    setPhase("idle");
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) start(file);
  };

  const askInChat = async () => {
    if (!attachment) return;
    setAsking(true);
    try {
      const conversation = await create({ model: defaultModelId });
      // The chat page picks this up and pre-attaches the file in the composer.
      saveComposerHandoff({ conversationId: conversation.id, attachments: [attachment], text: "" });
      router.push(`/c/${conversation.id}`);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't start a new chat."));
      setAsking(false);
    }
  };

  const baseName = slugify(picked?.name ?? "extracted-text", "extracted-text");

  /* ------------------------------------------------------------ empty */
  if (!picked) {
    return (
      <div className={styles.page}>
        <div className={styles.intro}>
          <h1 className={styles.title}>Extract text from an image or PDF</h1>
          <p className="muted">
            Receipts, screenshots, scanned pages… The text is read on your own infrastructure; nothing leaves your
            cloud.
          </p>
        </div>
        <ModelSelect value={modelId} onChange={setModelId} models={ocrModels} />
        <button
          type="button"
          className={styles.dropzone}
          data-dragging={dragging || undefined}
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <Upload size={30} aria-hidden />
          <strong>Drop an image or PDF here, or click to choose</strong>
          <span>
            {acceptList.join(", ")} · up to {config.max_upload_mb} MB
          </span>
        </button>
        <input
          ref={inputRef}
          type="file"
          hidden
          accept={acceptList.join(",")}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) start(file);
          }}
        />
      </div>
    );
  }

  /* ---------------------------------------------------------- working */
  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <ModelSelect value={modelId} onChange={setModelId} models={ocrModels} />
        <div className={styles.toolbarActions}>
          {attachment && (phase === "done" || phase === "error") && (
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => void runOcr(attachment, true)}>
              <RefreshCw size={14} aria-hidden /> {modelId !== resultModel ? "Run with this model" : "Run again"}
            </button>
          )}
          <button type="button" className="btn btn-sm btn-ghost" onClick={reset}>
            <X size={14} aria-hidden /> New file
          </button>
        </div>
      </div>

      <div className={styles.split}>
        <section className={styles.preview} aria-label="Original">
          {picked.isImage && picked.previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={picked.previewUrl} alt={picked.name} className={styles.previewImage} />
          ) : (
            <div className={styles.fileCard}>
              <FileText size={40} aria-hidden />
              <strong>{picked.name}</strong>
              <span className="muted">
                {formatBytes(picked.size)}
                {attachment?.page_count ? ` · ${attachment.page_count} pages` : ""}
              </span>
              {attachment && (
                <a href={apiUrl(attachment.url)} target="_blank" rel="noopener noreferrer" className="link">
                  Open PDF <ExternalLink size={13} aria-hidden style={{ display: "inline" }} />
                </a>
              )}
            </div>
          )}
          <p className={styles.previewCaption}>{picked.name}</p>
        </section>

        <section
          className={styles.result}
          aria-label="Extracted text"
          aria-busy={phase === "uploading" || phase === "running"}
        >
          {phase === "uploading" && (
            <div className={styles.status}>
              <ProgressRing value={progress} size={36} stroke={3} />
              <p>Uploading… {Math.round(progress * 100)}%</p>
            </div>
          )}

          {phase === "running" && (
            <div className={styles.status}>
              <span className="spinner spinner-lg" aria-hidden />
              <p>
                <strong>Reading the text…</strong>
                <br />
                <span className="muted">This can take up to a minute.</span>
              </p>
            </div>
          )}

          {phase === "error" && (
            <div className={styles.status}>
              <div className="alert alert-error" role="alert">
                {error}
              </div>
              {attachment && (
                <button type="button" className="btn btn-secondary" onClick={() => void runOcr(attachment, true)}>
                  <RefreshCw size={15} aria-hidden /> Try again
                </button>
              )}
            </div>
          )}

          {phase === "done" && result && (
            <>
              <div className={styles.resultHeader}>
                <Tabs
                  label="Text view"
                  tabs={[
                    { id: "rendered", label: "Formatted" },
                    { id: "raw", label: "Raw" },
                  ]}
                  active={view}
                  onChange={setView}
                />
                <span className={styles.meta}>
                  <ScanText size={13} aria-hidden /> {result.engine} · {formatDuration(result.duration_ms)}
                </span>
              </div>

              <div className={styles.text}>
                {!result.text.trim() ? (
                  <p className="muted">No text was found.</p>
                ) : view === "rendered" ? (
                  <Markdown content={result.text} />
                ) : (
                  <pre className={styles.raw}>{result.text}</pre>
                )}
              </div>

              <div className={styles.resultActions}>
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => void copy(result.text)}>
                  {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}{" "}
                  {copied ? "Copied" : "Copy"}
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  onClick={() => downloadText(`${baseName}.md`, result.text, "text/markdown")}
                >
                  <Download size={14} aria-hidden /> .md
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  onClick={() => downloadText(`${baseName}.txt`, result.text)}
                >
                  <Download size={14} aria-hidden /> .txt
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  onClick={() => void askInChat()}
                  disabled={asking}
                >
                  {asking ? <span className="spinner" aria-hidden /> : <MessageSquarePlus size={14} aria-hidden />} Ask
                  about it in a new chat
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function ModelSelect({
  value,
  onChange,
  models,
}: {
  value: string;
  onChange: (id: string) => void;
  models: { id: string; name: string; status: string; ocr: boolean }[];
}) {
  return (
    <label className={styles.modelSelect}>
      <span className="label">Model</span>
      <select className="select" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Automatic (best available)</option>
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
            {m.ocr ? " · OCR" : " · Vision"}
            {m.status !== "ready" ? ` (${m.status})` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
