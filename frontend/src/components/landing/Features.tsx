import Image from "next/image";
import {
  Boxes,
  FileStack,
  LockKeyhole,
  MessagesSquare,
  Power,
  ScanText,
  ShieldCheck,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { BrowserFrame } from "./BrowserFrame";
import styles from "./landing.module.css";

const FEATURES: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: LockKeyhole,
    title: "Private by design",
    text: "The model, database and files stay in your AWS account and region. The model endpoint has no public URL, and prompts are never logged.",
  },
  {
    icon: Boxes,
    title: "Any open model",
    text: "Pick a preset (Qwen, Llama, Gemma, DeepSeek) or any Hugging Face model vLLM supports. Ollama and OpenAI-compatible servers work too.",
  },
  {
    icon: MessagesSquare,
    title: "Streaming chat",
    text: "Answers stream token by token, with Markdown, code highlighting, tables and math. History, search, pin, regenerate and stop.",
  },
  {
    icon: FileStack,
    title: "Documents & images",
    text: "Attach PDFs, Word files, text and code: their text goes into the prompt, trimmed to fit. Vision models see images as images.",
  },
  {
    icon: ScanText,
    title: "OCR",
    text: "Extract text from photos, screenshots and scanned PDFs with a vision LLM, with Tesseract as a CPU fallback. Copy, download, or chat about it.",
  },
  {
    icon: ShieldCheck,
    title: "Accounts, Google & 2FA",
    text: "Email and password with verification, Sign in with Google, two-factor auth with an authenticator app or email codes, recovery codes.",
  },
  {
    icon: Power,
    title: "GPU on demand",
    text: "Endpoints start when someone sends a message and are deleted after 30 idle minutes. A forgotten GPU can't run up a bill.",
  },
  {
    icon: Workflow,
    title: "Infrastructure as code",
    text: "The whole AWS stack in Terraform: CloudFront, load balancer, ECS Fargate, RDS, S3, SES, SageMaker, and CI/CD with GitHub OIDC.",
  },
];

export function Features() {
  return (
    <section id="features" className={styles.section}>
      <div className={styles.container}>
        <div className={styles.sectionHead}>
          <span className={styles.eyebrow}>Features</span>
          <h2 className={styles.h2}>Everything a team needs from a private ChatGPT</h2>
          <p className={styles.lead}>
            A complete, secure app and the infrastructure to run it, from a laptop demo to a production deployment,
            with every step explained.
          </p>
        </div>
        <div className={styles.features}>
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <article key={title} className={styles.card}>
              <span className={styles.cardIcon}>
                <Icon size={20} aria-hidden />
              </span>
              <h3 className={styles.cardTitle}>{title}</h3>
              <p className={styles.cardText}>{text}</p>
            </article>
          ))}
        </div>

        <div className={styles.gallery}>
          <figure className={styles.galleryItem}>
            <BrowserFrame url="chat.your-company.com/ocr" small>
              <Image
                src="/screenshots/ocr.png"
                alt="OCR tool: an image on the left, the extracted text as Markdown on the right"
                width={1440}
                height={900}
                sizes="(max-width: 767px) 100vw, 580px"
              />
            </BrowserFrame>
            <figcaption>OCR: a photo or scan in, clean Markdown out</figcaption>
          </figure>
          <figure className={styles.galleryItem}>
            <BrowserFrame url="chat.your-company.com/settings" small>
              <Image
                src="/screenshots/two-factor.png"
                alt="Authenticator app setup with a QR code and a 6-digit code field"
                width={1440}
                height={900}
                sizes="(max-width: 767px) 100vw, 580px"
              />
            </BrowserFrame>
            <figcaption>Two-factor authentication with an authenticator app or email codes</figcaption>
          </figure>
        </div>
      </div>
    </section>
  );
}
