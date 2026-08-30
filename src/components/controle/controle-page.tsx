"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  DashKpiGrid,
  DashboardBody,
  DashboardShell,
  DashboardToolbar,
} from "@/components/dashboard/dashboard-layout";
import { AppShell } from "@/components/app-shell";
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
      <DashboardShell>
        <DashboardToolbar
          filters={
            <>
              <label className="date-field date-field-pill">
                <span>Jour</span>
                <input
                  type="date"
                  value={date}
                  max={todayIsoDate()}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
                    setDate(v);
                  }}
                />
              </label>
              <Link href="/gbegamey?tab=transfer" className="btn btn-ghost">
                Ouvrir réceptions
              </Link>
              <Link href="/zogbo" className="btn btn-ghost">
                Ouvrir Zogbo
              </Link>
            </>
          }
        />

      {error ? (
        <p className="error-banner" role="alert">
          {error}
        </p>
      ) : null}

      <DashKpiGrid
        items={[
          { label: "À confirmer", value: String(pending.length) },
          {
            label: "Avec écart",
            value: String(withVariance.length),
            tone: withVariance.length ? "warn" : undefined,
          },
          { label: "Réceptions du jour", value: String(receipts.length) },
        ]}
      />

      <DashboardBody>

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
      </DashboardBody>
      </DashboardShell>
    </AppShell>
  );
}
