import { Architecture } from "@/components/landing/Architecture";
import { Cost } from "@/components/landing/Cost";
import { Faq } from "@/components/landing/Faq";
import { Features } from "@/components/landing/Features";
import { FinalCta } from "@/components/landing/FinalCta";
import { Hero } from "@/components/landing/Hero";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { Models } from "@/components/landing/Models";
import { Paths } from "@/components/landing/Paths";
import { TechStack } from "@/components/landing/TechStack";

/** "/": the product page. Static HTML, built once; no sign-in needed. */
export default function LandingPage() {
  return (
    <>
      <Hero />
      <Features />
      <HowItWorks />
      <Architecture />
      <Models />
      <Paths />
      <Cost />
      <TechStack />
      <Faq />
      <FinalCta />
    </>
  );
}
