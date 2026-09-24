import { Cpu, Globe, Radio, Server, type LucideIcon } from "lucide-react";
import styles from "./landing.module.css";

const STEPS: { icon: LucideIcon; title: string; text: string; code: string }[] = [
  {
    icon: Globe,
    title: "Your browser",
    text: "You press Send. The message and any attached files go to the API over HTTPS, with your session cookie.",
    code: "POST /api/conversations/{id}/messages/",
  },
  {
    icon: Server,
    title: "Django API",
    text: "Checks the model's GPU is awake (or wakes it), then builds the prompt: history, your files and instructions, trimmed to the context window.",
    code: "ensure_ready() → build_prompt()",
  },
  {
    icon: Cpu,
    title: "SageMaker + vLLM",
    text: "The request is IAM-signed and streamed to your private endpoint, where vLLM generates the answer on the GPU.",
    code: "InvokeEndpointWithResponseStream",
  },
  {
    icon: Radio,
    title: "Streamed back",
    text: "Each token is relayed to the browser as a Server-Sent Event, so the answer appears as it is written. Stop works at any time.",
    code: "text/event-stream",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className={`${styles.section} ${styles.sectionAlt}`}>
      <div className={styles.container}>
        <div className={`${styles.sectionHead} ${styles.sectionHeadCenter}`}>
          <span className={styles.eyebrow}>How it works</span>
          <h2 className={styles.h2}>The path of one message</h2>
          <p className={styles.lead}>From the moment you press Send to the first token on your screen.</p>
        </div>
        <ol className={styles.steps}>
          {STEPS.map(({ icon: Icon, title, text, code }, index) => (
            <li key={title} className={styles.step}>
              <span className={styles.stepNumber} aria-hidden>
                {index + 1}
              </span>
              <div className={styles.stepBody}>
                <h3 className={styles.stepTitle}>
                  <Icon size={18} aria-hidden /> {title}
                </h3>
                <p className={styles.stepText}>{text}</p>
                <code className={styles.stepCode}>{code}</code>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
