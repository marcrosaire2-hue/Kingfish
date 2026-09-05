"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { APP_NAME } from "@/lib/brand";
import { BrandLogoMark } from "@/components/brand-logo-mark";
import {
  acquireBrandLoad,
  getBrandLoadSnapshot,
  subscribeBrandLoad,
} from "@/lib/brand-load-store";

const EMPTY_BRAND_LOAD = { count: 0, label: "Chargement…" };

function Overlay({ label }: { label: string }) {
  return (
    <div className="brand-loader-voile" role="status" aria-live="polite">
      <div className="brand-loader-inner">
        <BrandLogoMark size="md" />
        <span className="brand-loader-label">{label}</span>
        <span className="sr-only">{APP_NAME}</span>
      </div>
    </div>
  );
}

/** Une seule scène logo pour tout l’app — même si plusieurs BrandLoader
 *  s’empilent (loading.tsx + page). */
export function BrandLoadHost() {
  const state = useSyncExternalStore(
    subscribeBrandLoad,
    getBrandLoadSnapshot,
    () => EMPTY_BRAND_LOAD,
  );
  if (state.count < 1) return null;
  return <Overlay label={state.label} />;
}

/**
 * Attente à la marque.
 *
 * - `plein` / `voile` : un overlay unique, page masquée. Plusieurs appels
 *   partagent la même scène (pas un logo en haut et un en bas).
 * - `ligne` : attente locale dans un panneau déjà visible, sans second logo.
 */
export function BrandLoader({
  label = "Chargement…",
  variant = "plein",
}: {
  label?: string;
  variant?: "plein" | "voile" | "ligne";
}) {
  const [handedOff, setHandedOff] = useState(false);

  useEffect(() => {
    if (variant === "ligne") return;
    const release = acquireBrandLoad(label);
    setHandedOff(true);
    return release;
  }, [label, variant]);

  if (variant === "ligne") {
    return (
      <div
        className="brand-loader brand-loader-ligne"
        role="status"
        aria-live="polite"
      >
        <span className="brand-loader-wait" aria-hidden />
        <span className="brand-loader-label">{label}</span>
        <span className="sr-only">{APP_NAME}</span>
      </div>
    );
  }

  if (handedOff) return null;
  return <Overlay label={label} />;
}
