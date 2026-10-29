"use client";

import { useCallback, useEffect, useState } from "react";
import { BrandLoader } from "@/components/brand-loader";
import { formatFcfa } from "@/lib/format";
import { SITE_LABELS } from "@/lib/auth-types";
import type { PosTicket } from "@/lib/types";

type Totals = { count: number; montant: number };
type Payload = {
  from: string;
  to: string;
  pending: PosTicket[];
  validated: PosTicket[];
  totals: Record<"zogbo" | "gbegamey" | "all" | "pending", Totals>;
  error?: string;
};

function csvCell(value: unknown): string {
  const s = String(value ?? "");
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportCsv(tickets: PosTicket[], from: string, to: string) {
  const header = [
    "Date",
    "Heure",
    "Site",
    "Ticket",
    "Saisi par",
    "Validé par",
    "Montant (FCFA)",
    "Articles",
  ];
  const rows = tickets.map((t) => {
    const validatedBy = (t as PosTicket & { validatedByName?: string | null })
      .validatedByName;
    return [
      t.date,
      t.at.slice(11, 16),
      SITE_LABELS[t.site as keyof typeof SITE_LABELS] ?? t.site,
      t.numero,
      t.userName,
      validatedBy ?? "",
      t.montant,
      t.lines.map((l) => `${l.qty} x ${l.name}`).join(" + "),
    ];
  });
  const csv = [header, ...rows].map((r) => r.map(csvCell).join(";")).join("\r\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ventes-direction_${from}_${to}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function DirectionSalesPanel() {
  const [from, setFrom] = useState(() => `${today().slice(0, 8)}01`);
  const [to, setTo] = useState(() => today());
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/ventes-direction?from=${from}&to=${to}`,
        { cache: "no-store" },
      );
      const body = (await res.json()) as Payload;
      if (!res.ok) throw new Error(body.error || "Chargement impossible.");
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    // Chargement initial et à chaque changement de période.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function act(
    ticket: PosTicket,
    action: "approve-direction" | "cancel",
  ) {
    const label = `${ticket.numero} (${formatFcfa(ticket.montant)})`;
    const ok = window.confirm(
      action === "approve-direction"
        ? `Valider la vente direction ${label} ? Elle ne sera jamais comptée dans le CA des ventes clients.`
        : `Refuser la vente direction ${label} ? Le stock sera remis.`,
    );
    if (!ok) return;
    setBusyId(ticket.id);
    setError(null);
    setFlash(null);
    try {
      const res = await fetch("/api/pos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          id: ticket.id,
          date: ticket.date,
          site: ticket.site,
        }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error || "Action impossible.");
      setFlash(
        action === "approve-direction"
          ? `Vente direction ${ticket.numero} validée.`
          : `Vente direction ${ticket.numero} refusée.`,
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action impossible.");
    } finally {
      setBusyId(null);
    }
  }

  const siteLabel = (t: PosTicket) =>
    SITE_LABELS[t.site as keyof typeof SITE_LABELS] ?? t.site;

  return (
    <div className="equipe-mail">
      <header className="equipe-mail-hero">
        <div>
          <h2>Ventes direction</h2>
          <p>
            Hors chiffre d&apos;affaires des ventes clients, avant comme après
            validation. Un autre administrateur que celui qui a saisi la vente
            doit la valider.
          </p>
        </div>
      </header>

      {flash ? (
        <p className="equipe-flash" role="status">
          {flash}
        </p>
      ) : null}
      {error ? (
        <p className="error-banner" role="alert">
          {error}
        </p>
      ) : null}

      {loading && !data ? (
        <BrandLoader variant="ligne" label="Chargement des ventes direction…" />
      ) : null}

      {data ? (
        <div className="equipe-mail-grid">
          <section className="equipe-mail-panel">
            <h3>
              À valider · {data.totals.pending.count} (
              {formatFcfa(data.totals.pending.montant)})
            </h3>
            {data.pending.length ? (
              <ul className="equipe-mail-list">
                {data.pending.map((t) => (
                  <li key={t.id}>
                    <span>
                      <strong>{t.numero}</strong> · {t.date} · {siteLabel(t)} ·{" "}
                      {formatFcfa(t.montant)}
                      <br />
                      <span className="muted">
                        {t.userName} ·{" "}
                        {t.lines.map((l) => `${l.qty} × ${l.name}`).join(", ")}
                      </span>
                    </span>
                    <span>
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={busyId !== null}
                        onClick={() => void act(t, "approve-direction")}
                      >
                        Valider
                      </button>{" "}
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={busyId !== null}
                        onClick={() => void act(t, "cancel")}
                      >
                        Refuser
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">Aucune vente direction en attente.</p>
            )}
          </section>

          <section className="equipe-mail-panel">
            <h3>Validées sur la période</h3>
            <div className="equipe-mail-add">
              <label>
                <span>Du</span>
                <input
                  type="date"
                  value={from}
                  max={to}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </label>
              <label>
                <span>Au</span>
                <input
                  type="date"
                  value={to}
                  min={from}
                  onChange={(e) => setTo(e.target.value)}
                />
              </label>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={!data.validated.length}
                onClick={() => exportCsv(data.validated, data.from, data.to)}
              >
                Exporter CSV
              </button>
            </div>
            <p>
              <strong>{formatFcfa(data.totals.all.montant)}</strong> ·{" "}
              {data.totals.all.count} vente(s) — Zogbo{" "}
              {formatFcfa(data.totals.zogbo.montant)} · Gbégamey{" "}
              {formatFcfa(data.totals.gbegamey.montant)}
            </p>
            {data.validated.length ? (
              <ul className="equipe-mail-list">
                {data.validated.slice(0, 50).map((t) => (
                  <li key={t.id}>
                    <span>
                      <strong>{t.numero}</strong> · {t.date} · {siteLabel(t)} ·{" "}
                      {formatFcfa(t.montant)}
                      <br />
                      <span className="muted">
                        {t.userName} ·{" "}
                        {t.lines.map((l) => `${l.qty} × ${l.name}`).join(", ")}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">Aucune vente direction validée sur cette période.</p>
            )}
            {data.validated.length > 50 ? (
              <p className="muted">
                50 premières lignes affichées — l&apos;export contient tout.
              </p>
            ) : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}
