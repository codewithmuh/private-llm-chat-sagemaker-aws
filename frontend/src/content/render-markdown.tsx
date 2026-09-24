/**
 * Markdown -> React for the docs pages. Runs at BUILD time in a server
 * component, so none of this code (or highlight.js) ships to the browser.
 *
 *   remark-parse + remark-gfm     Markdown (with GitHub tables, task lists…)
 *   remark-rehype                 -> HTML syntax tree (hast)
 *   rehypeDocs (below)            heading ids + table of contents, link rewriting
 *   rehype-highlight              code colors (class names styled by highlight.css)
 *   hast-util-to-jsx-runtime      -> React elements, with our own components
 *
 * Raw HTML in the Markdown is shown as text, never rendered.
 */
import path from "node:path";
import type { ReactNode } from "react";
import Link from "next/link";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import type { Element, ElementContent, Root as HastRoot, RootContent } from "hast";
import type { Root as MdastRoot, Text as MdastText } from "mdast";
import { toJsxRuntime, type Components, type Jsx } from "hast-util-to-jsx-runtime";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { CopyCodeButton } from "@/components/docs/CopyCodeButton";
import { Mermaid } from "@/components/docs/Mermaid";
import styles from "@/components/docs/docs.module.css";
import { GITHUB_URL, repoFileUrl } from "@/lib/site";
import type { TocItem } from "./types";

export type { TocItem };

/* ------------------------------------------------------------ helpers */

type HastNode = HastRoot | RootContent | ElementContent;

function textOf(node: HastNode): string {
  if (node.type === "text") return node.value;
  if (node.type === "element" || node.type === "root") {
    return (node.children as HastNode[]).map(textOf).join("");
  }
  return "";
}

/**
 * GitHub-style heading ids ("Auth — `/api/auth/`" -> "auth--apiauth"), so
 * `#anchors` written for GitHub work here too. Same rules as github-slugger:
 * lower-case, drop punctuation and symbols, spaces become "-", and repeats
 * get "-1", "-2"…
 */
function createSlugger() {
  const seen = new Map<string, number>();
  return (text: string): string => {
    const base = text
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
      .replace(/ /g, "-");
    let slug = base;
    while (seen.has(slug)) {
      const count = (seen.get(base) ?? 0) + 1;
      seen.set(base, count);
      slug = `${base}-${count}`;
    }
    seen.set(slug, 0);
    return slug;
  };
}

/**
 * Where a link in docs/<file>.md should point on this site:
 *   "models.md#gpu"        -> "/docs/models#gpu"
 *   "README.md"            -> "/docs"
 *   "../ml/README.md"      -> the file on GitHub
 *   "https://…", "mailto:" -> unchanged (opens in a new tab)
 */
export function rewriteHref(href: string): { href: string; external: boolean } {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return { href, external: /^https?:/i.test(href) };
  if (href.startsWith("#")) return { href, external: false };

  const [target, hash] = href.split("#", 2);
  const fragment = hash ? `#${hash}` : "";
  const clean = target.replace(/^\.\//, "");
  if (clean && !clean.includes("/") && clean.endsWith(".md")) {
    const slug = clean === "README.md" ? "" : clean.slice(0, -3);
    return { href: `/docs${slug ? `/${slug}` : ""}${fragment}`, external: false };
  }
  // Anything else in the repo (code, other READMEs, folders): link to GitHub.
  const resolved = path.posix.normalize(path.posix.join("docs", clean));
  if (resolved.startsWith("..")) return { href: GITHUB_URL, external: true };
  return { href: `${repoFileUrl(resolved)}${fragment}`, external: true };
}

/* ------------------------------------------------------------ plugins */

/** Show raw HTML ("<app_url>" in prose, say) as literal text. */
function remarkHtmlAsText() {
  return (tree: MdastRoot) => {
    visit(tree, "html", (node, index, parent) => {
      if (!parent || index === undefined) return;
      const text: MdastText = { type: "text", value: node.value };
      parent.children.splice(index, 1, text);
    });
  };
}

/** Heading ids + table of contents, and link / image rewriting. */
function rehypeDocs(options: { toc: TocItem[] }) {
  return (tree: HastRoot) => {
    const slug = createSlugger();
    visit(tree, "element", (node: Element) => {
      const tag = node.tagName;
      if (/^h[1-6]$/.test(tag)) {
        const text = textOf(node).trim();
        const id = slug(text);
        node.properties.id = id;
        if (tag === "h2" || tag === "h3") options.toc.push({ id, text, depth: tag === "h2" ? 2 : 3 });
        // A "#" link to copy the section's URL, shown on hover.
        node.children.push({
          type: "element",
          tagName: "a",
          properties: { href: `#${id}`, className: [styles.anchor], ariaLabel: `Link to “${text}”` },
          children: [{ type: "text", value: "#" }],
        });
      } else if (tag === "a" && typeof node.properties.href === "string") {
        const { href, external } = rewriteHref(node.properties.href);
        node.properties.href = href;
        if (external) {
          node.properties.target = "_blank";
          node.properties.rel = ["noopener", "noreferrer"];
        }
      } else if (tag === "img" && typeof node.properties.src === "string") {
        const src = node.properties.src;
        if (!/^[a-z][a-z0-9+.-]*:/i.test(src) && !src.startsWith("/")) {
          node.properties.src = `${GITHUB_URL}/raw/main/${path.posix.normalize(path.posix.join("docs", src))}`;
        }
      }
    });
  };
}

/* --------------------------------------------------------- components */

function CodeBlock({ node, children }: { node?: Element; children?: ReactNode }) {
  const code = node?.children.find((c): c is Element => c.type === "element" && c.tagName === "code");
  const classes = code?.properties.className;
  const language = (Array.isArray(classes) ? classes : [])
    .map(String)
    .find((c) => c.startsWith("language-"))
    ?.slice("language-".length);
  const text = code ? textOf(code).replace(/\n$/, "") : "";

  if (language === "mermaid") return <Mermaid source={text} />;

  return (
    <div className={styles.codeBlock}>
      <div className={styles.codeHeader}>
        <span>{language || "text"}</span>
        <CopyCodeButton text={text} />
      </div>
      <pre>{children}</pre>
    </div>
  );
}

const components: Partial<Components> = {
  pre: CodeBlock,
  table: ({ children }) => (
    <div className={styles.tableWrap}>
      <table>{children}</table>
    </div>
  ),
  a: ({ href, children, target, rel, className, "aria-label": ariaLabel }) =>
    href?.startsWith("/") ? (
      <Link href={href} className={className} aria-label={ariaLabel}>
        {children}
      </Link>
    ) : (
      <a href={href} target={target} rel={rel} className={className} aria-label={ariaLabel}>
        {children}
      </a>
    ),
};

/* --------------------------------------------------------------- main */

export function renderMarkdown(markdown: string): { content: ReactNode; toc: TocItem[] } {
  const toc: TocItem[] = [];
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkHtmlAsText)
    .use(remarkRehype)
    .use(rehypeDocs, { toc })
    .use(rehypeHighlight, { detect: false, plainText: ["mermaid", "text", "txt"] });

  const hast = processor.runSync(processor.parse(markdown)) as HastRoot;
  const content = toJsxRuntime(hast, {
    Fragment,
    // React's jsx() is typed more narrowly than the generic runtime signature.
    jsx: jsx as unknown as Jsx,
    jsxs: jsxs as unknown as Jsx,
    components,
    passNode: true,
  });
  return { content, toc };
}
