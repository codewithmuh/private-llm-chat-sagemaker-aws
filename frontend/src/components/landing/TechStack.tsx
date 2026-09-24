import styles from "./landing.module.css";

const STACK: [string, string][] = [
  ["vLLM", "model serving"],
  ["Amazon SageMaker", "GPUs"],
  ["Django 5.2", "API"],
  ["Django REST Framework", ""],
  ["Next.js 16", "web"],
  ["React 19", ""],
  ["TypeScript", ""],
  ["PostgreSQL", "RDS"],
  ["Amazon S3", "files"],
  ["Amazon SES", "email"],
  ["CloudFront", "HTTPS"],
  ["ECS Fargate", "ARM64"],
  ["Terraform", "infrastructure"],
  ["Docker", ""],
  ["GitHub Actions", "CI/CD"],
  ["Ollama", "local models"],
];

export function TechStack() {
  return (
    <section className={styles.section} aria-labelledby="stack-title">
      <div className={styles.container}>
        <div className={`${styles.sectionHead} ${styles.sectionHeadCenter}`}>
          <span className={styles.eyebrow}>Tech stack</span>
          <h2 id="stack-title" className={styles.h2}>
            Boring, well-documented building blocks
          </h2>
        </div>
        <ul className={styles.stack}>
          {STACK.map(([name, note]) => (
            <li key={name} className={styles.stackItem}>
              {name}
              {note && <span>{note}</span>}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
