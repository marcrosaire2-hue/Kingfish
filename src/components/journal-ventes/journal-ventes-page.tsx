"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { BrandLoader } from "@/components/brand-loader";
import { ExportExcelButton } from "@/components/export-excel-button";
import { formatFcfa } from "@/lib/format";
import { exportJournalVentesExcel } from "@/lib/page-exports";
import type {
  JournalVenteDay,
  JournalVenteResult,
} from "@/lib/ventes-history-repo";
import { todayIsoDate } from "@/lib/zogbo-calc";

type SiteFilter = "all" | "zogbo" | "gbegamey";
type StatutFilter = "all" | "valide" | "annule" | "encours";
type SourceFilter = "all" | "kingfish" | "aquapro";

function monthStartIso(d = todayIsoDate()): string {
  return `${d.slice(0, 7)}-01`;
}

function formatDateLong(iso: string): string {
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "full",
      timeZone: "Africa/Porto-Novo",
    }).format(new Date(`${iso}T12:00:00`));
  } catch {
    return iso;
  }
}

function formatHeure(iso: string): string {
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Africa/Porto-Novo",
    }).format(new Date(iso));
  } catch {
    return "—";
  }
}

function siteLabel(site: string): string {
  if (site === "zogbo") return "Zogbo";
  if (site === "gbegamey") return "Gbégamey";
  return "—";
}

const EMPTY_RESULT: JournalVenteResult = {
  days: [],
  totals: { count: 0, montant: 0, valide: 0, annule: 0, encours: 0 },
};

export function JournalVentesPage() {
  const [from, setFrom] = useState(() => monthStartIso());
  const [to, setTo] = useState(() => todayIsoDate());
  const [site, setSite] = useState<SiteFilter>("all");
  const [statut, setStatut] = useState<StatutFilter>("all");
  const [source, setSource] = useState<SourceFilter>("all");
  const [lockedSite, setLockedSite] = useState(false);
  const [result, setResult] = useState<JournalVenteResult>(EMPTY_RESULT);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ from, to, site, statut, source });
      const res = await fetch(`/api/journal-ventes?${params}`, {
        cache: "no-store",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Erreur de chargement");
      setResult(body ?? EMPTY_RESULT);
      if (body.lockedSite && body.site && body.site !== "all") {
        setLockedSite(true);
        setSite(body.site as SiteFilter);
      } else if (typeof body.lockedSite === "boolean") {
        setLockedSite(!!body.lockedSite);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement");
      setResult(EMPTY_RESULT);
    } finally {
      setLoading(false);
    }
  }, [from, to, site, statut, source]);

  useEffect(() => {
    void load();
  }, [load]);

  async function exportFull() {
    if (exporting) return;
    setExporting(true);
    setError(null);
    try {
      const params = new URLSearchParams({ from, to, site, statut, source });
      const res = await fetch(`/api/journal-ventes?${params}`, {
        cache: "no-store",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Erreur d'export");
      exportJournalVentesExcel({
        days: body.days ?? [],
        totals: body.totals ?? EMPTY_RESULT.totals,
        from,
        to,
        site,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur d'export");
    } finally {
      setExporting(false);
    }
  }

  return (
    <AppShell
      title="Journal des ventes détaillé"
      subtitle="Toutes les lignes de vente, jour par jour : produit, quantité, prix unitaire et montant — CA = Validé uniquement."
      actions={
        <>
          <ExportExcelButton
            label="Excel (par jour)"
            onExport={() => void exportFull()}
            disabled={loading || exporting || result.totals.count === 0}
          />
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void load()}
            disabled={loading}
          >
            Actualiser
          </button>
        </>
      }
    >
      <div className="hist-filters hist-ventes-filters">
        <label className="date-field">
          <span>Du</span>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="date-field">
          <span>Au</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <label className="date-field">
          <span>Site</span>
          <select
            className="select-input"
            value={site}
            onChange={(e) => setSite(e.target.value as SiteFilter)}
            disabled={lockedSite}
          >
            {!lockedSite ? <option value="all">Tous</option> : null}
            <option value="zogbo">Zogbo</option>
            <option value="gbegamey">Gbégamey</option>
          </select>
        </label>
        <label className="date-field">
          <span>Statut</span>
          <select
            className="select-input"
            value={statut}
            onChange={(e) => setStatut(e.target.value as StatutFilter)}
          >
            <option value="all">Tous</option>
            <option value="valide">Validé</option>
            <option value="annule">Annulé</option>
            <option value="encours">En cours</option>
          </select>
        </label>
        <label className="date-field">
          <span>Source</span>
          <select
            className="select-input"
            value={source}
            onChange={(e) => setSource(e.target.value as SourceFilter)}
          >
            <option value="all">Toutes</option>
            <option value="kingfish">King Fish</option>
            <option value="aquapro">Importé</option>
          </select>
        </label>
      </div>

      <div className="dash-ca-final hist-ventes-totaux">
        <div className="dash-ca-final-main">
          <span className="dash-ca-final-label">CA filtré (Validé)</span>
          <strong className="dash-ca-final-value mono">
            {formatFcfa(result.totals.montant)}
          </strong>
          <span className="dash-ca-final-hint">
            {result.totals.count} ticket{result.totals.count > 1 ? "s" : ""} ·{" "}
            {result.days.length} jour{result.days.length > 1 ? "s" : ""} ·{" "}
            {result.totals.valide} validé{result.totals.valide > 1 ? "s" : ""} ·{" "}
            {result.totals.annule} annulé{result.totals.annule > 1 ? "s" : ""} ·{" "}
            {result.totals.encours} en cours
          </span>
        </div>
      </div>

      {error ? (
        <p className="error-banner" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? <BrandLoader variant="ligne" label="Chargement du journal…" /> : null}

      {!loading && !result.days.length ? (
        <p className="muted">Aucune vente pour ces filtres.</p>
      ) : null}

      {!loading && result.days.length > 0
        ? result.days.map((day) => (
            <JournalDayBlock
              key={day.date}
              day={day}
              formatHeure={formatHeure}
              siteLabel={siteLabel}
            />
          ))
        : null}
    </AppShell>
  );
}

function JournalDayBlock({
  day,
  formatHeure,
  siteLabel,
}: {
  day: JournalVenteDay;
  formatHeure: (iso: string) => string;
  siteLabel: (site: string) => string;
}) {
  return (
    <div className="panel panel-wide jv-day">
      <div className="jv-day-head">
        <h2 className="panel-title">
          {formatDateLong(day.date)}
          <span className="jv-day-head-count">
            {day.nbTickets} ticket{day.nbTickets > 1 ? "s" : ""} ·{" "}
            {day.nbLignes} ligne{day.nbLignes > 1 ? "s" : ""}
          </span>
        </h2>
        <strong className="jv-day-total mono">{formatFcfa(day.montant)}</strong>
      </div>
      <div className="table-scroll">
        <table className="data-table jv-table">
          <thead>
            <tr>
              <th scope="col">Heure</th>
              <th scope="col">Ticket</th>
              <th scope="col">Site</th>
              <th scope="col">Type</th>
              <th scope="col">Serveur</th>
              <th scope="col">Paiement</th>
              <th scope="col">Produit</th>
              <th scope="col" className="col-money">
                Qté
              </th>
              <th scope="col" className="col-money">
                PU
              </th>
              <th scope="col" className="col-money">
                Montant
              </th>
              <th scope="col">Statut</th>
            </tr>
          </thead>
          <tbody>
            {day.lines.map((l, i) => (
              <tr key={`${day.date}-${i}`}>
                <td>{formatHeure(l.at)}</td>
                <td className="cell-name">
                  <strong>{l.numero}</strong>
                  {l.client ? (
                    <span className="cell-sub">{l.client}</span>
                  ) : null}
                  {l.table ? (
                    <span className="cell-sub">Table {l.table}</span>
                  ) : null}
                </td>
                <td>{siteLabel(l.site)}</td>
                <td>{l.typeVente}</td>
                <td>{l.serveur || "—"}</td>
                <td>{l.paiement || "—"}</td>
                <td className="cell-name">
                  <strong>{l.produit}</strong>
                </td>
                <td className="mono col-money">{l.qty}</td>
                <td className="mono col-money">{formatFcfa(l.unitPrice)}</td>
                <td className="mono col-money">{formatFcfa(l.montant)}</td>
                <td>
                  <span className={`hist-statut hist-statut-${l.statut}`}>
                    {l.statutLabel}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={7}>
                Total du jour (Validé)
              </th>
              <td className="mono col-money">{day.nbLignes}</td>
              <td colSpan={1} />
              <td className="mono col-money">{formatFcfa(day.montant)}</td>
              <td colSpan={1} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}