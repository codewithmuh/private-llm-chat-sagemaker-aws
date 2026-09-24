import Link from "next/link";
import { ArrowRight, PiggyBank } from "lucide-react";
import styles from "./landing.module.css";

// ml.g6e.xlarge (the default preset), us-east-1 on-demand; a month is 730 hours.
const RATE = 2.61;
const ALWAYS_ON = Math.round(RATE * 730); // ≈ $1,905
const TWO_HOURS_A_DAY = Math.round(RATE * 2 * 30); // ≈ $157

const BASELINE = [
  ["Load balancer", "$17–20"],
  ["3 small Fargate tasks (ARM)", "$29"],
  ["Public IPv4 addresses", "$18"],
  ["RDS PostgreSQL (db.t4g.micro)", "$14"],
  ["Logs, secrets, images, S3", "$3–7"],
];

const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

export function Cost() {
  return (
    <section id="cost" className={`${styles.section} ${styles.sectionAlt}`}>
      <div className={styles.container}>
        <div className={styles.sectionHead}>
          <span className={styles.eyebrow}>Cost</span>
          <h2 className={styles.h2}>Pay for the GPU only while someone is using it</h2>
          <p className={styles.lead}>
            A small always-on baseline for the app, plus GPU hours: $1.13–$2.61 per hour for the single-GPU presets.
          </p>
        </div>

        <div className={styles.costGrid}>
          <div className={styles.costCard}>
            <div className={styles.costLabel}>The app on AWS, always on</div>
            <div className={styles.costBig}>
              ≈ $80–90 <small>/ month</small>
            </div>
            <ul className={styles.costList}>
              {BASELINE.map(([item, price]) => (
                <li key={item}>
                  <span>{item}</span>
                  <span>{price}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className={styles.costCard}>
            <div className={styles.costLabel}>One GPU: ml.g6e.xlarge (NVIDIA L40S, 48 GB) at ${RATE}/hour</div>
            <div className={styles.bars}>
              <div className={styles.barRow}>
                <div className={styles.barLabel}>
                  <span>
                    <code>always_on</code>, 24/7
                  </span>
                  <strong>≈ {usd(ALWAYS_ON)}/month</strong>
                </div>
                <div className={styles.barTrack}>
                  <div className={styles.barFill} style={{ width: "100%" }} />
                </div>
              </div>
              <div className={styles.barRow}>
                <div className={styles.barLabel}>
                  <span>
                    <code>on_demand</code>, used 2 h a day
                  </span>
                  <strong>≈ {usd(TWO_HOURS_A_DAY)}/month</strong>
                </div>
                <div className={styles.barTrack}>
                  <div
                    className={`${styles.barFill} ${styles.barFillAccent}`}
                    style={{ width: `${(TWO_HOURS_A_DAY / ALWAYS_ON) * 100}%` }}
                  />
                </div>
                <span className={styles.barNote}>
                  Started by the first message (5–15 min cold start), deleted after 30 idle minutes.
                </span>
              </div>
            </div>
            <div className={styles.saving}>
              <PiggyBank size={18} aria-hidden />
              <span>
                A forgotten GPU is the classic surprise bill. With <code>on_demand</code> it can&apos;t happen by
                accident.
              </span>
            </div>
          </div>
        </div>

        <Link href="/docs/cost" className={styles.moreLink}>
          The full cost breakdown <ArrowRight size={16} aria-hidden />
        </Link>
      </div>
    </section>
  );
}
