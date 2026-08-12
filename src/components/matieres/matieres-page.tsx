"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ContextBar } from "@/components/context-bar";
import { ExportExcelButton } from "@/components/export-excel-button";
import {
  downloadExcel,
  excelFilename,
} from "@/lib/export-excel";
import { computeMatieresDay } from "@/lib/matieres-calc";
import type {
  MatieresDay,
  MatieresLine,
  RawMaterial,
} from "@/lib/types";
import { todayIsoDate } from "@/lib/zogbo-calc";

type Payload = {
  day: MatieresDay;
  materials: RawMaterial[];
};

export function MatieresPage() {
  const [date, setDate] = useState(() => todayIsoDate());
  const [day, setDay] = useState<MatieresDay | null>(null);
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setDirty(false);
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

  function patchLine(productId: string, patch: Partial<MatieresLine>) {
    if (!day) return;
    setDay({
      ...day,
      lines: day.lines.map((l) =>
        l.productId === productId ? { ...l, ...patch } : l,
      ),
    });
    setDirty(true);
  }

  async function handleSave() {
    if (!day) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/matieres", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: day.date,
          status: day.status,
          lines: day.lines,
        }),
      });
      const body = (await res.json()) as Payload & { error?: string };
      if (!res.ok) throw new Error(body.error || "Erreur");
      setDay(body.day);
      setMaterials(body.materials);
      setDirty(false);
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell
      title="Matières"
      subtitle="Stock, comptage et seuils"
      actions={
        <>
          <ExportExcelButton
            disabled={!day || !computed}
            onExport={() => {
              if (!computed) return;
              downloadExcel(excelFilename("matieres", date), [
                {
                  name: "Stock",
                  rows: computed.lines.map((l) => ({
                    Matière: l.name,
                    Unité: l.unit,
                    Initial: l.initialStock,
                    Achats: l.purchases,
                    Conso: l.consumed,
                    Stock: l.stock,
                    Compté: l.counted ?? "",
                    Seuil: l.threshold,
                    Alerte: l.belowThreshold ? "Oui" : "",
                  })),
                },
              ]);
            }}
          />
          <button
            type="button"
            className={`btn btn-primary${savedFlash ? " btn-saved" : ""}`}
            disabled={!dirty || saving || !day}
            onClick={() => void handleSave()}
          >
            {saving ? "…" : savedFlash ? "Enregistré" : "Enregistrer"}
          </button>
        </>
      }
    >
      <ContextBar date={date} onDateChange={setDate} siteLabel="Cuisine" />
      {error ? <p className="error-banner">{error}</p> : null}

      {computed && computed.alerts.length > 0 ? (
        <section className="panel alert-panel">
          <h2 className="panel-title">Au seuil ({computed.alerts.length})</h2>
          <ul className="seuil-list">
            {computed.alerts.map((a) => (
              <li key={a.productId}>
                <strong>{a.name}</strong>
                <span className="mono">
                  {a.stock} / seuil {a.threshold}
                  {a.unit ? ` ${a.unit}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {loading || !day || !computed ? (
        <p className="muted">Chargement…</p>
      ) : materials.length === 0 ? (
        <p className="ui-info">
          Aucune matière définie. Ajoutez-les dans Paramètres → Matières.
        </p>
      ) : (
        <section className="panel">
          <table className="data-table">
            <thead>
              <tr>
                <th>Matière</th>
                <th className="col-num">Initial</th>
                <th className="col-num">Achats</th>
                <th className="col-num">Stock</th>
                <th className="col-num">Seuil</th>
                <th className="col-num">Compté</th>
                <th>Obs.</th>
              </tr>
            </thead>
            <tbody>
              {computed.lines.map((line) => (
                <tr
                  key={line.productId}
                  className={line.belowThreshold ? "is-alert" : undefined}
                >
                  <td>
                    <strong>{line.name}</strong>
                    {line.unit ? (
                      <span className="muted"> · {line.unit}</span>
                    ) : null}
                  </td>
                  <td className="col-num mono">{line.initialStock}</td>
                  <td className="col-num mono">{line.purchases}</td>
                  <td className="col-num mono">{line.stock}</td>
                  <td className="col-num mono">{line.threshold || "—"}</td>
                  <td className="col-num">
                    <input
                      type="number"
                      min={0}
                      step="any"
                      className="input-num"
                      value={line.counted ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        patchLine(line.productId, {
                          counted: v === "" ? null : Number(v) || 0,
                        });
                      }}
                      aria-label={`Compté ${line.name}`}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      className="name-input"
                      value={line.observations}
                      onChange={(e) =>
                        patchLine(line.productId, {
                          observations: e.target.value,
                        })
                      }
                      aria-label={`Observations ${line.name}`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </AppShell>
  );
}
