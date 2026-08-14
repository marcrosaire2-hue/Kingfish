"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ExportExcelButton } from "@/components/export-excel-button";
import { formatFcfa } from "@/lib/format";
import {
  formatActorLabel,
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

function monthStartIso(d = todayIsoDate()): string {
  return `${d.slice(0, 7)}-01`;
}

function formatWhen(iso: string): string {
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

function siteLabel(site: HistoriqueEvent["site"]): string {
  if (site === "zogbo") return "Zogbo";
  if (site === "gbegamey") return "Gbégamey";
  if (site === "tous") return "Tous";
  return "—";
}

const KIND_OPTIONS: { value: KindFilter; label: string }[] = [
  { value: "all", label: "Tout" },
  { value: "vente", label: "Ventes" },
  { value: "vente_annulee", label: "Annulations" },
  { value: "transfert", label: "Transferts" },
  { value: "zogbo", label: "Zogbo" },
  { value: "gbegamey", label: "Gbégamey" },
  { value: "combos", label: "Combos" },
  { value: "boissons", label: "Boissons" },
  { value: "parametres", label: "Paramètres" },
  { value: "charges", label: "Charges" },
  { value: "user", label: "Utilisateurs" },
  { value: "caisse", label: "Caisse" },
  { value: "pos", label: "Tickets POS" },
  { value: "matieres", label: "Matières" },
  { value: "reprise", label: "Reprise d’historique" },
];

export function HistoriquePage() {
  const [from, setFrom] = useState(() => monthStartIso());
  const [to, setTo] = useState(() => todayIsoDate());
  const [kind, setKind] = useState<KindFilter>("all");
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
  }, [from, to, kind, site, actorId, q]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AppShell
      title="Registre"
      subtitle="Tous les mouvements liés au compte qui les a effectués : ventes, caisse, POS, stocks, paramètres."
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
            placeholder="Nom, détail, @identifiant…"
          />
        </label>
      </div>

      <p className="section-hint">
        {loading
          ? "Chargement…"
          : `${events.length} événement${events.length > 1 ? "s" : ""}`}
      </p>

      {error ? (
        <p className="error-banner" role="alert">
          {error}
        </p>
      ) : null}

      <section className="panel panel-wide">
        <table className="data-table hist-table">
          <thead>
            <tr>
              <th scope="col">Quand</th>
              <th scope="col">Type</th>
              <th scope="col">Site</th>
              <th scope="col">Jour</th>
              <th scope="col">Événement</th>
              <th scope="col">Par</th>
              <th scope="col" className="col-money">
                Montant
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7}>
                      <BrandLoader variant="ligne" label="Chargement…" />
                    </td>
              </tr>
            ) : events.length === 0 ? (
              <tr>
                <td colSpan={7} className="muted">
                  Aucun événement sur cette période. Les ventes et
                  enregistrements apparaîtront ici au fur et à mesure.
                </td>
              </tr>
            ) : (
              events.map((ev) => (
                <tr key={ev.id} className={`hist-row hist-kind-${ev.kind}`}>
                  <td className="mono hist-when">{formatWhen(ev.at)}</td>
                  <td>
                    <span className={`hist-badge hist-badge-${ev.kind}`}>
                      {HISTORIQUE_KIND_LABELS[ev.kind]}
                    </span>
                  </td>
                  <td>{siteLabel(ev.site)}</td>
                  <td className="mono">{ev.date ?? "—"}</td>
                  <td>
                    <div className="hist-event-title">{ev.title}</div>
                    <div className="hist-event-detail muted">{ev.detail}</div>
                  </td>
                  <td>{formatActorLabel(ev)}</td>
                  <td className="col-money mono cell-readonly">
                    {ev.amount === null || ev.amount === undefined
                      ? "—"
                      : formatFcfa(ev.amount)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </AppShell>
  );
}
