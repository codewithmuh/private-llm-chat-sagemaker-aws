import Image from "next/image";
import Link from "next/link";
import { ArrowRight, BookOpen } from "lucide-react";
import { GithubIcon } from "@/components/ui/GithubIcon";
import { GITHUB_URL } from "@/lib/site";
import { BrowserFrame } from "./BrowserFrame";
import { SignupLink } from "./SignupLink";
import styles from "./landing.module.css";

export function Hero() {
  return (
    <section className={styles.hero}>
      <div className={`${styles.container} ${styles.heroInner}`}>
        <span className={styles.pill}>
          <span className={styles.pillTag}>Open source</span>
          MIT licensed · runs in your AWS account
        </span>
        <h1 className={styles.h1}>
          Your own ChatGPT, on <em>your own GPU</em>, in your own AWS account.
        </h1>
        <p className={styles.heroLead}>
          Deploy open-source LLMs (Qwen, Llama, Gemma, DeepSeek…) on Amazon SageMaker with vLLM, with a private
          ChatGPT-style app in front: accounts with Google sign-in and 2FA, documents, images, OCR, and GPUs that
          switch themselves off.
        </p>
        <div className={styles.ctas}>
          <SignupLink className="btn btn-primary">
            Get started <ArrowRight size={17} aria-hidden />
          </SignupLink>
          <Link href="/docs" className="btn btn-secondary">
            <BookOpen size={17} aria-hidden /> Read the docs
          </Link>
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="btn btn-ghost">
            <GithubIcon size={17} /> GitHub
          </a>
        </div>
        <p className={styles.heroNote}>
          Or try it on your laptop in 5 minutes, no GPU needed: <code>make up</code>
        </p>

        <BrowserFrame url="chat.your-company.com">
          <Image
            src="/screenshots/chat.png"
            alt="The chat screen: conversations on the left, a streamed answer with a table and a code block on the right"
            width={1440}
            height={900}
            sizes="(max-width: 1128px) 100vw, 1080px"
            className={styles.onlyLight}
            loading="eager"
          />
          <Image
            src="/screenshots/chat-dark.png"
            alt="The chat screen in dark mode, with a document and an image attached"
            width={1440}
            height={900}
            sizes="(max-width: 1128px) 100vw, 1080px"
            className={styles.onlyDark}
            loading="eager"
          />
        </BrowserFrame>
      </div>
    </section>
  );
}
