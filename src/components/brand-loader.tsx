"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { APP_LOGO, APP_NAME, APP_TAGLINE } from "@/lib/brand";
import "./brand-loader.css";
import { BrandLogoMark } from "@/components/brand-logo-mark";
import {
  acquireBrandLoad,
  getBrandLoadSnapshot,
  subscribeBrandLoad,
} from "@/lib/brand-load-store";

const EMPTY_BRAND_LOAD = { count: 0, label: "Chargement…" };

function Overlay({
  label,
  leaving = false,
}: {
  label: string;
  leaving?: boolean;
}) {
  return (
    <div
      className={`intro-loader${leaving ? " is-leaving" : ""}`}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <div className="intro-loader__content">
        <div className="intro-loader__mark">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={APP_LOGO} alt="" width={226} height={215} />
          <svg
            className="intro-loader__draw"
            viewBox="0 0 226 215"
            aria-hidden
            focusable="false"
          >
            <path
              className="draw-crown"
              pathLength={1}
              d="M84 45 86 16 102 32 117 8 132 32 148 16 150 45Z"
            />
            <path
              className="draw-body"
              pathLength={1}
              d="M62 90C80 62 128 52 168 64 186 70 192 82 190 90 186 102 168 114 138 113 104 114 78 108 62 90Z"
            />
            <path
              className="draw-tail"
              pathLength={1}
              d="M62 90 34 64C40 80 40 100 34 118Z"
            />
            <path
              className="draw-detail"
              pathLength={1}
              d="M171 80a6 6 0 1 0 12 0 6 6 0 1 0-12 0M120 68C108 82 108 98 120 110M40 206H186"
            />
          </svg>
          <span className="intro-loader__shine" aria-hidden />
        </div>
        <span className="intro-loader__caption">{APP_TAGLINE}</span>
        <span className="intro-loader__track" aria-hidden>
          <span />
        </span>
        <span className="sr-only">
          {label} · {APP_NAME}
        </span>
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
  const active = state.count >= 1;
  const [shown, setShown] = useState(active);
  const [lastLabel, setLastLabel] = useState(state.label);

  useEffect(() => {
    if (active) {
      setShown(true);
      setLastLabel(state.label);
      return;
    }
    // Chargement terminé : fondu de sortie, puis retrait de l’overlay.
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t = window.setTimeout(() => setShown(false), reduce ? 0 : 300);
    return () => window.clearTimeout(t);
  }, [active, state.label]);

  if (!active && !shown) return null;
  return <Overlay label={active ? state.label : lastLabel} leaving={!active} />;
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
