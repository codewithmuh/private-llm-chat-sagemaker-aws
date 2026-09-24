"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useConfig } from "@/providers/ConfigProvider";

/**
 * "Get started" -> /signup, or /login when this deployment has sign-up turned
 * off (config.signup_enabled comes from GET /api/config/ at runtime).
 */
export function SignupLink({ className, children }: { className?: string; children: ReactNode }) {
  const { config } = useConfig();
  return (
    <Link href={config.signup_enabled ? "/signup" : "/login"} className={className}>
      {children}
    </Link>
  );
}
