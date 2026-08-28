"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ExportExcelButton } from "@/components/export-excel-button";
import { formatDateFr, formatTimeFr } from "@/lib/datetime-fr";
import { formatFcfa } from "@/lib/format";
import {
  formatActorLabel,
  HISTORIQUE_ACTION_LABELS,
  HISTORIQUE_KIND_LABELS,
  type HistoriqueActor,
  type HistoriqueEvent,
  type HistoriqueKind,
} from "@/lib/historique-types";
import { exportHistoriqueExcel } from "@/lib/page-exports";
import { todayIsoDate } from "@/lib/zogbo-calc";
import { BrandLoader } from "@/components/brand-loader";

type SiteFilter = "all" | "zogbo" | "gbegamey";
type KindFilter = HistoriqueKind | "all";
type OriginFilter = "all" | "regularisation";

import {
  groupRegularisationEvents,
} from "@/lib/historique-filters";

function monthStartIso(d = todayIsoDate()): string {
  return `${d.slice(0, 7)}-01`;
}

function siteLabel(site: HistoriqueEvent["site"]): string {
  if (site === "zogbo") return "Zogbo";
  if (site === "gbegamey") return "Gbégamey";
  if (site === "tous") return "Tous";
  return "—";
}

function actionLabel(ev: HistoriqueEvent): string {
  if (ev.action) return HISTORIQUE_ACTION_LABELS[ev.action];
  if (ev.kind === "vente_annulee") return "Annulation";
  if (ev.kind === "vente") return "Ajout";
  return HISTORIQUE_KIND_LABELS[ev.kind];
}

function qtyLabel(ev: HistoriqueEvent): string {
  if (ev.action === "modification" && ev.previousQty != null && ev.qty != null) {
    return `${ev.previousQty} → ${ev.qty}`;
  }
  if (ev.qty != null) return String(ev.qty);
  return "—";
}

const KIND_OPTIONS: { value: KindFilter; label: string }[] = [
  { value: "all", label: "Tout" },
  { value: "vente", label: "Ventes (ajouts)" },
  { value: "vente_annulee", label: "Annulations vente" },
  { value: "pos", label: "Tickets POS / modifs / suppressions" },
  { value: "transfert", label: "Transferts" },
  { value: "zogbo", label: "Zogbo" },
  { value: "gbegamey", label: "Gbégamey" },
  { value: "boissons", label: "Boissons" },
  { value: "parametres", label: "Paramètres" },
  { value: "charges", label: "Charges" },
  { value: "user", label: "Utilisateurs" },
  { value: "caisse", label: "Caisse" },
  { value: "matieres", label: "Matières" },
  { value: "immobilisations", label: "Immobilisations" },
  { value: "pertes", label: "Pertes" },
  { value: "reprise", label: "Reprise d’historique" },
];

export function HistoriquePage() {
  const [from, setFrom] = useState(() => monthStartIso());
  const [to, setTo] = useState(() => todayIsoDate());
  const [kind, setKind] = useState<KindFilter>("all");
  const [origin, setOrigin] = useState<OriginFilter>("all");
  const [site, setSite] = useState<SiteFilter>("all");
  const [actorId, setActorId] = useState("");
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [actors, setActors] = useState<HistoriqueActor[]>([]);
  const [lockedSite, setLockedSite] = useState(false);
  const [events, setEvents] = useState<HistoriqueEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        from,
        to,
        kind,
        site,
        origin,
        limit: "300",
      });
      if (actorId) params.set("actorId", actorId);
      if (q.trim()) params.set("q", q.trim());
      const res = await fetch(`/api/historique?${params}`, {
        cache: "no-store",
      });
      const body = (await res.json()) as {
        events?: HistoriqueEvent[];
        actors?: HistoriqueActor[];
        error?: string;
        lockedSite?: boolean;
        allowedSites?: ("zogbo" | "gbegamey")[];
      };
      if (!res.ok) throw new Error(body.error || "Erreur de chargement");
      setEvents(body.events ?? []);
      if (Array.isArray(body.actors)) setActors(body.actors);
      if (body.lockedSite && body.allowedSites?.[0]) {
        setLockedSite(true);
        setSite(body.allowedSites[0]);
      } else if (typeof body.lockedSite === "boolean") {
        setLockedSite(!!body.lockedSite);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement");
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [from, to, kind, site, origin, actorId, q]);

  const regGroups = useMemo(
    () => groupRegularisationEvents(events),
    [events],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AppShell
      title="Registre"
      subtitle="Chronologie des actions avec date et heure de saisie, jour comptable, article, quantités et montants."
      actions={
        <>
          <ExportExcelButton
            onExport={() => exportHistoriqueExcel(events, from, to, site)}
            disabled={loading || events.length === 0}
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
      <div className="hist-filters">
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
          <span>Type</span>
          <select
            className="select-input"
            value={kind}
            onChange={(e) => setKind(e.target.value as KindFilter)}
          >
            {KIND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="date-field">
          <span>Origine</span>
          <select
            className="select-input"
            value={origin}
            onChange={(e) => setOrigin(e.target.value as OriginFilter)}
          >
            <option value="all">Toutes les ventes</option>
            <option value="regularisation">Régularisation uniquement</option>
          </select>
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
          <span>Compte</span>
          <select
            className="select-input"
            value={actorId}
            onChange={(e) => setActorId(e.target.value)}
          >
            <option value="">Tous</option>
            {actors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} (@{a.username})
              </option>
            ))}
          </select>
        </label>
        <label className="date-field">
          <span>Recherche</span>
          <input
            type="search"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setQ(qInput.trim());
            }}
            onBlur={() => setQ(qInput.trim())}
            placeholder="Article, ticket, @identifiant…"
          />
        </label>
      </div>

      <p className="section-hint">
        {loading
          ? "Chargement…"
          : `${events.length} événement${events.length > 1 ? "s" : ""} · filtre par date de saisie`}
      </p>

      {error ? (
        <p className="error-banner" role="alert">
          {error}
        </p>
      ) : null}

      {!loading && regGroups.length > 0 ? (
        <section className="panel panel-wide reg-report">
          <div className="panel-head">
            <h2 className="panel-title">Ventes en régularisation</h2>
            <p className="muted">
              {regGroups.length} groupe{regGroups.length > 1 ? "s" : ""} · ajouts
              et modifications liés
            </p>
          </div>
          <div className="hist-reg-groups">
            {regGroups.map((g) => (
              <article key={g.key} className="hist-reg-group">
                <header className="hist-reg-group-head">
                  <strong>
                    {g.ticketNumero ? `Ticket ${g.ticketNumero}` : "Ligne journal"}
                  </strong>
                  <span className="muted">
                    Jour comptable {g.businessDate ?? "—"} · {siteLabel(g.site)}
                  </span>
                </header>
                <ul className="hist-reg-timeline">
                  {g.events.map((ev) => (
                    <li key={ev.id}>
                      <span className="mono">
                        {formatDateFr(ev.at)} {formatTimeFr(ev.at)}
                      </span>
                      <span className={`hist-badge hist-badge-${ev.kind}`}>
                        {actionLabel(ev)}
                      </span>
                      <span>{ev.productName ?? ev.title}</span>
                      <span className="mono">{qtyLabel(ev)}</span>
                      <span className="mono">
                        {ev.amount != null ? formatFcfa(ev.amount) : "—"}
                      </span>
                      <span className="muted">{formatActorLabel(ev)}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="panel panel-wide">
        <div className="table-scroll">
          <table className="data-table hist-table hist-detail-table">
            <thead>
              <tr>
                <th scope="col">Saisi le</th>
                <th scope="col">Heure</th>
                <th scope="col">Action</th>
                <th scope="col">Jour comptable</th>
                <th scope="col">Site</th>
                <th scope="col">Article</th>
                <th scope="col">Ticket</th>
                <th scope="col" className="col-money">
                  Qté
                </th>
                <th scope="col" className="col-money">
                  PU
                </th>
                <th scope="col" className="col-money">
                  Montant
                </th>
                <th scope="col">Par</th>
                <th scope="col">Détail</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={12}>
                    <BrandLoader variant="ligne" label="Chargement…" />
                  </td>
                </tr>
              ) : events.length === 0 ? (
                <tr>
                  <td colSpan={12} className="muted">
                    Aucun événement sur cette période.
                  </td>
                </tr>
              ) : (
                events.map((ev) => (
                  <tr
                    key={ev.id}
                    className={`hist-row hist-kind-${ev.kind}${ev.saisiTardif ? " reg-row-late" : ""}`}
                  >
                    <td className="mono">{formatDateFr(ev.at)}</td>
                    <td className="mono">{formatTimeFr(ev.at)}</td>
                    <td>
                      <span className={`hist-badge hist-badge-${ev.kind}`}>
                        {actionLabel(ev)}
                      </span>
                      {ev.regularisation ? (
                        <span className="reg-late-badge">Régularisation</span>
                      ) : null}
                      {ev.saisiTardif ? (
                        <span className="reg-late-badge">Saisi tardif</span>
                      ) : null}
                    </td>
                    <td className="mono">{ev.date ?? "—"}</td>
                    <td>{siteLabel(ev.site)}</td>
                    <td className="cell-name">
                      <strong>{ev.productName ?? ev.title.replace(/^[^·]+·\s*/, "")}</strong>
                    </td>
                    <td className="mono">{ev.ticketNumero ?? "—"}</td>
                    <td className="mono col-money">{qtyLabel(ev)}</td>
                    <td className="mono col-money">
                      {ev.unitPrice != null ? formatFcfa(ev.unitPrice) : "—"}
                    </td>
                    <td className="mono col-money">
                      {ev.amount === null || ev.amount === undefined
                        ? "—"
                        : formatFcfa(ev.amount)}
                    </td>
                    <td>{formatActorLabel(ev)}</td>
                    <td className="hist-event-detail muted">{ev.detail}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
