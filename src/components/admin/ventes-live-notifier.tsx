"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SITE_LABELS } from "@/lib/auth-types";
import { formatFcfa } from "@/lib/format";
import type { VenteLiveEvent } from "@/lib/ventes-live-types";

const POLL_MS = 3500;
const SOUND_KEY = "kf-admin-vente-sound";
const TOAST_MS = 8000;

type Toast = VenteLiveEvent & { key: string };

function playVenteChime() {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const master = ctx.createGain();
    master.gain.setValueAtTime(0.22, now);
    master.connect(ctx.destination);

    const notes = [
      { freq: 784, start: 0, dur: 0.14 },
      { freq: 1046.5, start: 0.12, dur: 0.22 },
    ];
    for (const n of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(n.freq, now + n.start);
      gain.gain.setValueAtTime(0.0001, now + n.start);
      gain.gain.exponentialRampToValueAtTime(1, now + n.start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + n.start + n.dur);
      osc.connect(gain);
      gain.connect(master);
      osc.start(now + n.start);
      osc.stop(now + n.start + n.dur + 0.02);
    }

    window.setTimeout(() => {
      void ctx.close();
    }, 500);
  } catch {
    /* autoplay / AudioContext indisponible */
  }
}

function formatWhen(iso: string): string {
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      timeStyle: "medium",
      timeZone: "Africa/Porto-Novo",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function VentesLiveNotifier() {
  const [soundOn, setSoundOn] = useState(true);
  const [audioReady, setAudioReady] = useState(false);
  const [listening, setListening] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [error, setError] = useState<string | null>(null);

  const sinceRef = useRef<string | null>(null);
  const primedRef = useRef(false);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const soundOnRef = useRef(true);
  const audioReadyRef = useRef(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(SOUND_KEY);
      if (stored === "0") {
        setSoundOn(false);
        soundOnRef.current = false;
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    soundOnRef.current = soundOn;
    try {
      window.localStorage.setItem(SOUND_KEY, soundOn ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [soundOn]);

  useEffect(() => {
    audioReadyRef.current = audioReady;
  }, [audioReady]);

  const pushToasts = useCallback((events: VenteLiveEvent[]) => {
    if (events.length === 0) return;
    const ordered = [...events].sort((a, b) => a.at.localeCompare(b.at));
    const stamp = Date.now();
    const keyed = ordered.map((e, i) => ({
      ...e,
      key: `${e.id}-${stamp}-${i}`,
    }));
    setToasts((prev) => [...keyed, ...prev].slice(0, 5));
    for (const t of keyed) {
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((x) => x.key !== t.key));
      }, TOAST_MS);
    }
  }, []);

  const load = useCallback(async () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      return;
    }
    try {
      const q = sinceRef.current
        ? `?since=${encodeURIComponent(sinceRef.current)}`
        : "";
      const res = await fetch(`/api/admin/ventes-live${q}`, {
        cache: "no-store",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Flux ventes indisponible");

      const events = (body.events ?? []) as VenteLiveEvent[];
      const serverTime = (body.serverTime as string) || new Date().toISOString();

      if (!primedRef.current) {
        for (const e of events) seenIdsRef.current.add(e.id);
        const newest = events[0]?.at;
        sinceRef.current = newest && newest > serverTime ? newest : serverTime;
        primedRef.current = true;
        setListening(true);
        setError(null);
        return;
      }

      const fresh = events.filter((e) => !seenIdsRef.current.has(e.id));
      for (const e of fresh) seenIdsRef.current.add(e.id);

      if (fresh.length > 0) {
        pushToasts(fresh);
        if (soundOnRef.current && audioReadyRef.current) {
          playVenteChime();
        }
        const newestAt = fresh.reduce(
          (max, e) => (e.at > max ? e.at : max),
          sinceRef.current ?? "",
        );
        if (newestAt) sinceRef.current = newestAt;
      } else if (serverTime > (sinceRef.current ?? "")) {
        sinceRef.current = serverTime;
      }

      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Flux ventes indisponible");
    }
  }, [pushToasts]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    const onVis = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [load]);

  function unlockAudio() {
    setAudioReady(true);
    setSoundOn(true);
    playVenteChime();
  }

  function dismissToast(key: string) {
    setToasts((prev) => prev.filter((t) => t.key !== key));
  }

  return (
    <>
      <div
        className={`equipe-live-bar${listening && !error ? " is-on" : ""}`}
        role="status"
        aria-live="polite"
      >
        <span className="equipe-live-pill">
          <span className="equipe-live-dot" aria-hidden />
          Ventes live
        </span>
        {error ? (
          <span className="admin-vente-live-error">{error}</span>
        ) : (
          <span className="equipe-live-copy">
            {listening
              ? `À l’écoute · ${Math.round(POLL_MS / 1000)} s`
              : "Initialisation…"}
          </span>
        )}
        <span className="admin-vente-live-actions">
          {!audioReady && soundOn ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={unlockAudio}
            >
              Activer le son
            </button>
          ) : null}
          <button
            type="button"
            className={`btn btn-ghost${soundOn ? " is-active-sound" : ""}`}
            onClick={() => {
              const next = !soundOn;
              setSoundOn(next);
              if (next && !audioReady) {
                setAudioReady(true);
                playVenteChime();
              }
            }}
            aria-pressed={soundOn}
            title={
              soundOn
                ? "Couper le son des ventes"
                : "Activer le son des ventes"
            }
          >
            {soundOn ? "Son on" : "Son off"}
          </button>
        </span>
      </div>

      <div className="admin-vente-toasts" aria-live="assertive">
        {toasts.map((t) => (
          <article key={t.key} className="admin-vente-toast">
            <header>
              <strong>Nouvelle vente</strong>
              <button
                type="button"
                className="admin-vente-toast-close"
                aria-label="Fermer"
                onClick={() => dismissToast(t.key)}
              >
                ×
              </button>
            </header>
            <p className="admin-vente-toast-main">
              {SITE_LABELS[t.site] ?? t.site} · {t.numero}
            </p>
            <p className="admin-vente-toast-amount mono">
              {formatFcfa(t.montant)}
            </p>
            <p className="admin-vente-toast-meta muted">
              {t.userName}
              {t.serveurNom ? ` · ${t.serveurNom}` : ""}
              {" · "}
              {formatWhen(t.at)}
            </p>
          </article>
        ))}
      </div>
    </>
  );
}
