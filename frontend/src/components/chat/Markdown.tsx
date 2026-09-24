"use client";

/**
 * Renders a model's Markdown answer:
 *   - GitHub-flavoured Markdown (tables, task lists, strikethrough) via remark-gfm
 *   - math ($$…$$, \(…\), \[…\]) via remark-math + KaTeX
 *   - syntax-highlighted code blocks via rehype-highlight
 *
 * Raw HTML in the answer is NOT rendered (react-markdown escapes it), so a
 * model can't inject scripts. Links open in a new tab, and remote images are
 * shown as links instead of being loaded, so an answer can't make your
 * browser contact another server without a click.
 */
import { memo, type ReactNode } from "react";
import ReactMarkdown, { type Components, type ExtraProps, type Options } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { Check, Copy, ImageIcon } from "lucide-react";
import { useCopy } from "@/hooks/useCopy";
import { normaliseMath } from "@/lib/markdown";
import styles from "./Markdown.module.css";

type HastElement = NonNullable<ExtraProps["node"]>;
type HastNode = HastElement | HastElement["children"][number];

/** The plain text inside a syntax tree node (what "Copy" should copy). */
function textOf(node: HastNode): string {
  if (node.type === "text") return node.value;
  if (node.type === "element") return node.children.map(textOf).join("");
  return "";
}

function CodeBlock({ node, children }: { node?: HastElement; children: ReactNode }) {
  const [copied, copy] = useCopy();
  const code = node?.children.find((c): c is HastElement => c.type === "element" && c.tagName === "code");
  const classes = code?.properties?.className;
  const language = (Array.isArray(classes) ? classes : [])
    .map(String)
    .find((c) => c.startsWith("language-"))
    ?.slice("language-".length);
  const text = code ? textOf(code).replace(/\n$/, "") : "";

  return (
    <div className={styles.codeBlock}>
      <div className={styles.codeHeader}>
        <span>{language || "text"}</span>
        <button type="button" className={styles.codeCopy} onClick={() => void copy(text)} aria-label="Copy code">
          {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

const components: Components = {
  pre: ({ node, children }) => <CodeBlock node={node}>{children}</CodeBlock>,
  a: ({ href, title, children }) => (
    <a href={href} title={title} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className={styles.tableWrap}>
      <table>{children}</table>
    </div>
  ),
  img: ({ src, alt }) =>
    typeof src === "string" && src ? (
      <a href={src} target="_blank" rel="noopener noreferrer" className={styles.imageLink}>
        <ImageIcon size={14} aria-hidden /> {alt || "Image"}
      </a>
    ) : null,
};

const remarkPlugins: Options["remarkPlugins"] = [remarkGfm, [remarkMath, { singleDollarTextMath: false }]];
const rehypePlugins: Options["rehypePlugins"] = [rehypeKatex, [rehypeHighlight, { detect: false }]];

export const Markdown = memo(function Markdown({ content, streaming = false }: { content: string; streaming?: boolean }) {
  return (
    <div className={styles.prose} data-streaming={streaming || undefined}>
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
        {normaliseMath(content)}
      </ReactMarkdown>
    </div>
  );
});
