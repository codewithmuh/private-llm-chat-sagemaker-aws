import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SiteFooter } from "@/components/landing/SiteFooter";
import { SiteHeader } from "@/components/landing/SiteHeader";

/**
 * The public pages: the product landing page ("/") and the docs ("/docs").
 * No auth guard here; they are rendered to static HTML at build time.
 */
export const metadata: Metadata = {
  title: {
    default: "Private LLM Chat: your own ChatGPT, on your own GPU",
    template: "%s · Private LLM Chat",
  },
  description:
    "Deploy open-source LLMs (Qwen, Llama, Gemma, DeepSeek…) on Amazon SageMaker with vLLM, with a private ChatGPT-style app in front: Google sign-in, 2FA, documents, images, OCR, and GPUs that switch themselves off.",
};

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main id="main">{children}</main>
      <SiteFooter />
    </>
  );
}
