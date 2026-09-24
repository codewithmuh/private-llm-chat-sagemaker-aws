import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, Pencil } from "lucide-react";
import { getDoc, guideNeighbours } from "@/content/docs";
import { renderMarkdown } from "@/content/render-markdown";
import { repoFileUrl } from "@/lib/site";
import { DocsToc } from "./DocsToc";
import styles from "./docs.module.css";

const hrefOf = (slug: string) => (slug ? `/docs/${slug}` : "/docs");

/** One docs page: the rendered Markdown, prev/next, "Edit on GitHub", and the TOC. */
export function DocArticle({ slug }: { slug: string }) {
  const doc = getDoc(slug);
  if (!doc) notFound();
  const { content, toc } = renderMarkdown(doc.markdown);
  const { prev, next } = guideNeighbours(slug);

  return (
    <div className={styles.page}>
      <article className={styles.article}>
        <div className={styles.prose}>{content}</div>

        {(prev || next) && (
          <nav className={styles.pager} aria-label="Guides">
            {prev && (
              <Link href={hrefOf(prev.slug)} className={styles.pagerLink} rel="prev">
                <span>
                  <ArrowLeft size={12} aria-hidden style={{ display: "inline" }} /> Previous
                </span>
                <strong>{prev.label}</strong>
              </Link>
            )}
            {next && (
              <Link href={hrefOf(next.slug)} className={`${styles.pagerLink} ${styles.pagerNext}`} rel="next">
                <span>
                  Next <ArrowRight size={12} aria-hidden style={{ display: "inline" }} />
                </span>
                <strong>{next.label}</strong>
              </Link>
            )}
          </nav>
        )}

        <div className={styles.meta}>
          <a
            href={repoFileUrl(`docs/${doc.file}`, "edit")}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.editLink}
          >
            <Pencil size={14} aria-hidden /> Edit this page on GitHub
          </a>
          <span>docs/{doc.file}</span>
        </div>
      </article>
      <DocsToc toc={toc} />
    </div>
  );
}
