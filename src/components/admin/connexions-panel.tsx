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

function eventTone(type: ConnexionEventType): string {
  if (type === "login") return "ok";
  if (type === "logout") return "muted";
  if (type === "echec_login") return "warn";
  return "bad";
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

  return (
    <div className="admin-connexions">
      <header className="admin-connexions-head">
        <div>
          <h2 className="panel-title">Connexions en temps réel</h2>
          <p className="muted">
            Présence live (rafraîchi toutes les {Math.round(POLL_MS / 1000)} s)
            · sessions inactives après {board?.staleAfterSeconds ?? 90} s
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
          <section className="admin-connexions-live" aria-live="polite">
            <h3>
              En ligne maintenant
              <span className="admin-section-badge">{board?.active.length ?? 0}</span>
            </h3>
            {(board?.active.length ?? 0) === 0 ? (
              <p className="muted">Personne connecté pour le moment.</p>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Compte</th>
                      <th>Rôle</th>
                      <th>Site</th>
                      <th>Équipe</th>
                      <th>Connecté depuis</th>
                      <th>Dernier signal</th>
                      <th>IP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {board!.active.map((s) => (
                      <tr key={s.id}>
                        <td>
                          <strong>{s.name}</strong>
                          <div className="muted mono">@{s.username}</div>
                        </td>
                        <td>{ROLE_LABELS[s.role as UserRole] ?? s.role}</td>
                        <td>{SITE_LABELS[s.site as UserSite] ?? s.site}</td>
                        <td>
                          {s.shift
                            ? (SHIFT_LABELS[s.shift as UserShift] ?? s.shift)
                            : "—"}
                        </td>
                        <td>{formatWhen(s.connectedAt)}</td>
                        <td>{formatWhen(s.lastSeenAt)}</td>
                        <td className="mono">{s.ip ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="admin-connexions-journal">
            <h3>Journal des mouvements</h3>
            {(board?.events.length ?? 0) === 0 ? (
              <p className="muted">Aucun mouvement enregistré.</p>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Quand</th>
                      <th>Événement</th>
                      <th>Compte</th>
                      <th>Détail</th>
                      <th>IP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {board!.events.map((ev: ConnexionEvent) => (
                      <tr key={ev.id} data-tone={eventTone(ev.type)}>
                        <td>{formatWhen(ev.at)}</td>
                        <td>{connexionEventLabel(ev.type)}</td>
                        <td>
                          {ev.name ? (
                            <>
                              <strong>{ev.name}</strong>
                              <div className="muted mono">@{ev.username}</div>
                            </>
                          ) : (
                            <span className="mono">@{ev.username}</span>
                          )}
                        </td>
                        <td>{ev.detail}</td>
                        <td className="mono">{ev.ip ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
