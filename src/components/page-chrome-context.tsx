"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type PageChrome = {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  mainClassName?: string;
};

const DEFAULT_CHROME: PageChrome = {
  title: "King Fish",
};

type PageChromeContextValue = {
  chrome: PageChrome;
  setChrome: (chrome: PageChrome) => void;
};

const PageChromeContext = createContext<PageChromeContextValue | null>(null);

export function PageChromeProvider({ children }: { children: ReactNode }) {
  const [chrome, setChromeState] = useState<PageChrome>(DEFAULT_CHROME);

  const setChrome = useCallback((next: PageChrome) => {
    setChromeState(next);
  }, []);

  const value = useMemo(
    () => ({ chrome, setChrome }),
    [chrome, setChrome],
  );

  return (
    <PageChromeContext.Provider value={value}>{children}</PageChromeContext.Provider>
  );
}

export function usePageChrome() {
  const ctx = useContext(PageChromeContext);
  if (!ctx) {
    throw new Error("usePageChrome doit être utilisé dans PageChromeProvider");
  }
  return ctx;
}
