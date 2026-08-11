"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ContextBar } from "@/components/context-bar";
import { ExportExcelButton } from "@/components/export-excel-button";
import {
  downloadExcel,
  excelFilename,
} from "@/lib/export-excel";
import { formatFcfa } from "@/lib/format";
import { computeMatieresDay } from "@/lib/matieres-calc";
import type {
  MatieresDay,
  MatieresMovement,
  RawMaterial,
} from "@/lib/types";
import { todayIsoDate } from "@/lib/zogbo-calc";

type Payload = {
  day: MatieresDay;
  materials: RawMaterial[];
};

function formatTime(iso: string): string {
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

export function ApproPage() {
  const [date, setDate] = useState(todayIsoDate);
  const [day, setDay] = useState<MatieresDay | null>(null);
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draftBuy, setDraftBuy] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load(nextDate = date) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/matieres?date=${encodeURIComponent(nextDate)}`,
        { cache: "no-store" },
      );
      const body = (await res.json()) as Payload & { error?: string };
      if (!res.ok) throw new Error(body.error || "Erreur");
      setDay(body.day);
      setMaterials(body.materials);
      setDraftBuy({});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
      setDay(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const computed = useMemo(() => {
    if (!day) return null;
    return computeMatieresDay(day, materials);
  }, [day, materials]);

  async function submitPurchase(productId: string, raw: string) {
    const qty = Number(String(raw).replace(",", ".")) || 0;
    if (qty <= 0) return;
    setBusyId(`buy-${productId}`);
    setError(null);
    try {
      const res = await fetch("/api/matieres", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, productId, qty }),
      });
      const body = (await res.json()) as Payload & { error?: string };
      if (!res.ok) throw new Error(body.error || "Erreur");
      setDay(body.day);
      setMaterials(body.materials);
      setDraftBuy((d) => ({ ...d, [productId]: "" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusyId(null);
    }
  }

  async function cancelMovement(m: MatieresMovement) {
    if (!window.confirm(`Annuler cet achat ?\n\n+${m.qty} × ${m.name}`)) {
      return;
    }
    setBusyId(`cancel-${m.id}`);
    setError(null);
    try {
      const res = await fetch("/api/matieres", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "cancel",
          date,
          movementId: m.id,
        }),
      });
      const body = (await res.json()) as Payload & { error?: string };
      if (!res.ok) throw new Error(body.error || "Erreur");
      setDay(body.day);
      setMaterials(body.materials);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <AppShell
      title="Appro matières"
      subtitle="Entrées de stock matières premières"
      actions={
        <ExportExcelButton
          disabled={!day || !computed}
          onExport={() => {
            if (!computed) return;
            downloadExcel(excelFilename("appro", date), [
              {
                name: "Stock",
                rows: computed.lines.map((l) => ({
                  Matière: l.name,
                  Unité: l.unit,
                  Initial: l.initialStock,
                  Achats: l.purchases,
                  Stock: l.stock,
                })),
              },
            ]);
          }}
        />
      }
    >
      <ContextBar date={date} onDateChange={setDate} siteLabel="Cuisine" />
      {error ? <p className="error-banner">{error}</p> : null}
      {loading || !day || !computed ? (
        <p className="muted">Chargement…</p>
      ) : materials.length === 0 ? (
        <p className="ui-info">
          Aucune matière définie. Ajoutez-les dans Paramètres → Matières.
        </p>
      ) : (
        <>
          <section className="panel">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Matière</th>
                  <th className="col-num">Stock</th>
                  <th className="col-num">Achats jour</th>
                  <th>Nouvel achat</th>
                </tr>
              </thead>
              <tbody>
                {computed.lines.map((line) => (
                  <tr key={line.productId}>
                    <td>
                      <strong>{line.name}</strong>
                      {line.unit ? (
                        <span className="muted"> · {line.unit}</span>
                      ) : null}
                    </td>
                    <td className="col-num mono">{line.stock}</td>
                    <td className="col-num mono">{line.purchases}</td>
                    <td>
                      <div className="inline-buy">
                        <input
                          type="number"
                          min={0}
                          step="any"
                          className="input-num"
                          value={draftBuy[line.productId] ?? ""}
                          onChange={(e) =>
                            setDraftBuy((d) => ({
                              ...d,
                              [line.productId]: e.target.value,
                            }))
                          }
                          aria-label={`Achat ${line.name}`}
                        />
                        <button
                          type="button"
                          className="btn btn-primary"
                          disabled={busyId === `buy-${line.productId}`}
                          onClick={() =>
                            void submitPurchase(
                              line.productId,
                              draftBuy[line.productId] ?? "",
                            )
                          }
                        >
                          + Achat
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="panel">
            <h2 className="panel-title">Registre des achats</h2>
            {(day.movements ?? []).length === 0 ? (
              <p className="muted">Aucun mouvement aujourd’hui.</p>
            ) : (
              <ul className="vente-log">
                {(day.movements ?? []).map((m) => (
                  <li
                    key={m.id}
                    className={m.cancelledAt ? "is-cancelled" : undefined}
                  >
                    <div>
                      <strong>
                        +{m.qty} × {m.name}
                      </strong>
                      {m.unitPrice > 0 ? (
                        <span className="muted">
                          {" "}
                          ({formatFcfa(m.unitPrice)} / u)
                        </span>
                      ) : null}
                      <div className="vente-log-time muted">
                        {formatTime(m.at)}
                        {m.cancelledAt ? " · annulé" : ""}
                      </div>
                    </div>
                    {!m.cancelledAt ? (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={busyId === `cancel-${m.id}`}
                        onClick={() => void cancelMovement(m)}
                      >
                        Annuler
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </AppShell>
  );
}
