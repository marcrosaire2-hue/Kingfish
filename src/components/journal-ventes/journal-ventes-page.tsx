"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { BrandLoader } from "@/components/brand-loader";
import { ExportExcelButton } from "@/components/export-excel-button";
import { formatFcfa } from "@/lib/format";
import {
  exportAllHistoriqueVentesExcel,
  exportJournalVentesExcel,
} from "@/lib/page-exports";
import type {
  JournalVenteDay,
  JournalVenteResult,
} from "@/lib/ventes-history-repo";
import { todayIsoDate } from "@/lib/zogbo-calc";

type SiteFilter = "all" | "zogbo" | "gbegamey";
type StatutFilter = "all" | "valide" | "annule" | "encours";
type SourceFilter = "all" | "kingfish" | "aquapro";

type DayPlatAcc = {
  date: string;
  platQty: number;
  platMontant: number;
  accQty: number;
  accMontant: number;
};

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

function summarizePlatsAccompagnements(days: JournalVenteDay[]): DayPlatAcc[] {
  const byDate = new Map<string, DayPlatAcc>();
  for (const day of days) {
    for (const l of day.lines) {
      if (l.statut !== "valide") continue;
      if (l.kind !== "plat" && l.kind !== "local") continue;
      const row = byDate.get(day.date) ?? {
        date: day.date,
        platQty: 0,
        platMontant: 0,
        accQty: 0,
        accMontant: 0,
      };
      if (l.kind === "plat") {
        row.platQty += l.qty;
        row.platMontant += l.montant;
      } else {
        row.accQty += l.qty;
        row.accMontant += l.montant;
      }
      byDate.set(day.date, row);
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

const EMPTY_RESULT: JournalVenteResult = {
  days: [],
  totals: { count: 0, montant: 0, valide: 0, annule: 0, encours: 0 },
  facets: { serveurs: [], paiements: [] },
};

export function JournalVentesPage() {
  const [from, setFrom] = useState(() => monthStartIso());
  const [to, setTo] = useState(() => todayIsoDate());
  const [site, setSite] = useState<SiteFilter>("all");
  const [statut, setStatut] = useState<StatutFilter>("valide");
  const [source, setSource] = useState<SourceFilter>("all");
  const [serveur, setServeur] = useState("");
  const [paiement, setPaiement] = useState("");
  const [q, setQ] = useState("");
  const [lockedSite, setLockedSite] = useState(false);
  const [result, setResult] = useState<JournalVenteResult>(EMPTY_RESULT);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        from,
        to,
        site,
        statut,
        source,
      });
      if (serveur) params.set("serveur", serveur);
      if (paiement) params.set("paiement", paiement);
      if (q.trim()) params.set("q", q.trim());

      const res = await fetch(`/api/journal-ventes?${params}`, {
        cache: "no-store",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Erreur de chargement");
      setResult({
        days: body.days ?? [],
        totals: body.totals ?? EMPTY_RESULT.totals,
        facets: body.facets ?? EMPTY_RESULT.facets,
      });
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
  }, [from, to, site, statut, source, serveur, paiement, q]);

  useEffect(() => {
    void load();
  }, [load]);

  const platAccByDay = useMemo(
    () => summarizePlatsAccompagnements(result.days),
    [result.days],
  );
  const platAccTotals = platAccByDay.reduce(
    (acc, d) => ({
      platQty: acc.platQty + d.platQty,
      platMontant: acc.platMontant + d.platMontant,
      accQty: acc.accQty + d.accQty,
      accMontant: acc.accMontant + d.accMontant,
    }),
    { platQty: 0, platMontant: 0, accQty: 0, accMontant: 0 },
  );

  async function exportJournal() {
    if (exporting) return;
    setExporting(true);
    setError(null);
    try {
      exportJournalVentesExcel({
        days: result.days,
        totals: result.totals,
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

  async function exportTickets() {
    if (exporting) return;
    setExporting(true);
    setError(null);
    try {
      await exportAllHistoriqueVentesExcel({
        from,
        to,
        site,
        statut,
        source,
        serveur,
        paiement,
        q,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur d'export");
    } finally {
      setExporting(false);
    }
  }

  return (
    <AppShell
      title="Journal des ventes"
      subtitle="Tickets POS, journal et importés — détail ligne par ligne, filtres et export."
      actions={
        <>
          <ExportExcelButton
            label="Excel (par jour)"
            onExport={() => void exportJournal()}
            disabled={loading || exporting || result.totals.count === 0}
          />
          <ExportExcelButton
            label="Excel (tickets)"
            onExport={() => void exportTickets()}
            disabled={loading || exporting}
          />
          <Link href="/vente" className="btn btn-ghost">
            ← Vente
          </Link>
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
        <label className="date-field">
          <span>Serveur</span>
          <select
            className="select-input"
            value={serveur}
            onChange={(e) => setServeur(e.target.value)}
          >
            <option value="">Tous</option>
            {result.facets.serveurs.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="date-field">
          <span>Paiement</span>
          <select
            className="select-input"
            value={paiement}
            onChange={(e) => setPaiement(e.target.value)}
          >
            <option value="">Tous</option>
            {result.facets.paiements.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="date-field hist-search">
          <span>Recherche</span>
          <input
            type="search"
            placeholder="N° ticket, produit, client…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
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
            {result.days.length} jour{result.days.length > 1 ? "s" : ""}
          </span>
        </div>
        <div className="dash-ca-final-side">
          <div>
            <span>Validé</span>
            <strong className="mono">{result.totals.valide}</strong>
          </div>
          <div>
            <span>Annulé</span>
            <strong className="mono">{result.totals.annule}</strong>
          </div>
          <div>
            <span>En cours</span>
            <strong className="mono">{result.totals.encours}</strong>
          </div>
        </div>
      </div>

      {error ? (
        <p className="error-banner" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? <BrandLoader variant="ligne" label="Chargement du journal…" /> : null}

      {!loading && platAccByDay.length > 0 ? (
        <div className="panel panel-wide">
          <div className="panel-head">
            <h2 className="panel-title">Plats et accompagnements vendus par jour</h2>
            <p className="muted hist-line-meta">
              Ventes validées uniquement, quel que soit le filtre Statut ci-dessus.
            </p>
          </div>
          <table className="data-table hist-ventes-table">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col" className="col-num">
                  Plats vendus
                </th>
                <th scope="col" className="col-money">
                  Montant plats
                </th>
                <th scope="col" className="col-num">
                  Accompagnements vendus
                </th>
                <th scope="col" className="col-money">
                  Montant accompagnements
                </th>
                <th scope="col" className="col-money">
                  Total jour
                </th>
              </tr>
            </thead>
            <tbody>
              {platAccByDay.map((d) => (
                <tr key={d.date}>
                  <td>{d.date}</td>
                  <td className="mono col-num">{d.platQty}</td>
                  <td className="mono col-money">{formatFcfa(d.platMontant)}</td>
                  <td className="mono col-num">{d.accQty}</td>
                  <td className="mono col-money">{formatFcfa(d.accMontant)}</td>
                  <td className="mono col-money">
                    {formatFcfa(d.platMontant + d.accMontant)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Total période</th>
                <td className="mono col-num">{platAccTotals.platQty}</td>
                <td className="mono col-money">
                  {formatFcfa(platAccTotals.platMontant)}
                </td>
                <td className="mono col-num">{platAccTotals.accQty}</td>
                <td className="mono col-money">
                  {formatFcfa(platAccTotals.accMontant)}
                </td>
                <td className="mono col-money">
                  {formatFcfa(platAccTotals.platMontant + platAccTotals.accMontant)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : null}

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
