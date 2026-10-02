"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ExportExcelButton } from "@/components/export-excel-button";
import { CAISSE_LABELS, CAISSE_SHORT_LABELS } from "@/lib/caisse-model";
import { downloadExcel, excelFilename } from "@/lib/export-excel";
import { formatFcfa } from "@/lib/format";
import type { FondsCaisse } from "@/lib/types";
import "./fonds-caisse-suivi.css";

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

  const stateBody = loading ? (
    <div className="fcs-skeleton" aria-busy="true" aria-label="Chargement">
      <span className="fcs-skel-row" />
      <span className="fcs-skel-row" />
      <span className="fcs-skel-row" />
    </div>
  ) : error ? (
    <div className="fcs-state is-error" role="alert">
      <span className="fcs-state-ico">
        <InfoIcon />
      </span>
      <strong>Impossible de charger les fonds de caisse</strong>
      <p>{error}</p>
      <button type="button" className="fcs-btn" onClick={() => void load()}>
        Réessayer
      </button>
    </div>
  ) : rows.length === 0 ? (
    <div className="fcs-state">
      <span className="fcs-state-ico">
        <DocIcon />
      </span>
      <strong>Aucun fonds de caisse enregistré</strong>
      <p>Modifiez la période ou le site pour voir les résultats.</p>
    </div>
  ) : (
    <div className="table-scroll">
      <table className="data-table fcs-table">
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
              <td className={`num ${tone(f.ecart)}`}>{formatFcfa(f.ecart)}</td>
              <td>{f.justificationEcart || "—"}</td>
              <td>{f.actorName}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <AppShell
      title="Fonds de Caisse"
      subtitle="Suivi des deux sites · lecture seule"
      mainClassName="main-fonds-suivi"
    >
      <div className="fcs-page">
        <header className="fcs-hero">
          <div>
            <h2 className="fcs-title">Fonds de Caisse</h2>
            <p className="fcs-sub">
              Suivi des deux sites · lecture seule{" "}
              <span className="fcs-badge">Lecture seule</span>
            </p>
          </div>
          <ExportExcelButton
            onExport={exporter}
            disabled={loading || rows.length === 0}
            className="fcs-btn"
          />
        </header>

        <section className="fcs-card" aria-label="Période de consultation">
          <h3 className="fcs-card-title">
            <CalendarIcon /> Période de consultation
          </h3>
          <div className="fcs-filters">
            <label className="fcs-field">
              <span>Du</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </label>
            <label className="fcs-field">
              <span>Au</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </label>
            <label className="fcs-field">
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
            <button
              type="button"
              className="fcs-btn fcs-refresh"
              onClick={() => void load()}
              disabled={loading}
            >
              <RefreshIcon /> Actualiser
            </button>
          </div>
        </section>

        <div className="fcs-stats" aria-label="Totaux">
          <article className="fcs-stat is-blue">
            <span className="fcs-stat-ico">
              <SafeIcon />
            </span>
            <div>
              <span className="fcs-stat-label">Solde prévisionnel</span>
              <strong>{formatFcfa(totaux.prevision)}</strong>
              <small>Montant estimé pour la période</small>
            </div>
          </article>
          <article className="fcs-stat is-gold">
            <span className="fcs-stat-ico">
              <CoinsIcon />
            </span>
            <div>
              <span className="fcs-stat-label">Solde réel</span>
              <strong>{formatFcfa(totaux.reel)}</strong>
              <small>Montant effectivement disponible</small>
            </div>
          </article>
          <article className={`fcs-stat ${tone(totaux.ecart) || "is-neutral"}`}>
            <span className="fcs-stat-ico">
              <ScaleIcon />
            </span>
            <div>
              <span className="fcs-stat-label">Écart cumulé</span>
              <strong>{formatFcfa(totaux.ecart)}</strong>
              <small>Différence prévisionnel / réel</small>
            </div>
          </article>
        </div>

        <section className="fcs-card fcs-history" aria-label="Historique">
          <header className="fcs-history-head">
            <h3 className="fcs-card-title">Historique</h3>
            <p>
              {rows.length} enregistrement{rows.length > 1 ? "s" : ""}
            </p>
          </header>
          {stateBody}
        </section>
      </div>
    </AppShell>
  );
}

function tone(n: number) {
  return n > 0 ? "is-pos" : n < 0 ? "is-neg" : "";
}

function Ico({ d }: { d: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
    >
      <path d={d} />
    </svg>
  );
}
const CalendarIcon = () => <Ico d="M4 6h16v14H4V6Zm0 5h16M8 3v4M16 3v4" />;
const RefreshIcon = () => <Ico d="M20 12a8 8 0 1 1-2.3-5.6M20 4v6h-6" />;
const SafeIcon = () => <Ico d="M4 5h16v12H4V5Zm0 12v2m16-2v2M12 11a2 2 0 1 0 0 .01" />;
const CoinsIcon = () => <Ico d="M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3Zm0 0v5c0 1.7 3.6 3 8 3s8-1.3 8-3V7M4 12v5c0 1.7 3.6 3 8 3s8-1.3 8-3v-5" />;
const ScaleIcon = () => <Ico d="M12 4v16M6 20h12M5 8h14M5 8l-3 6a3 3 0 0 0 6 0L5 8Zm14 0-3 6a3 3 0 0 0 6 0l-3-6Z" />;
const DocIcon = () => <Ico d="M7 3h8l4 4v14H7V3Zm7 0v5h5M10 13h6M10 17h4" />;
const InfoIcon = () => <Ico d="M12 8v5m0 3.5h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" />;
