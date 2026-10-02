"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { APP_LOGO, APP_NAME } from "@/lib/brand";
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
      className={`brand-loader-voile${leaving ? " is-leaving" : ""}`}
      role="status"
      aria-live="polite"
    >
      <svg
        className="kfl-waves"
        viewBox="0 0 1440 220"
        preserveAspectRatio="none"
        aria-hidden
        focusable="false"
      >
        <path
          d="M0 90C240 20 420 150 720 150s520-130 720-60v130H0Z"
          fill="#cfe2f6"
          opacity="0.55"
        />
        <path
          d="M0 150C260 90 460 200 760 190s460-110 680-50v80H0Z"
          fill="#a9cbee"
          opacity="0.4"
        />
        <path
          d="M0 120C260 80 460 170 760 160s460-90 680-30"
          fill="none"
          stroke="#f5b400"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
      <div className="brand-loader-inner">
        <div className="kfl-mark">
          <svg className="kfl-ring" viewBox="0 0 160 160" aria-hidden focusable="false">
            <circle cx="80" cy="80" r="72" fill="none" stroke="#dce8f3" strokeWidth="2" />
            <circle
              className="kfl-arc"
              cx="80"
              cy="80"
              r="72"
              fill="none"
              stroke="#f5b400"
              strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray="120 332"
            />
          </svg>
          <span className="kfl-dot kfl-dot-a" />
          <span className="kfl-dot kfl-dot-b" />
          <span className="kfl-dot kfl-dot-c" />
          <span className="kfl-plate">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={APP_LOGO} alt="" width={96} height={96} />
          </span>
        </div>
        <p className="kfl-title">{label}</p>
        <p className="kfl-sub">Veuillez patienter, nous récupérons vos données.</p>
        <div className="kfl-bar" aria-hidden>
          <span />
        </div>
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
