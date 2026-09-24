import Link from "next/link";
import { ArrowRight, Clock, Coins } from "lucide-react";
import styles from "./landing.module.css";

const LEVELS = [
  {
    title: "Local, with a mock model",
    text: "The full app on your laptop. The mock model shows exactly what a model receives.",
    time: "5 min",
    cost: "free",
    href: "/docs/01-quickstart-local",
  },
  {
    title: "A real model, locally",
    text: "Chat with Qwen or Llama running on your own machine through Ollama.",
    time: "15 min",
    cost: "free",
    href: "/docs/02-run-a-real-model-locally",
  },
  {
    title: "Your GPU on SageMaker",
    text: "A private LLM endpoint in your AWS account, used by the app on your laptop.",
    time: "30 min",
    cost: "~$1.1–2.6 per GPU hour",
    href: "/docs/03-deploy-a-model-on-sagemaker",
  },
  {
    title: "Everything on AWS",
    text: "The app on a public HTTPS URL for your team, with the GPU on demand.",
    time: "1–2 h",
    cost: "~$80–90/month + GPU hours",
    href: "/docs/04-deploy-the-full-stack-on-aws",
  },
  {
    title: "Advanced",
    text: "Scale to zero, weights in S3 with no internet, several models per GPU, 70B models, CI/CD.",
    time: "as you go",
    cost: "depends",
    href: "/docs/05-advanced",
  },
];

export function Paths() {
  return (
    <section id="paths" className={styles.section}>
      <div className={styles.container}>
        <div className={styles.sectionHead}>
          <span className={styles.eyebrow}>Choose your path</span>
          <h2 className={styles.h2}>From a laptop demo to production, one step at a time</h2>
          <p className={styles.lead}>Each level builds on the previous one. Stop wherever you have what you need.</p>
        </div>
        <ol className={styles.paths}>
          {LEVELS.map((level, index) => (
            <li key={level.href}>
              <Link href={level.href} className={styles.path}>
                <span className={styles.pathLevel} aria-hidden>
                  {index + 1}
                </span>
                <span>
                  <span className={styles.pathTitle}>
                    <span className="sr-only">Level {index + 1}: </span>
                    {level.title}
                  </span>
                  <span className={styles.pathText} style={{ display: "block" }}>
                    {level.text}
                  </span>
                  <span className={styles.chips}>
                    <span className={styles.chip}>
                      <Clock size={13} aria-hidden /> {level.time}
                    </span>
                    <span className={styles.chip}>
                      <Coins size={13} aria-hidden /> {level.cost}
                    </span>
                  </span>
                </span>
                <ArrowRight size={20} aria-hidden className={styles.pathArrow} />
              </Link>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
