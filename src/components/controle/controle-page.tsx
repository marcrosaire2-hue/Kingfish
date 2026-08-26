"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { ContextBar } from "@/components/context-bar";
import { BrandLoader } from "@/components/brand-loader";
import { computeGbegameyDay } from "@/lib/gbegamey-calc";
import type {
  BaseDish,
  GbegameyDay,
  GbegameyReceiptMovement,
  LocalDish,
} from "@/lib/types";
import { todayIsoDate } from "@/lib/zogbo-calc";

type Payload = {
  day: GbegameyDay;
  baseDishes: BaseDish[];
  localDishes: LocalDish[];
  sentByProductId: Record<string, number>;
  error?: string;
};

/**
 * Lecture seule : écarts de transport Zogbo → Gbégamey du jour.
 * La confirmation se fait sur /gbegamey (Réceptions).
 */
export function ControlePage() {
  const [date, setDate] = useState(() => todayIsoDate());
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/gbegamey?date=${encodeURIComponent(date)}`,
          { cache: "no-store" },
        );
        const body = (await res.json()) as Payload;
        if (!res.ok) throw new Error(body.error || "Chargement impossible");
        if (!cancelled) setPayload(body);
      } catch (e) {
        if (!cancelled) {
          setPayload(null);
          setError(e instanceof Error ? e.message : "Erreur");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [date]);

  const computed = useMemo(() => {
    if (!payload) return null;
    return computeGbegameyDay(
      payload.day,
      payload.baseDishes,
      payload.localDishes,
      new Map(Object.entries(payload.sentByProductId)),
    );
  }, [payload]);

  const rows = computed?.transfers ?? [];
  const pending = rows.filter((r) => r.sentFromZogbo > 0 && r.received === null);
  const withVariance = rows.filter(
    (r) => r.transportVariance !== null && r.transportVariance !== 0,
  );
  const receipts = (payload?.day.receipts ?? []).filter(
    (r: GbegameyReceiptMovement) => !r.cancelledAt,
  );

  return (
    <AppShell
      title="Contrôle écarts"
      subtitle="Transport Zogbo → Gbégamey : envois, réceptions et écarts du jour."
    >
      <ContextBar date={date} onDateChange={setDate}>
        <Link href="/gbegamey?tab=transfer" className="btn btn-ghost">
          Ouvrir réceptions
        </Link>
        <Link href="/zogbo" className="btn btn-ghost">
          Ouvrir Zogbo
        </Link>
      </ContextBar>

      {error ? (
        <p className="error-banner" role="alert">
          {error}
        </p>
      ) : null}

      <div className="dash-kpi-grid">
        <div className="dash-kpi">
          <span className="dash-kpi-label">À confirmer</span>
          <span className="dash-kpi-value">{pending.length}</span>
        </div>
        <div className={`dash-kpi${withVariance.length ? " dash-kpi-warn" : ""}`}>
          <span className="dash-kpi-label">Avec écart</span>
          <span className="dash-kpi-value">{withVariance.length}</span>
        </div>
        <div className="dash-kpi">
          <span className="dash-kpi-label">Réceptions du jour</span>
          <span className="dash-kpi-value">{receipts.length}</span>
        </div>
      </div>

      <section className="panel panel-wide">
        <h2 className="panel-title">Plats transferés</h2>
        {loading || !computed ? (
          <BrandLoader variant="ligne" label="Chargement…" />
        ) : (
          <ul className="site-rank-list">
            {rows
              .filter((r) => r.sentFromZogbo > 0 || r.received !== null)
              .map((line) => {
                const pendingLine =
                  line.sentFromZogbo > 0 && line.received === null;
                return (
                  <li
                    key={line.productId}
                    className={`site-rank-card${
                      line.transportVariance ? " is-warn" : ""
                    }`}
                  >
                    <div className="site-rank-top">
                      <div className="site-rank-main">
                        <strong className="site-rank-name">{line.name}</strong>
                        <span className="site-rank-qty muted">
                          Envoyé {line.sentFromZogbo}
                          {line.received === null
                            ? " · non confirmé"
                            : ` · reçu ${line.received}`}
                        </span>
                      </div>
                      <strong className="site-rank-ca mono">
                        {pendingLine
                          ? "En attente"
                          : line.transportVariance
                            ? `Écart ${
                                line.transportVariance > 0 ? "-" : "+"
                              }${Math.abs(line.transportVariance)}`
                            : "OK"}
                      </strong>
                    </div>
                  </li>
                );
              })}
            {!rows.some((r) => r.sentFromZogbo > 0 || r.received !== null) ? (
              <li className="muted">Aucun transfert ce jour.</li>
            ) : null}
          </ul>
        )}
      </section>

      {receipts.length ? (
        <section className="panel">
          <h2 className="panel-title">Justifications d’écart</h2>
          <ul className="rank-list">
            {receipts
              .filter((r) => r.variance !== 0)
              .map((r) => (
                <li key={r.id} className="rank-row">
                  <div className="rank-body">
                    <div className="rank-meta">
                      <strong className="rank-name">{r.name}</strong>
                      <span className="rank-kind">
                        écart {r.variance > 0 ? "-" : "+"}
                        {Math.abs(r.variance)}
                      </span>
                    </div>
                    <div className="rank-stats">
                      <span className="muted">
                        {r.note || "—"} · {r.actorName ?? "—"}
                      </span>
                    </div>
                  </div>
                </li>
              ))}
          </ul>
        </section>
      ) : null}
    </AppShell>
  );
}
