"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { NavKey, SessionUser } from "@/lib/auth-types";

type SessionPayload = {
  user: SessionUser;
  nav: NavKey[];
};

type SessionContextValue = {
  user: SessionUser | null;
  nav: NavKey[] | null;
  ready: boolean;
  refresh: () => Promise<void>;
};

/** v2 : invalide les menus figés après un changement de droits. */
const CACHE_KEY = "kf-session-v2";

const SessionContext = createContext<SessionContextValue | null>(null);

/** Cache mémoire : survit aux changements de page sans refetch. */
let memoryCache: SessionPayload | null = null;
let inflight: Promise<SessionPayload | null> | null = null;

function readStorageCache(): SessionPayload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionPayload;
    if (!parsed?.user?.id || !Array.isArray(parsed.nav)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStorageCache(payload: SessionPayload | null) {
  if (typeof window === "undefined") return;
  try {
    if (!payload) sessionStorage.removeItem(CACHE_KEY);
    else sessionStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {
    /* quota / mode privé */
  }
}

/** Toujours aller au réseau (sauf si un appel est déjà en cours). */
async function fetchSessionFromNetwork(): Promise<SessionPayload | null> {
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      if (!res.ok) {
        memoryCache = null;
        writeStorageCache(null);
        return null;
      }
      const body = await res.json();
      const payload: SessionPayload = {
        user: body.user as SessionUser,
        nav: body.nav as NavKey[],
      };
      memoryCache = payload;
      writeStorageCache(payload);
      return payload;
    } catch {
      return memoryCache ?? readStorageCache();
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  // Même état initial serveur / client : ne jamais lire sessionStorage ici
  // (sinon hydratation cassée — le menu sidebar ne matche pas le HTML SSR).
  const [user, setUser] = useState<SessionUser | null>(null);
  const [nav, setNav] = useState<NavKey[] | null>(null);
  const [ready, setReady] = useState(false);

  const apply = useCallback((payload: SessionPayload | null) => {
    if (payload) {
      setUser(payload.user);
      setNav(payload.nav);
      memoryCache = payload;
      writeStorageCache(payload);
    } else {
      setUser(null);
      setNav(null);
      memoryCache = null;
      writeStorageCache(null);
    }
    setReady(true);
  }, []);

  const refresh = useCallback(async () => {
    memoryCache = null;
    inflight = null;
    const payload = await fetchSessionFromNetwork();
    apply(payload);
  }, [apply]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Affichage immédiat depuis le cache, puis toujours revalidation API
      // (sinon un ancien menu reste figé après un changement de droits).
      const local = memoryCache ?? readStorageCache();
      if (local && !cancelled) apply(local);
      memoryCache = null;
      inflight = null;
      const payload = await fetchSessionFromNetwork();
      if (!cancelled) apply(payload);
    })();
    return () => {
      cancelled = true;
    };
  }, [apply]);

  const value = useMemo(
    () => ({ user, nav, ready, refresh }),
    [user, nav, ready, refresh],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error("useSession doit être utilisé dans SessionProvider");
  }
  return ctx;
}

export function clearSessionCache() {
  memoryCache = null;
  inflight = null;
  writeStorageCache(null);
}
