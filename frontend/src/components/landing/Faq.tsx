import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { repoFileUrl } from "@/lib/site";
import styles from "./landing.module.css";

const QUESTIONS: { q: string; a: ReactNode }[] = [
  {
    q: "Do I need a GPU on my laptop?",
    a: (
      <>
        No. The first two levels run on any machine (the second is faster with a GPU or Apple Silicon). The GPU
        lives on SageMaker.
      </>
    ),
  },
  {
    q: "Why SageMaker and not a plain EC2 GPU?",
    a: (
      <>
        Managed health checks, automatic restarts, IAM-only access to the model, and GPU quota is often easier to
        get. The serving container is standard vLLM, so moving to EC2, EKS or on-prem later is easy: the app only
        needs an OpenAI-compatible URL.
      </>
    ),
  },
  {
    q: "Why not Amazon Bedrock?",
    a: (
      <>
        Bedrock is great for managed models, but you can&apos;t run any open model you like with your own settings,
        and there&apos;s less to learn. A Bedrock provider is on the <Link href="/docs/roadmap">roadmap</Link> for
        comparisons.
      </>
    ),
  },
  {
    q: "How much does it cost?",
    a: (
      <>
        The app itself is roughly $80–90/month (load balancer, small Fargate tasks, a small RDS instance, public
        IPs). GPUs are billed per hour while the endpoint exists: about $1.13–2.61/hour for the single-GPU presets.
        With <code>on_demand</code> scaling you only pay for hours actually used. See the{" "}
        <Link href="/docs/cost">cost guide</Link>.
      </>
    ),
  },
  {
    q: "Is it production ready?",
    a: (
      <>
        It&apos;s a solid, secure base: auth with 2FA, IAM, encrypted storage, tests and CI. Before putting company
        data in it, review the settings for your needs (backups, SES production access, WAF, monitoring):{" "}
        <a href={repoFileUrl("SECURITY.md")} target="_blank" rel="noopener noreferrer">
          SECURITY.md
        </a>
        .
      </>
    ),
  },
  {
    q: "Can I use it with OpenAI or another API?",
    a: (
      <>
        Yes: any OpenAI-compatible endpoint is a model entry with a <code>base_url</code>. Handy for comparing
        quality, though then your data leaves your account.
      </>
    ),
  },
];

export function Faq() {
  return (
    <section id="faq" className={`${styles.section} ${styles.sectionAlt}`}>
      <div className={styles.container}>
        <div className={`${styles.sectionHead} ${styles.sectionHeadCenter}`}>
          <span className={styles.eyebrow}>FAQ</span>
          <h2 className={styles.h2}>Questions people ask</h2>
        </div>
        <div className={styles.faq}>
          {QUESTIONS.map(({ q, a }) => (
            <details key={q} className={styles.faqItem}>
              <summary>
                {q}
                <ChevronDown size={18} aria-hidden className={styles.faqChevron} />
              </summary>
              <div className={styles.faqAnswer}>{a}</div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
