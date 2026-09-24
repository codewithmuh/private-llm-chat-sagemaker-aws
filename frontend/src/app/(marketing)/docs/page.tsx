import type { Metadata } from "next";
import { DocArticle } from "@/components/docs/DocArticle";
import { getDoc } from "@/content/docs";

// docs/README.md is the index page.
export function generateMetadata(): Metadata {
  const doc = getDoc("");
  return { title: "Documentation", description: doc?.description || "Guides and reference for Private LLM Chat." };
}

export default function DocsIndexPage() {
  return <DocArticle slug="" />;
}
