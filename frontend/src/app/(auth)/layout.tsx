import type { ReactNode } from "react";
import { AuthShell } from "@/components/auth/AuthShell";

/** Login, sign-up, email verification and password reset share one centered card. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return <AuthShell>{children}</AuthShell>;
}
