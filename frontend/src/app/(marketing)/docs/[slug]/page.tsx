import type { Metadata } from "next";
import { DocArticle } from "@/components/docs/DocArticle";
import { getDoc, listDocs } from "@/content/docs";

interface Props {
  params: Promise<{ slug: string }>;
}

// One static page per docs/*.md file, generated at build time. Any other
// /docs/<slug> is a 404 (no rendering on demand).
export const dynamicParams = false;

export function generateStaticParams(): { slug: string }[] {
  return listDocs()
    .filter((doc) => doc.slug !== "")
    .map((doc) => ({ slug: doc.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const doc = getDoc(slug);
  return doc ? { title: doc.title, description: doc.description } : {};
}

export default async function DocPage({ params }: Props) {
  const { slug } = await params;
  return <DocArticle slug={slug} />;
}
