"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { usePageChrome } from "@/components/page-chrome-context";

/**
 * Déclare le titre / actions de la page courante.
 * Le cadre (menu + en-tête) est fourni par `(main)/layout.tsx` et reste
 * monté entre les navigations.
 */
export function AppShell({
  children,
  title,
  subtitle,
  actions,
  mainClassName,
}: {
  children: ReactNode;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  mainClassName?: string;
}) {
  const { setChrome } = usePageChrome();
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  useLayoutEffect(() => {
    setChrome({
      title,
      subtitle,
      actions: actionsRef.current,
      mainClassName,
    });
  }, [title, subtitle, mainClassName, setChrome]);

  return <>{children}</>;
}
