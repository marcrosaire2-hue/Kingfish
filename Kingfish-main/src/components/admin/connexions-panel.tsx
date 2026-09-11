"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ROLE_LABELS,
  SHIFT_LABELS,
  SITE_LABELS,
  type UserRole,
  type UserShift,
  type UserSite,
} from "@/lib/auth-types";
import {
  connexionEventLabel,
  type ConnexionEvent,
  type ConnexionEventType,
  type ConnexionSession,
} from "@/lib/connexions-types";

type Board = {
  active: ConnexionSession[];
  events: ConnexionEvent[];
  serverTime: string;
  staleAfterSeconds: number;
};

const POLL_MS = 4000;

function formatWhen(iso: string): string {
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "short",
      timeStyle: "medium",
      timeZone: "Africa/Porto-Novo",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function formatTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      timeStyle: "medium",
      timeZone: "Africa/Porto-Novo",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function eventTone(type: ConnexionEventType): string {
  if (type === "login") return "ok";
  if (type === "logout") return "muted";
  if (type === "echec_login") return "warn";
  return "bad";
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
  return letters || "·";
}

export function ConnexionsPanel() {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/connexions", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Chargement impossible");
      setBoard(body as Board);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chargement impossible");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  const online = board?.active.length ?? 0;

  return (
    <div className="equipe-presence">
      <header className="equipe-presence-hero">
        <div className="equipe-presence-hero-main">
          <span className={`equipe-live-pill${online > 0 ? " is-on" : ""}`}>
            <span className="equipe-live-dot" aria-hidden />
            {loading && !board
              ? "Connexion…"
              : online > 0
                ? `${online} en ligne`
                : "Personne en ligne"}
          </span>
          <h2>Présence en temps réel</h2>
          <p>
            Rafraîchi toutes les {Math.round(POLL_MS / 1000)} s · une session
            devient inactive après {board?.staleAfterSeconds ?? 90} s sans
            signal.
          </p>
        </div>
        <button type="button" className="btn btn-ghost" onClick={() => void load()}>
          Actualiser
        </button>
      </header>

      {error ? (
        <p className="error-banner" role="alert">
          {error}
        </p>
      ) : null}

      {loading && !board ? (
        <p className="muted">Chargement…</p>
      ) : (
        <>
          <section aria-live="polite">
            {online === 0 ? (
              <div className="equipe-empty equipe-empty-soft">
                <strong>Aucune session active</strong>
                <p className="muted">
                  Les connexions apparaîtront ici dès qu’un compte ouvre
                  l’application.
                </p>
              </div>
            ) : (
              <div className="equipe-presence-grid">
                {board!.active.map((s) => (
                  <article key={s.id} className="equipe-presence-card">
                    <header>
                      <span className="equipe-avatar" data-role={s.role}>
                        {initials(s.name)}
                      </span>
                      <div>
                        <strong>{s.name}</strong>
                        <span className="mono">@{s.username}</span>
                      </div>
                      <span className="equipe-live-dot is-card" aria-hidden />
                    </header>
                    <ul>
                      <li>
                        <span>Rôle</span>
                        <strong>
                          {ROLE_LABELS[s.role as UserRole] ?? s.role}
                        </strong>
                      </li>
                      <li>
                        <span>Site</span>
                        <strong>
                          {SITE_LABELS[s.site as UserSite] ?? s.site}
                        </strong>
                      </li>
                      <li>
                        <span>Équipe</span>
                        <strong>
                          {s.shift
                            ? (SHIFT_LABELS[s.shift as UserShift] ?? s.shift)
                            : "—"}
                        </strong>
                      </li>
                      <li>
                        <span>Depuis</span>
                        <strong>{formatTime(s.connectedAt)}</strong>
                      </li>
                      <li>
                        <span>Dernier signal</span>
                        <strong>{formatTime(s.lastSeenAt)}</strong>
                      </li>
                      <li>
                        <span>IP</span>
                        <strong className="mono">{s.ip ?? "—"}</strong>
                      </li>
                    </ul>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="equipe-journal">
            <header className="equipe-journal-head">
              <h3>Journal des mouvements</h3>
              <span>{board?.events.length ?? 0}</span>
            </header>
            {(board?.events.length ?? 0) === 0 ? (
              <p className="muted">Aucun mouvement enregistré.</p>
            ) : (
              <ol className="equipe-timeline">
                {board!.events.map((ev: ConnexionEvent) => (
                  <li key={ev.id} data-tone={eventTone(ev.type)}>
                    <span className="equipe-timeline-mark" aria-hidden />
                    <div className="equipe-timeline-body">
                      <div className="equipe-timeline-meta">
                        <strong>{connexionEventLabel(ev.type)}</strong>
                        <time dateTime={ev.at}>{formatWhen(ev.at)}</time>
                      </div>
                      <p>
                        {ev.name ? (
                          <>
                            <strong>{ev.name}</strong>
                            <span className="mono"> @{ev.username}</span>
                          </>
                        ) : (
                          <span className="mono">@{ev.username}</span>
                        )}
                        {ev.detail ? ` — ${ev.detail}` : ""}
                      </p>
                      <span className="equipe-timeline-ip mono">
                        {ev.ip ?? "IP inconnue"}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}
    </div>
  );
}
