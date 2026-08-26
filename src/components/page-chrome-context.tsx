"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type PageChromeMeta = {
  title: string;
  subtitle?: string;
  mainClassName?: string;
};

const DEFAULT_META: PageChromeMeta = {
  title: "King Fish",
};

type PageChromeContextValue = {
  meta: PageChromeMeta;
  setMeta: (meta: PageChromeMeta) => void;
  /** Emplacement DOM de la barre d’actions (Excel, etc.) — rendu via portail. */
  actionsSlot: HTMLElement | null;
  setActionsSlot: (el: HTMLElement | null) => void;
};

const PageChromeContext = createContext<PageChromeContextValue | null>(null);

export function PageChromeProvider({ children }: { children: ReactNode }) {
  const [meta, setMetaState] = useState<PageChromeMeta>(DEFAULT_META);
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null);

  const setMeta = useCallback((next: PageChromeMeta) => {
    setMetaState((prev) => {
      if (
        prev.title === next.title &&
        prev.subtitle === next.subtitle &&
        prev.mainClassName === next.mainClassName
      ) {
        return prev;
      }
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ meta, setMeta, actionsSlot, setActionsSlot }),
    [meta, setMeta, actionsSlot],
  );

  return (
    <PageChromeContext.Provider value={value}>
      {children}
    </PageChromeContext.Provider>
  );
}

export function usePageChrome() {
  const ctx = useContext(PageChromeContext);
  if (!ctx) {
    throw new Error("usePageChrome doit être utilisé dans PageChromeProvider");
  }
  return ctx;
}

/** Ancien type conservé pour les imports éventuels. */
export type PageChrome = PageChromeMeta & { actions?: ReactNode };
