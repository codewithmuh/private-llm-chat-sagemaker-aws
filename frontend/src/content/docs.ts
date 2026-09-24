/**
 * The documentation pages are the repository's own Markdown files in
 * ../docs/*.md, read at BUILD time: one static page per file, so docs/ stays
 * the single source of truth (GitHub renders the same files).
 * Server-only: it uses the file system.
 */
import fs from "node:fs";
import path from "node:path";

const DOCS_DIR = path.join(process.cwd(), "..", "docs");

export interface DocMeta {
  /** URL segment: the file name without ".md" ("" for README.md, the index). */
  slug: string;
  file: string;
  /** The first "# " heading. */
  title: string;
  /** Short label for the navigation. */
  label: string;
  /** The first paragraph, for <meta name="description">. */
  description: string;
}

export interface Doc extends DocMeta {
  markdown: string;
}

export interface NavGroup {
  title: string;
  items: DocMeta[];
}

/** Guides are read in order; reference pages in this order. */
const GUIDES = [
  "01-quickstart-local",
  "02-run-a-real-model-locally",
  "03-deploy-a-model-on-sagemaker",
  "04-deploy-the-full-stack-on-aws",
  "05-advanced",
];
const REFERENCE = [
  "architecture",
  "models",
  "authentication",
  "configuration",
  "api",
  "cost",
  "troubleshooting",
  "roadmap",
];

const LABELS: Record<string, string> = {
  "": "Overview",
  "01-quickstart-local": "1. Run it on your laptop",
  "02-run-a-real-model-locally": "2. A real model, locally",
  "03-deploy-a-model-on-sagemaker": "3. Your GPU on SageMaker",
  "04-deploy-the-full-stack-on-aws": "4. Everything on AWS",
  "05-advanced": "5. Advanced topics",
  architecture: "Architecture",
  models: "Models",
  authentication: "Authentication",
  configuration: "Configuration",
  api: "REST API",
  cost: "Cost",
  troubleshooting: "Troubleshooting",
  roadmap: "Roadmap",
};

function slugOf(file: string): string {
  return file === "README.md" ? "" : file.replace(/\.md$/, "");
}

/** Plain text of a line of Markdown (for titles and descriptions). */
function plain(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function describe(markdown: string): { title: string; description: string } {
  const lines = markdown.split("\n");
  const title = plain(lines.find((l) => l.startsWith("# "))?.slice(2) ?? "");
  // First paragraph after the title that is ordinary text.
  const paragraphs = markdown.split(/\n\s*\n/).map((p) => p.trim());
  const first = paragraphs.find((p) => p && !/^(#|```|\||>|-|\d+\.|!\[|<)/.test(p)) ?? "";
  const description = plain(first).slice(0, 200);
  return { title, description };
}

function readDoc(file: string): Doc {
  const markdown = fs.readFileSync(path.join(DOCS_DIR, file), "utf8");
  const slug = slugOf(file);
  const { title, description } = describe(markdown);
  return { slug, file, title, description, label: LABELS[slug] ?? title, markdown };
}

export function listDocs(): DocMeta[] {
  let files: string[] = [];
  try {
    files = fs.readdirSync(DOCS_DIR).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
  return files.map((file) => {
    const doc = readDoc(file);
    return { slug: doc.slug, file: doc.file, title: doc.title, label: doc.label, description: doc.description };
  });
}

export function getDoc(slug: string): Doc | null {
  const file = slug === "" ? "README.md" : `${slug}.md`;
  // Only names we listed: never let a URL walk out of docs/.
  if (!listDocs().some((d) => d.file === file)) return null;
  return readDoc(file);
}

/** The sidebar: Overview, Guides (01–05), Reference (+ any other file). */
export function docsNav(): NavGroup[] {
  const all = listDocs();
  const bySlug = new Map(all.map((d) => [d.slug, d]));
  const pick = (slugs: string[]) => slugs.map((s) => bySlug.get(s)).filter((d): d is DocMeta => Boolean(d));
  const known = new Set(["", ...GUIDES, ...REFERENCE]);
  const others = all.filter((d) => !known.has(d.slug)).sort((a, b) => a.slug.localeCompare(b.slug));
  return [
    { title: "Start here", items: pick([""]) },
    { title: "Guides", items: pick(GUIDES) },
    { title: "Reference", items: [...pick(REFERENCE), ...others] },
  ].filter((g) => g.items.length > 0);
}

/** Previous / next page, for the guides only. */
export function guideNeighbours(slug: string): { prev: DocMeta | null; next: DocMeta | null } {
  const index = GUIDES.indexOf(slug);
  if (index < 0) return { prev: null, next: null };
  const all = new Map(listDocs().map((d) => [d.slug, d]));
  return {
    prev: index > 0 ? (all.get(GUIDES[index - 1]) ?? null) : (all.get("") ?? null),
    next: index < GUIDES.length - 1 ? (all.get(GUIDES[index + 1]) ?? null) : null,
  };
}
