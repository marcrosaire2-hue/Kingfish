"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
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
  JournalVenteLine,
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
  const [flash, setFlash] = useState<string | null>(null);
  const [busyTicketId, setBusyTicketId] = useState<string | null>(null);
  const [busyLineId, setBusyLineId] = useState<string | null>(null);
  const [canManagePast, setCanManagePast] = useState(false);

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
      } else       if (typeof body.lockedSite === "boolean") {
        setLockedSite(!!body.lockedSite);
      }
      setCanManagePast(!!body.canManagePast);
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

  /** Annule le ticket entier lié à cette ligne — retrouvé via son ticketId. */
  async function annulerTicket(l: JournalVenteLine) {
    if (!l.ticketId) return;
    if (
      !window.confirm(
        `Annuler le ticket ${l.numero} (${formatFcfa(l.montant)}) ?\nToutes ses lignes seront annulées et le stock repris.`,
      )
    ) {
      return;
    }
    setBusyTicketId(l.ticketId);
    setError(null);
    setFlash(null);
    try {
      const res = await fetch("/api/pos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "cancel",
          id: l.ticketId,
          date: l.date,
          site: l.site,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Annulation impossible");
      setFlash(`Ticket ${l.numero} annulé.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Annulation impossible");
    } finally {
      setBusyTicketId(null);
    }
  }

  async function modifierLigne(l: JournalVenteLine) {
    if (!l.venteLogId) {
      setError("Cette ligne n’a pas de journal lié.");
      return;
    }
    const raw = window.prompt(
      `Nouvelle quantité pour « ${l.produit} » (actuelle : ${l.qty}) :`,
      String(l.qty),
    );
    if (raw === null) return;
    const next = Math.round(Number(raw));
    if (!Number.isFinite(next) || next < 1) {
      setError("Quantité invalide (minimum 1). Pour supprimer, utilisez Suppr. déf.");
      return;
    }
    setBusyLineId(l.venteLogId);
    setError(null);
    setFlash(null);
    try {
      const res = await fetch("/api/vente", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "edit",
          id: l.venteLogId,
          date: l.date,
          site: l.site,
          qty: next,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Modification impossible");
      setFlash(`Quantité de « ${l.produit} » mise à jour`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Modification impossible");
    } finally {
      setBusyLineId(null);
    }
  }

  async function supprimerLigne(l: JournalVenteLine) {
    if (!l.venteLogId) {
      setError("Cette ligne n’a pas de journal lié.");
      return;
    }
    if (
      !window.confirm(
        `Supprimer définitivement « ${l.produit} × ${l.qty} » ?\nCette action est irréversible.`,
      )
    ) {
      return;
    }
    setBusyLineId(l.venteLogId);
    setError(null);
    setFlash(null);
    try {
      const res = await fetch("/api/vente", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete",
          id: l.venteLogId,
          date: l.date,
          site: l.site,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Suppression impossible");
      setFlash(`« ${l.produit} » supprimé définitivement`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Suppression impossible");
    } finally {
      setBusyLineId(null);
    }
  }

  async function supprimerTicket(l: JournalVenteLine) {
    if (!l.ticketId) return;
    if (
      !window.confirm(
        `Supprimer définitivement le ticket ${l.numero} (${formatFcfa(l.montant)}) ?\nCette action est irréversible.`,
      )
    ) {
      return;
    }
    setBusyTicketId(l.ticketId);
    setError(null);
    setFlash(null);
    try {
      const res = await fetch("/api/pos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete",
          id: l.ticketId,
          date: l.date,
          site: l.site,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Suppression impossible");
      setFlash(`Ticket ${l.numero} supprimé définitivement`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Suppression impossible");
    } finally {
      setBusyTicketId(null);
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
      {flash ? (
        <p className="ui-info" role="status">
          {flash}
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
              busyTicketId={busyTicketId}
              busyLineId={busyLineId}
              canManagePast={canManagePast}
              onCancel={(l) => void annulerTicket(l)}
              onEdit={(l) => void modifierLigne(l)}
              onDeleteLine={(l) => void supprimerLigne(l)}
              onDeleteTicket={(l) => void supprimerTicket(l)}
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
  busyTicketId,
  busyLineId,
  canManagePast,
  onCancel,
  onEdit,
  onDeleteLine,
  onDeleteTicket,
}: {
  day: JournalVenteDay;
  formatHeure: (iso: string) => string;
  siteLabel: (site: string) => string;
  busyTicketId: string | null;
  busyLineId: string | null;
  canManagePast: boolean;
  onCancel: (line: JournalVenteLine) => void;
  onEdit: (line: JournalVenteLine) => void;
  onDeleteLine: (line: JournalVenteLine) => void;
  onDeleteTicket: (line: JournalVenteLine) => void;
}) {
  const boissons = day.lines.filter((l) => l.kind === "boisson");
  const plats = day.lines.filter((l) => l.kind !== "boisson");

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
      <JournalLinesTable
        title="Plats & autres articles"
        lines={plats}
        formatHeure={formatHeure}
        siteLabel={siteLabel}
        busyTicketId={busyTicketId}
        busyLineId={busyLineId}
        canManagePast={canManagePast}
        onCancel={onCancel}
        onEdit={onEdit}
        onDeleteLine={onDeleteLine}
        onDeleteTicket={onDeleteTicket}
      />
      <JournalLinesTable
        title="Boissons"
        lines={boissons}
        formatHeure={formatHeure}
        siteLabel={siteLabel}
        busyTicketId={busyTicketId}
        busyLineId={busyLineId}
        canManagePast={canManagePast}
        onCancel={onCancel}
        onEdit={onEdit}
        onDeleteLine={onDeleteLine}
        onDeleteTicket={onDeleteTicket}
      />
    </div>
  );
}

function JournalLinesTable({
  title,
  lines,
  formatHeure,
  siteLabel,
  busyTicketId,
  busyLineId,
  canManagePast,
  onCancel,
  onEdit,
  onDeleteLine,
  onDeleteTicket,
}: {
  title: string;
  lines: JournalVenteLine[];
  formatHeure: (iso: string) => string;
  siteLabel: (site: string) => string;
  busyTicketId: string | null;
  busyLineId: string | null;
  canManagePast: boolean;
  onCancel: (line: JournalVenteLine) => void;
  onEdit: (line: JournalVenteLine) => void;
  onDeleteLine: (line: JournalVenteLine) => void;
  onDeleteTicket: (line: JournalVenteLine) => void;
}) {
  if (lines.length === 0) return null;

  const total = lines.reduce(
    (s, l) => (l.statut === "valide" ? s + l.montant : s),
    0,
  );

  return (
    <div className="jv-group">
      <h3 className="jv-group-title">
        {title}
        <span className="jv-day-head-count">
          {lines.length} ligne{lines.length > 1 ? "s" : ""}
        </span>
      </h3>
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
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={`${l.date}-${title}-${i}`}>
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
                <td>
                  {canManagePast ? (
                    <span className="reg-actions">
                      {l.statut === "valide" && l.venteLogId ? (
                        <button
                          type="button"
                          className="btn-link"
                          disabled={busyLineId === l.venteLogId}
                          onClick={() => onEdit(l)}
                        >
                          {busyLineId === l.venteLogId ? "…" : "Qty"}
                        </button>
                      ) : null}
                      {l.venteLogId ? (
                        <button
                          type="button"
                          className="btn-link btn-link-danger"
                          disabled={busyLineId === l.venteLogId}
                          onClick={() => onDeleteLine(l)}
                        >
                          Suppr.
                        </button>
                      ) : null}
                      {l.ticketId ? (
                        <button
                          type="button"
                          className="btn-link btn-link-danger"
                          disabled={busyTicketId === l.ticketId}
                          onClick={() => onDeleteTicket(l)}
                        >
                          {busyTicketId === l.ticketId
                            ? "…"
                            : "Ticket"}
                        </button>
                      ) : null}
                      {l.statut === "valide" && l.ticketId ? (
                        <button
                          type="button"
                          className="btn-link"
                          disabled={busyTicketId === l.ticketId}
                          onClick={() => onCancel(l)}
                        >
                          Annuler
                        </button>
                      ) : null}
                      {!l.venteLogId && !l.ticketId ? "—" : null}
                    </span>
                  ) : l.statut === "valide" && l.ticketId ? (
                    <button
                      type="button"
                      className="btn-link"
                      disabled={busyTicketId === l.ticketId}
                      onClick={() => onCancel(l)}
                    >
                      {busyTicketId === l.ticketId ? "…" : "Annuler"}
                    </button>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={7}>
                Total {title} (Validé)
              </th>
              <td className="mono col-money">{lines.length}</td>
              <td colSpan={1} />
              <td className="mono col-money">{formatFcfa(total)}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
