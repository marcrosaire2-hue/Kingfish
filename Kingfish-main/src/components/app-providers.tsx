"use client";

import type { ReactNode } from "react";
import { BrandLoadHost } from "@/components/brand-loader";
import { SessionProvider } from "@/components/session-provider";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      {children}
      <BrandLoadHost />
    </SessionProvider>
  );
}
