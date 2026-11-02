"use client";

import { useEffect, useRef } from "react";

/**
 * Prévient la page dès que les données du serveur ont changé (vente saisie sur
 * un autre poste, validation, annulation, caisse…). Interrogation légère du
 * compteur « en direct » toutes les quelques secondes, uniquement quand
 * l'onglet est visible ; reprise immédiate au retour sur l'onglet.
 */
export function useLiveRefresh(onChange: () => void, intervalMs = 3000): void {
  const callback = useRef(onChange);
  useEffect(() => {
    callback.current = onChange;
  });

  useEffect(() => {
    let last: number | null = null;
    let busy = false;

    const tick = async () => {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        const res = await fetch("/api/live", { cache: "no-store" });
        if (!res.ok) return;
        const { seq } = (await res.json()) as { seq: number };
        if (last !== null && seq !== last) callback.current();
        last = seq;
      } catch {
        /* réseau coupé : nouvel essai au prochain tour */
      } finally {
        busy = false;
      }
    };

    void tick();
    const timer = window.setInterval(() => void tick(), intervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [intervalMs]);
}
