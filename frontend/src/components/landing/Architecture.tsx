import Link from "next/link";
import { ArrowRight, KeyRound, Lock, Power, Route } from "lucide-react";
import styles from "./Architecture.module.css";
import landing from "./landing.module.css";

/* One box of the diagram: a rounded rectangle with a title and a subtitle. */
function Box({
  x,
  y,
  w,
  h = 76,
  title,
  sub,
  accent,
}: {
  x: number;
  y: number;
  w: number;
  h?: number;
  title: string;
  sub: string;
  accent?: boolean;
}) {
  const cx = x + w / 2;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={12} className={accent ? styles.boxAccent : styles.box} />
      <text x={cx} y={y + h / 2 - 4} textAnchor="middle" className={styles.title}>
        {title}
      </text>
      <text x={cx} y={y + h / 2 + 17} textAnchor="middle" className={styles.sub}>
        {sub}
      </text>
    </g>
  );
}

/** Wide screens: the whole AWS stack as an SVG, colored by the theme tokens. */
function DiagramSvg() {
  return (
    <svg
      viewBox="0 0 1120 500"
      className={styles.svg}
      role="img"
      aria-labelledby="arch-title arch-desc"
    >
      <title id="arch-title">Architecture on AWS</title>
      <desc id="arch-desc">
        The browser reaches CloudFront over HTTPS. CloudFront forwards to an Application Load Balancer, which routes
        by path to two ECS Fargate services: web (Next.js) and api (Django). A third service, the gpu-controller,
        starts and stops the SageMaker endpoint. The api stores data in RDS PostgreSQL, files in a private S3 bucket,
        sends email with SES, and calls the SageMaker endpoint (vLLM on a GPU) with IAM-signed, streaming requests.
      </desc>
      <defs>
        <marker id="arch-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0 L10 5 L0 10 z" className={styles.arrowHead} />
        </marker>
        <marker id="arch-arrow-accent" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0 L10 5 L0 10 z" className={styles.arrowHeadAccent} />
        </marker>
      </defs>

      {/* Your AWS account */}
      <rect x={240} y={8} width={862} height={476} rx={18} className={styles.boundary} />
      <text x={258} y={30} className={styles.groupLabel}>
        Your AWS account
      </text>

      {/* ECS Fargate */}
      <rect x={280} y={160} width={800} height={140} rx={16} className={styles.group} />
      <text x={1062} y={183} textAnchor="end" className={styles.groupLabel}>
        ECS Fargate (ARM64)
      </text>

      {/* edges (drawn first so boxes sit on top) */}
      <path d="M190 76 H274" className={styles.edge} markerEnd="url(#arch-arrow)" />
      <text x={214} y={66} textAnchor="middle" className={styles.edgeLabel}>
        HTTPS
      </text>
      <path d="M490 76 H569" className={styles.edge} markerEnd="url(#arch-arrow)" />
      <text x={532} y={66} textAnchor="middle" className={styles.edgeLabel}>
        one origin
      </text>
      <path d="M685 112 V190" className={styles.edge} markerEnd="url(#arch-arrow)" />
      <path d="M685 138 H425 V190" className={styles.edge} markerEnd="url(#arch-arrow)" />
      <text x={440} y={131} className={styles.edgeLabel}>
        by path: /api/* → api, rest → web
      </text>

      <path d="M650 276 V330 H365 V374" className={styles.edge} markerEnd="url(#arch-arrow)" />
      <path d="M545 330 V374" className={styles.edge} markerEnd="url(#arch-arrow)" />
      <path d="M650 330 H700 V374" className={styles.edge} markerEnd="url(#arch-arrow)" />
      <text x={380} y={323} className={styles.edgeLabel}>
        SQL · files · email
      </text>

      <path d="M760 276 V346 H870 V374" className={styles.edgeAccent} markerEnd="url(#arch-arrow-accent)" />
      <text x={772} y={340} className={styles.edgeLabelAccent}>
        IAM-signed, streaming
      </text>
      <path d="M990 276 V374" className={styles.edgeDashed} markerEnd="url(#arch-arrow-accent)" />
      <text x={1000} y={334} className={styles.edgeLabelAccent}>
        start / stop
      </text>

      {/* boxes */}
      <Box x={20} y={40} w={170} h={72} title="Browser" sub="your team" />
      <Box x={280} y={40} w={210} h={72} title="CloudFront" sub="HTTPS, one domain" />
      <Box x={575} y={40} w={220} h={72} title="Load balancer" sub="accepts CloudFront only" />

      <Box x={310} y={196} w={230} h={80} title="web" sub="Next.js (this page)" />
      <Box x={570} y={196} w={230} h={80} title="api" sub="Django REST, SSE" />
      <Box x={830} y={196} w={220} h={80} title="gpu-controller" sub="starts & stops GPUs" />

      <Box x={280} y={380} w={170} title="RDS PostgreSQL" sub="users, chats" />
      <Box x={470} y={380} w={150} title="S3" sub="private files" />
      <Box x={640} y={380} w={120} title="SES" sub="email" />
      <Box x={800} y={380} w={280} title="SageMaker endpoint" sub="vLLM on a GPU · no public URL" accent />
    </svg>
  );
}

/** Phones: the same picture as a vertical flow. */
function DiagramStack() {
  return (
    <ol className={styles.stack} aria-label="Architecture on AWS, top to bottom">
      <li className={styles.node}>
        <strong>Browser</strong>
        <span>your team</span>
      </li>
      <li className={styles.link}>HTTPS</li>
      <li className={styles.node}>
        <strong>CloudFront</strong>
        <span>HTTPS, one domain for the app and the API</span>
      </li>
      <li className={styles.link}>one origin</li>
      <li className={styles.node}>
        <strong>Load balancer</strong>
        <span>routes /api/* to api, the rest to web</span>
      </li>
      <li className={styles.link}>by path</li>
      <li className={styles.stackGroup}>
        <span className={styles.stackGroupLabel}>ECS Fargate (ARM64)</span>
        <div className={styles.stackRow}>
          <div className={styles.node}>
            <strong>web</strong>
            <span>Next.js</span>
          </div>
          <div className={styles.node}>
            <strong>api</strong>
            <span>Django, SSE</span>
          </div>
          <div className={styles.node}>
            <strong>gpu-controller</strong>
            <span>starts & stops GPUs</span>
          </div>
        </div>
      </li>
      <li className={styles.link}>api: SQL · files · email</li>
      <li className={styles.stackRow}>
        <div className={styles.node}>
          <strong>RDS</strong>
          <span>PostgreSQL</span>
        </div>
        <div className={styles.node}>
          <strong>S3</strong>
          <span>private files</span>
        </div>
        <div className={styles.node}>
          <strong>SES</strong>
          <span>email</span>
        </div>
      </li>
      <li className={`${styles.link} ${styles.linkAccent}`}>api: IAM-signed, streaming · controller: start / stop</li>
      <li className={`${styles.node} ${styles.nodeAccent}`}>
        <strong>SageMaker endpoint</strong>
        <span>vLLM on a GPU · no public URL</span>
      </li>
    </ol>
  );
}

const DECISIONS = [
  {
    icon: KeyRound,
    title: "No public model URL",
    text: "The SageMaker endpoint is only reachable through the AWS API, signed with the api task's IAM role. There is no API key to leak.",
  },
  {
    icon: Power,
    title: "The controller owns the GPU",
    text: "Terraform creates the (free) model configuration; the gpu-controller creates the endpoint when someone chats and deletes it when idle.",
  },
  {
    icon: Route,
    title: "One origin",
    text: "CloudFront serves the UI and the API on one domain, so HttpOnly session cookies and CSRF protection need no cross-site setup.",
  },
  {
    icon: Lock,
    title: "Your data stays put",
    text: "Prompts are never logged, SageMaker data capture is off, and files live in a private bucket behind 5-minute presigned links.",
  },
];

export function Architecture() {
  return (
    <section id="architecture" className={landing.section}>
      <div className={landing.container}>
        <div className={landing.sectionHead}>
          <span className={landing.eyebrow}>Architecture</span>
          <h2 className={landing.h2}>A standard AWS stack you can read in one sitting</h2>
          <p className={landing.lead}>
            Everything runs in your account, created by Terraform. Locally, Docker Compose runs the same web and api
            images with PostgreSQL, Mailpit and a mock model instead.
          </p>
        </div>

        <figure className={styles.figure}>
          <DiagramSvg />
          <DiagramStack />
          <figcaption className={styles.caption}>
            One request path for everything; the GPU is the only expensive part, and it only exists while it is
            needed.
          </figcaption>
        </figure>

        <ul className={styles.decisions}>
          {DECISIONS.map(({ icon: Icon, title, text }) => (
            <li key={title} className={styles.decision}>
              <Icon size={18} aria-hidden className={styles.decisionIcon} />
              <div>
                <strong>{title}.</strong> {text}
              </div>
            </li>
          ))}
        </ul>

        <Link href="/docs/architecture" className={landing.moreLink}>
          Read the architecture docs <ArrowRight size={16} aria-hidden />
        </Link>
      </div>
    </section>
  );
}
