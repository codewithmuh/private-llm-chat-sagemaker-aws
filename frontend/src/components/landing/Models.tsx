import Link from "next/link";
import { readModelPresets } from "@/content/catalog";
import { repoFileUrl } from "@/lib/site";
import styles from "./landing.module.css";

/** The presets from ml/models/catalog.json (read when the page is built). */
export function Models() {
  const presets = readModelPresets();
  return (
    <section id="models" className={`${styles.section} ${styles.sectionAlt}`}>
      <div className={styles.container}>
        <div className={styles.sectionHead}>
          <span className={styles.eyebrow}>Models</span>
          <h2 className={styles.h2}>Tested presets, one command to deploy</h2>
          <p className={styles.lead}>
            Each preset runs on AWS&apos;s own vLLM container, so there is nothing to build:{" "}
            <code className={styles.mono}>python ml/sagemaker/deploy.py deploy qwen3-vl-8b</code>. Or any model vLLM
            supports.
          </p>
        </div>

        {presets.length === 0 ? (
          <p className={styles.footnote}>
            The model catalog is in{" "}
            <a href={repoFileUrl("ml/models/catalog.json")} target="_blank" rel="noopener noreferrer">
              ml/models/catalog.json
            </a>
            .
          </p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Model</th>
                  <th scope="col">Instance</th>
                  <th scope="col">GPU</th>
                  <th scope="col">$/hour</th>
                  <th scope="col">Notes</th>
                </tr>
              </thead>
              <tbody>
                {presets.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <span className={styles.modelName}>{m.name}</span>
                      <span className={styles.modelId}>{m.hf_model_id}</span>
                    </td>
                    <td className={`${styles.mono} ${styles.nowrap}`}>{m.instance_type}</td>
                    <td className={styles.nowrap}>{m.gpu}</td>
                    <td className={styles.price}>${m.hourly_usd.toFixed(2)}</td>
                    <td>
                      <span className={styles.badges}>
                        {(m.vision || m.ocr) && <span className="badge badge-accent">Vision / OCR</span>}
                        {m.gated && (
                          <span className={`badge ${styles.badgeWarn}`} title="Needs a Hugging Face token">
                            Gated
                          </span>
                        )}
                        {!m.vision && !m.ocr && !m.gated && <span className="badge">Text</span>}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className={styles.footnote}>
          …or any model vLLM supports. Prices are us-east-1 on-demand SageMaker rates; see the{" "}
          <Link href="/docs/cost">cost guide</Link> and <Link href="/docs/models">how to size a GPU</Link>.
        </p>
      </div>
    </section>
  );
}
