"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { ExportExcelButton } from "@/components/export-excel-button";
import { formatFcfa } from "@/lib/format";
import { exportAllHistoriqueVentesExcel } from "@/lib/page-exports";
import type { VenteHistoryTicket } from "@/lib/ventes-history-repo";
import { todayIsoDate } from "@/lib/zogbo-calc";
import { BrandLoader } from "@/components/brand-loader";

type SiteFilter = "all" | "zogbo" | "gbegamey";
type StatutFilter = "all" | "valide" | "annule" | "encours";
type SourceFilter = "all" | "kingfish" | "aquapro";

function monthStartIso(d = todayIsoDate()): string {
  return `${d.slice(0, 7)}-01`;
}

type DayPlatAcc = {
  date: string;
  platQty: number;
  platMontant: number;
  accQty: number;
  accMontant: number;
};

/**
 * Plats et accompagnements vendus, groupés par jour. Uniquement les ventes
 * validées — quel que soit le filtre Statut affiché par ailleurs sur la
 * page, « vendu » ne veut rien dire d'une commande annulée. Les lignes sans
 * catégorie connue (boissons, combos, extras, ventes AquaPro importées) n'y
 * figurent pas : ce tableau ne parle que de plats et d'accompagnements.
 */
function summarizePlatsAccompagnements(
  tickets: VenteHistoryTicket[],
): DayPlatAcc[] {
  const byDate = new Map<string, DayPlatAcc>();
  for (const t of tickets) {
    if (t.statut !== "valide") continue;
    for (const l of t.lines) {
      if (l.kind !== "plat" && l.kind !== "local") continue;
      const row = byDate.get(t.date) ?? {
        date: t.date,
        platQty: 0,
        platMontant: 0,
        accQty: 0,
        accMontant: 0,
      };
      if (l.kind === "plat") {
        row.platQty += l.qty;
        row.platMontant += l.amount;
      } else {
        row.accQty += l.qty;
        row.accMontant += l.amount;
      }
      byDate.set(t.date, row);
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function formatWhen(iso: string): string {
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "Africa/Porto-Novo",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function HistoriqueVentesPage() {
  const [from, setFrom] = useState(() => monthStartIso());
  const [to, setTo] = useState(() => todayIsoDate());
  const [site, setSite] = useState<SiteFilter>("all");
  const [lockedSite, setLockedSite] = useState(false);
  const [statut, setStatut] = useState<StatutFilter>("valide");
  const [source, setSource] = useState<SourceFilter>("all");
  const [serveur, setServeur] = useState("");
  const [paiement, setPaiement] = useState("");
  const [q, setQ] = useState("");
  const [tickets, setTickets] = useState<VenteHistoryTicket[]>([]);
  const [totals, setTotals] = useState({
    count: 0,
    montant: 0,
    valide: 0,
    annule: 0,
    encours: 0,
  });
  const [facets, setFacets] = useState<{
    serveurs: string[];
    paiements: string[];
  }>({ serveurs: [], paiements: [] });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
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
        limit: "300",
      });
      if (serveur) params.set("serveur", serveur);
      if (paiement) params.set("paiement", paiement);
      if (q.trim()) params.set("q", q.trim());

      const res = await fetch(`/api/historique-ventes?${params}`, {
        cache: "no-store",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Erreur de chargement");
      setTickets(body.tickets ?? []);
      setTotals(
        body.totals ?? {
          count: 0,
          montant: 0,
          valide: 0,
          annule: 0,
          encours: 0,
        },
      );
      setFacets(body.facets ?? { serveurs: [], paiements: [] });
      if (body.lockedSite && body.site && body.site !== "all") {
        setLockedSite(true);
        setSite(body.site as SiteFilter);
      } else if (typeof body.lockedSite === "boolean") {
        setLockedSite(!!body.lockedSite);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement");
      setTickets([]);
    } finally {
      setLoading(false);
    }
  }, [from, to, site, statut, source, serveur, paiement, q]);

  useEffect(() => {
    void load();
  }, [load]);

  const platAccByDay = useMemo(
    () => summarizePlatsAccompagnements(tickets),
    [tickets],
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

  return (
    <AppShell
      title="Historique des ventes"
      subtitle="Tickets POS, journal (carnets / devis / caisse) et importés — CA = Validé uniquement."
      actions={
        <>
          <ExportExcelButton
            onExport={() =>
              exportAllHistoriqueVentesExcel({
                from,
                to,
                site,
                statut,
                source,
                serveur,
                paiement,
                q,
              })
            }
            disabled={loading}
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
            {facets.serveurs.map((s) => (
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
            {facets.paiements.map((p) => (
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
            {formatFcfa(totals.montant)}
          </strong>
          <span className="dash-ca-final-hint">
            {totals.count} ticket{totals.count > 1 ? "s" : ""} affiché
            {totals.count > 1 ? "s" : ""}
          </span>
        </div>
        <div className="dash-ca-final-side">
          <div>
            <span>Validé</span>
            <strong className="mono">{totals.valide}</strong>
          </div>
          <div>
            <span>Annulé</span>
            <strong className="mono">{totals.annule}</strong>
          </div>
          <div>
            <span>En cours</span>
            <strong className="mono">{totals.encours}</strong>
          </div>
        </div>
      </div>

      {error ? (
        <p className="error-banner" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? <BrandLoader variant="ligne" label="Chargement des ventes…" /> : null}

      {!loading && tickets.length > 0 ? (
        <div className="panel panel-wide">
          <div className="panel-head">
            <h2 className="panel-title">Plats et accompagnements vendus par jour</h2>
            <p className="muted hist-line-meta">
              Ventes validées uniquement, quel que soit le filtre Statut ci-dessus.
            </p>
          </div>
          {platAccByDay.length === 0 ? (
            <p className="muted">
              Aucun plat ni accompagnement dans les ventes filtrées.
            </p>
          ) : (
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
          )}
        </div>
      ) : null}

      {!loading && !tickets.length ? (
        <p className="muted">Aucun ticket pour ces filtres.</p>
      ) : null}

      {!loading && tickets.length > 0 ? (
        <div className="panel panel-wide">
          <table className="data-table hist-ventes-table">
            <thead>
              <tr>
                <th scope="col">Ticket</th>
                <th scope="col">Date</th>
                <th scope="col">Site</th>
                <th scope="col">Type</th>
                <th scope="col">Serveur</th>
                <th scope="col">Paiement</th>
                <th scope="col">Source</th>
                <th scope="col" className="col-money">
                  Montant
                </th>
                <th scope="col">Statut</th>
                <th scope="col">
                  <span className="sr-only">Détail</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => {
                const open = expanded === t.id;
                return (
                  <Fragment key={t.id}>
                    <tr>
                      <td className="cell-name">
                        <strong>{t.numero}</strong>
                        {t.client ? (
                          <span className="cell-sub">{t.client}</span>
                        ) : null}
                      </td>
                      <td>{formatWhen(t.at)}</td>
                      <td>{t.site === "zogbo" ? "Zogbo" : "Gbégamey"}</td>
                      <td>{t.typeVente}</td>
                      <td>{t.serveur || "—"}</td>
                      <td>{t.paiement || "—"}</td>
                      <td>
                        <span
                          className={`hist-badge hist-badge-${t.source === "aquapro" ? "transfert" : "vente"}`}
                        >
                          {t.source === "aquapro" ? "Importé" : "KF"}
                        </span>
                      </td>
                      <td className="mono col-money">{formatFcfa(t.montant)}</td>
                      <td>
                        <span
                          className={`hist-statut hist-statut-${t.statut}`}
                        >
                          {t.statutLabel}
                        </span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn-link"
                          onClick={() => setExpanded(open ? null : t.id)}
                        >
                          {open ? "Masquer" : "Lignes"}
                        </button>
                      </td>
                    </tr>
                    {open ? (
                      <tr className="hist-ventes-lines">
                        <td colSpan={10}>
                          <ul className="hist-line-list">
                            {t.lines.map((l, i) => (
                              <li key={`${t.id}-l-${i}`}>
                                <span>
                                  {l.name} × {l.qty}
                                </span>
                                <strong className="mono">
                                  {formatFcfa(l.amount)}
                                </strong>
                              </li>
                            ))}
                          </ul>
                          {(t.table || t.caissier || t.reduction > 0) && (
                            <p className="muted hist-line-meta">
                              {t.table ? `Table ${t.table}` : null}
                              {t.caissier
                                ? `${t.table ? " · " : ""}Caissier ${t.caissier}`
                                : null}
                              {t.reduction > 0
                                ? `${t.table || t.caissier ? " · " : ""}Réduction ${formatFcfa(t.reduction)}`
                                : null}
                            </p>
                          )}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={7}>
                  Total Validé (filtre)
                </th>
                <td className="mono col-money">{formatFcfa(totals.montant)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      ) : null}
    </AppShell>
  );
}
