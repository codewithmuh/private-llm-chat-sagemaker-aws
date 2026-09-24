import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { CopyCodeButton } from "@/components/docs/CopyCodeButton";
import { GithubIcon } from "@/components/ui/GithubIcon";
import { CLONE_COMMAND, GITHUB_URL } from "@/lib/site";
import styles from "./landing.module.css";

export function FinalCta() {
  return (
    <section className={styles.section}>
      <div className={styles.container}>
        <div className={styles.cta}>
          <h2 className={styles.h2}>Run it locally in 5 minutes</h2>
          <p className={styles.lead}>
            You only need Docker. A mock model streams answers, so no GPU and no AWS account are needed to try it.
          </p>
          <div className={styles.command}>
            <div className={styles.commandHead}>
              <span>terminal</span>
              <CopyCodeButton text={CLONE_COMMAND} />
            </div>
            <pre>
              {CLONE_COMMAND.split("\n").map((line) => (
                <div key={line}>
                  <span>$ </span>
                  {line}
                </div>
              ))}
            </pre>
          </div>
          <div className={styles.ctas}>
            <Link href="/docs/01-quickstart-local" className="btn btn-primary">
              Get started <ArrowRight size={17} aria-hidden />
            </Link>
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="btn btn-secondary">
              <GithubIcon size={17} /> View on GitHub
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
