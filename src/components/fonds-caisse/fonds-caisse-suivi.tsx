"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { BrandLoader } from "@/components/brand-loader";
import { ExportExcelButton } from "@/components/export-excel-button";
import { CAISSE_LABELS, CAISSE_SHORT_LABELS } from "@/lib/caisse-model";
import { downloadExcel, excelFilename } from "@/lib/export-excel";
import { formatFcfa } from "@/lib/format";
import type { FondsCaisse } from "@/lib/types";
import "@/components/achats/achats-page.css";

type SiteFilter = "tous" | "zogbo" | "gbegamey";

function formatDateFr(iso: string) {
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
}

/** Suivi admin : tous les fonds de caisse, en lecture seule, exportables. */
export function FondsCaisseSuivi() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [site, setSite] = useState<SiteFilter>("tous");
  const [items, setItems] = useState<FondsCaisse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ action: "all" });
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      const res = await fetch(`/api/fonds-caisse?${params}`, {
        cache: "no-store",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Erreur de chargement");
      setItems(body.fondsCaisses as FondsCaisse[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(
    () => items.filter((f) => site === "tous" || f.caisse === site),
    [items, site],
  );

  const totaux = useMemo(
    () => ({
      prevision: rows.reduce((s, f) => s + f.soldePrevision, 0),
      reel: rows.reduce((s, f) => s + f.soldeReel, 0),
      ecart: rows.reduce((s, f) => s + f.ecart, 0),
    }),
    [rows],
  );

  function exporter() {
    downloadExcel(
      excelFilename("fonds-caisse", dateFrom || null, dateTo || null),
      [
        {
          name: "Fonds de caisse",
          subtitle: `${site === "tous" ? "Zogbo et Gbégamey" : CAISSE_LABELS[site]} · ${
            dateFrom ? formatDateFr(dateFrom) : "début"
          } → ${dateTo ? formatDateFr(dateTo) : "aujourd'hui"}`,
          rows: [...rows]
            .sort((a, b) => a.date.localeCompare(b.date))
            .map((f) => ({
              Date: f.date,
              Caisse: CAISSE_LABELS[f.caisse],
              "Solde prévisionnel": f.soldePrevision,
              "Solde réel": f.soldeReel,
              Écart: f.ecart,
              Justification: f.justificationEcart ?? "",
              "Saisi par": f.actorName,
              "Saisi le": f.createdAt,
              "Modifié par": f.updatedByName ?? "",
            })),
          totals: ["Solde prévisionnel", "Solde réel", "Écart"],
        },
      ],
    );
  }

  return (
    <AppShell
      title="Fonds de Caisse"
      subtitle="Suivi des deux sites · lecture seule"
      mainClassName="main-achats"
      actions={
        <ExportExcelButton
          onExport={exporter}
          disabled={loading || rows.length === 0}
        />
      }
    >
      <div className="achats-page">
        {error ? (
          <p className="error-banner" role="alert">
            {error}
          </p>
        ) : null}

        <section className="achats-composer" aria-label="Filtres">
          <div className="achats-composer-grid">
            <label className="achats-field">
              <span>Du</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </label>
            <label className="achats-field">
              <span>Au</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </label>
            <label className="achats-field">
              <span>Site</span>
              <select
                value={site}
                onChange={(e) => setSite(e.target.value as SiteFilter)}
              >
                <option value="tous">Tous</option>
                <option value="zogbo">{CAISSE_SHORT_LABELS.zogbo}</option>
                <option value="gbegamey">{CAISSE_SHORT_LABELS.gbegamey}</option>
              </select>
            </label>
          </div>
        </section>

        <div className="achats-stats" aria-label="Totaux">
          <article className="achats-stat">
            <span>Solde prévisionnel</span>
            <strong>{formatFcfa(totaux.prevision)}</strong>
          </article>
          <article className="achats-stat">
            <span>Solde réel</span>
            <strong>{formatFcfa(totaux.reel)}</strong>
          </article>
          <article
            className={`achats-stat ${totaux.ecart === 0 ? "is-gold" : totaux.ecart > 0 ? "is-blue" : ""}`}
          >
            <span>Écart cumulé</span>
            <strong>{formatFcfa(totaux.ecart)}</strong>
          </article>
        </div>

        <section className="achats-ledger" aria-label="Historique des fonds">
          <div className="achats-ledger-head">
            <h2>Historique</h2>
            <p>
              {rows.length} enregistrement{rows.length > 1 ? "s" : ""}
            </p>
          </div>
          {loading ? (
            <BrandLoader />
          ) : rows.length === 0 ? (
            <div className="achats-empty">
              <strong>Aucun fonds de caisse enregistré</strong>
              <span>Modifiez la période ou le site.</span>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="data-table achats-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Caisse</th>
                    <th className="num">Prévisionnel</th>
                    <th className="num">Réel</th>
                    <th className="num">Écart</th>
                    <th>Justification</th>
                    <th>Saisi par</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((f) => (
                    <tr key={f.id}>
                      <td>{formatDateFr(f.date)}</td>
                      <td>{CAISSE_SHORT_LABELS[f.caisse]}</td>
                      <td className="num">{formatFcfa(f.soldePrevision)}</td>
                      <td className="num">{formatFcfa(f.soldeReel)}</td>
                      <td className="num">{formatFcfa(f.ecart)}</td>
                      <td>{f.justificationEcart || "—"}</td>
                      <td>{f.actorName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
