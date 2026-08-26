"use client";

import { useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { usePageChrome } from "@/components/page-chrome-context";

type AppShellProps = {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  mainClassName?: string;
  children: React.ReactNode;
};

/**
 * Remonte titre / sous-titre / actions dans le chrome sticky (barre + header).
 * Les actions sont portées via portal vers le slot du frame — ainsi un
 * ExportExcelButton qui n'existe qu'après le chargement du board apparaît
 * aussi bien sur mobile que sur desktop (l'ancien setChrome omettait `actions`
 * des deps et figait souvent `undefined`).
 */
export function AppShell({
  title,
  subtitle,
  actions,
  mainClassName,
  children,
}: AppShellProps) {
  const { setMeta, actionsSlot } = usePageChrome();

  useLayoutEffect(() => {
    setMeta({ title, subtitle, mainClassName });
  }, [title, subtitle, mainClassName, setMeta]);

  return (
    <>
      {actions && actionsSlot
        ? createPortal(actions, actionsSlot)
        : null}
      {children}
    </>
  );
}
