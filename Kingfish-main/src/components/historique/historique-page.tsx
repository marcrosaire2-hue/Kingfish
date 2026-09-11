"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { BrandLoader } from "@/components/brand-loader";
import { DashboardShell } from "@/components/dashboard/dashboard-layout";
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
import "./historique-page.css";

type SiteFilter = "all" | "zogbo" | "gbegamey";
type KindFilter = HistoriqueKind | "all";
type PeriodPreset = "today" | "week" | "month" | "custom";
type RegistreView = "timeline" | "table";

type DayGroup = {
  date: string;
  events: HistoriqueEvent[];
  amount: number;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const PERIODS: { id: PeriodPreset; label: string }[] = [
  { id: "today", label: "Aujourd’hui" },
  { id: "week", label: "7 jours" },
  { id: "month", label: "Mois" },
];

const QUICK_KINDS: { value: KindFilter; label: string }[] = [
  { value: "all", label: "Tout" },
  { value: "vente", label: "Ventes" },
  { value: "vente_annulee", label: "Annulations" },
  { value: "caisse", label: "Caisse" },
  { value: "pos", label: "POS" },
  { value: "pertes", label: "Pertes" },
];

const KIND_OPTIONS: { value: KindFilter; label: string }[] = [
  { value: "all", label: "Tout" },
  { value: "vente", label: "Ventes" },
  { value: "vente_annulee", label: "Annulations" },
  { value: "transfert", label: "Transferts" },
  { value: "zogbo", label: "Zogbo" },
  { value: "gbegamey", label: "Gbégamey" },
  { value: "boissons", label: "Boissons" },
  { value: "parametres", label: "Paramètres" },
  { value: "charges", label: "Charges" },
  { value: "user", label: "Utilisateurs" },
  { value: "caisse", label: "Caisse" },
  { value: "pos", label: "Tickets POS" },
  { value: "matieres", label: "Matières" },
  { value: "immobilisations", label: "Immobilisations" },
  { value: "pertes", label: "Pertes" },
  { value: "versements", label: "Versements" },
  { value: "reprise", label: "Reprise d’historique" },
  { value: "connexion", label: "Connexions" },
];

function monthStartIso(d = todayIsoDate()): string {
  return `${d.slice(0, 7)}-01`;
}

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + days));
  return dt.toISOString().slice(0, 10);
}

function inferPeriod(from: string, to: string): PeriodPreset {
  const today = todayIsoDate();
  if (from === today && to === today) return "today";
  if (from === addDaysIso(today, -6) && to === today) return "week";
  if (from === monthStartIso(today) && to === today) return "month";
  return "custom";
}

function parseIsoDate(value?: string): string | null {
  if (!value || !ISO_DATE.test(value)) return null;
  return value;
}

function parseSite(value?: string): SiteFilter | null {
  if (value === "all" || value === "zogbo" || value === "gbegamey") return value;
  return null;
}

function parseKind(value?: string): KindFilter | null {
  if (!value) return null;
  if (value === "all") return "all";
  if (value in HISTORIQUE_KIND_LABELS) return value as HistoriqueKind;
  return null;
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

function formatDateShort(iso: string): string {
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      day: "numeric",
      month: "short",
      timeZone: "Africa/Porto-Novo",
    }).format(new Date(`${iso}T12:00:00`));
  } catch {
    return iso;
  }
}

function formatHeureOnly(iso: string): string {
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

function siteLabel(site: HistoriqueEvent["site"] | SiteFilter): string {
  if (site === "zogbo") return "Zogbo";
  if (site === "gbegamey") return "Gbégamey";
  if (site === "tous" || site === "all") return "Tous";
  return "—";
}

function eventDay(ev: HistoriqueEvent): string {
  if (ev.date && ISO_DATE.test(ev.date)) return ev.date;
  const slice = ev.at.slice(0, 10);
  return ISO_DATE.test(slice) ? slice : todayIsoDate();
}

function useDebouncedValue<T>(value: T, delayMs = 280): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

type HistoriquePageProps = {
  initialFrom?: string;
  initialTo?: string;
  initialSite?: string;
  initialKind?: string;
};

export function HistoriquePage({
  initialFrom,
  initialTo,
  initialSite,
  initialKind,
}: HistoriquePageProps) {
  const today = todayIsoDate();
  const startFrom = parseIsoDate(initialFrom) ?? monthStartIso(today);
  const startTo = parseIsoDate(initialTo) ?? today;
  const startSite = parseSite(initialSite) ?? "all";
  const startKind = parseKind(initialKind) ?? "all";

  const [from, setFrom] = useState(startFrom);
  const [to, setTo] = useState(startTo);
  const [kind, setKind] = useState<KindFilter>(startKind);
  const [site, setSite] = useState<SiteFilter>(startSite);
  const [actorId, setActorId] = useState("");
  const [qInput, setQInput] = useState("");
  const q = useDebouncedValue(qInput);
  const [view, setView] = useState<RegistreView>("timeline");
  const [kindFocus, setKindFocus] = useState<HistoriqueKind | "all">("all");
  const [actors, setActors] = useState<HistoriqueActor[]>([]);
  const [allowedSites, setAllowedSites] = useState<("zogbo" | "gbegamey")[]>([
    "zogbo",
    "gbegamey",
  ]);
  const [lockedSite, setLockedSite] = useState(false);
  const [events, setEvents] = useState<HistoriqueEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const period = inferPeriod(from, to);

  const applyPeriod = (id: PeriodPreset) => {
    const now = todayIsoDate();
    if (id === "today") {
      setFrom(now);
      setTo(now);
      return;
    }
    if (id === "week") {
      setFrom(addDaysIso(now, -6));
      setTo(now);
      return;
    }
    if (id === "month") {
      setFrom(monthStartIso(now));
      setTo(now);
    }
  };

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
      if (Array.isArray(body.allowedSites) && body.allowedSites.length > 0) {
        setAllowedSites(body.allowedSites);
      }
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

  const focusedEvents = useMemo(
    () =>
      kindFocus === "all"
        ? events
        : events.filter((ev) => ev.kind === kindFocus),
    [events, kindFocus],
  );

  const kindTotals = useMemo(() => {
    const map = new Map<HistoriqueKind, { count: number; amount: number }>();
    for (const ev of events) {
      const cur = map.get(ev.kind) ?? { count: 0, amount: 0 };
      cur.count += 1;
      if (typeof ev.amount === "number") cur.amount += ev.amount;
      map.set(ev.kind, cur);
    }
    return [...map.entries()]
      .map(([k, v]) => ({
        kind: k,
        label: HISTORIQUE_KIND_LABELS[k],
        count: v.count,
        amount: v.amount,
      }))
      .sort((a, b) => b.count - a.count);
  }, [events]);

  const days = useMemo(() => {
    const byDay = new Map<string, DayGroup>();
    for (const ev of focusedEvents) {
      const date = eventDay(ev);
      let day = byDay.get(date);
      if (!day) {
        day = { date, events: [], amount: 0 };
        byDay.set(date, day);
      }
      day.events.push(ev);
      if (typeof ev.amount === "number") day.amount += ev.amount;
    }
    for (const day of byDay.values()) {
      day.events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    }
    return [...byDay.values()].sort((a, b) =>
      a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
    );
  }, [focusedEvents]);

  const totalAmount = focusedEvents.reduce(
    (s, ev) => (typeof ev.amount === "number" ? s + ev.amount : s),
    0,
  );
  const amountCount = focusedEvents.filter(
    (ev) => typeof ev.amount === "number",
  ).length;
  const mixTotal = kindTotals.reduce((s, k) => s + k.count, 0);
  const extraFilterCount =
    Number(!!actorId) +
    Number(kind !== "all" && !QUICK_KINDS.some((k) => k.value === kind));

  const periodHint =
    from === to
      ? formatDateLong(from)
      : `${formatDateShort(from)} → ${formatDateShort(to)}`;

  const pageSubtitle =
    lockedSite && site !== "all"
      ? `Mouvements et comptes · ${siteLabel(site)}`
      : "Ventes, caisse, POS, stocks, paramètres — liés au compte auteur.";

  const siteOptions = (
    [
      ["all", "Tous"],
      ["zogbo", "Zogbo"],
      ["gbegamey", "Gbégamey"],
    ] as const
  ).filter(
    ([value]) =>
      value === "all" || allowedSites.includes(value as "zogbo" | "gbegamey"),
  );

  return (
    <AppShell
      title="Registre"
      subtitle={pageSubtitle}
      mainClassName="main-historique"
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
      <DashboardShell className="rg-page">
        <section className="panel rg-toolbar" aria-label="Filtres du registre">
          <div className="rg-toolbar-top">
            <div className="rg-periods" role="tablist" aria-label="Période">
              {PERIODS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="tab"
                  aria-selected={period === p.id}
                  className={`rg-chip${period === p.id ? " is-active" : ""}`}
                  onClick={() => applyPeriod(p.id)}
                >
                  {p.label}
                </button>
              ))}
              {period === "custom" ? (
                <span className="rg-chip is-active is-static">Perso.</span>
              ) : null}
            </div>
            <div className="rg-dates">
              <label className="date-field date-field-pill">
                <span>Du</span>
                <input
                  type="date"
                  value={from}
                  max={to}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!ISO_DATE.test(v)) return;
                    setFrom(v);
                  }}
                />
              </label>
              <label className="date-field date-field-pill">
                <span>Au</span>
                <input
                  type="date"
                  value={to}
                  min={from}
                  max={todayIsoDate()}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!ISO_DATE.test(v)) return;
                    setTo(v);
                  }}
                />
              </label>
            </div>
            <label className="rg-search">
              <span className="sr-only">Recherche</span>
              <input
                type="search"
                placeholder="Nom, détail, @identifiant…"
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
              />
            </label>
          </div>

          <div className="rg-toolbar-row">
            {lockedSite ? (
              <span className="rg-lock-pill">{siteLabel(site)}</span>
            ) : (
              <div className="rg-seg" role="tablist" aria-label="Site">
                {siteOptions.map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={site === value}
                    className={`rg-seg-btn${site === value ? " is-active" : ""}`}
                    onClick={() => setSite(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            <div className="rg-seg" role="tablist" aria-label="Type">
              {QUICK_KINDS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="tab"
                  aria-selected={kind === o.value}
                  className={`rg-seg-btn${kind === o.value ? " is-active" : ""}`}
                  onClick={() => {
                    setKind(o.value);
                    setKindFocus("all");
                  }}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <details className="rg-more">
              <summary>
                Plus de filtres
                {extraFilterCount > 0 ? (
                  <span className="rg-more-count">{extraFilterCount}</span>
                ) : null}
              </summary>
              <div className="rg-more-body">
                <label className="date-field date-field-pill">
                  <span>Type</span>
                  <select
                    className="select-input"
                    value={kind}
                    onChange={(e) => {
                      setKind(e.target.value as KindFilter);
                      setKindFocus("all");
                    }}
                  >
                    {KIND_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="date-field date-field-pill">
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
              </div>
            </details>
          </div>
        </section>

        <section className="rg-hero" aria-label="Synthèse de la période">
          <div className="rg-hero-ca">
            <span className="rg-kicker">Événements filtrés</span>
            <strong className="rg-hero-value mono">
              {focusedEvents.length}
            </strong>
            <p className="rg-hero-hint">{periodHint}</p>
            <p className="rg-hero-meta">
              {days.length} jour{days.length > 1 ? "s" : ""}
              {amountCount > 0
                ? ` · ${amountCount} avec montant · ${formatFcfa(totalAmount)}`
                : ""}
            </p>
          </div>
          <div className="rg-hero-side">
            <div className="rg-kpis">
              <div>
                <span>Types</span>
                <strong className="mono">{kindTotals.length}</strong>
              </div>
              <div>
                <span>Avec montant</span>
                <strong className="mono">{amountCount}</strong>
              </div>
              <div>
                <span>Total</span>
                <strong className="mono">
                  {amountCount > 0 ? formatFcfa(totalAmount) : "—"}
                </strong>
              </div>
            </div>
            <div className="rg-mix" aria-label="Répartition par type">
              <div className="rg-mix-bar" aria-hidden>
                {kindTotals.map((k) =>
                  k.count > 0 && mixTotal > 0 ? (
                    <span
                      key={k.kind}
                      className={`rg-mix-seg rg-mix-${k.kind}`}
                      style={{ width: `${(k.count / mixTotal) * 100}%` }}
                    />
                  ) : null,
                )}
              </div>
              <div className="rg-mix-chips" role="tablist" aria-label="Type">
                <button
                  type="button"
                  className={`rg-mix-chip rg-mix-chip-all${kindFocus === "all" ? " is-active" : ""}`}
                  onClick={() => setKindFocus("all")}
                >
                  Tout
                </button>
                {kindTotals.slice(0, 6).map((k) => (
                  <button
                    key={k.kind}
                    type="button"
                    className={`rg-mix-chip rg-mix-chip-${k.kind}${kindFocus === k.kind ? " is-active" : ""}`}
                    onClick={() =>
                      setKindFocus(kindFocus === k.kind ? "all" : k.kind)
                    }
                  >
                    <span>{k.label}</span>
                    <strong className="mono">{k.count}</strong>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <div className="rg-viewbar">
          <div className="rg-seg" role="tablist" aria-label="Présentation">
            <button
              type="button"
              role="tab"
              aria-selected={view === "timeline"}
              className={`rg-seg-btn${view === "timeline" ? " is-active" : ""}`}
              onClick={() => setView("timeline")}
            >
              Chronologie
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "table"}
              className={`rg-seg-btn${view === "table" ? " is-active" : ""}`}
              onClick={() => setView("table")}
            >
              Tableau
            </button>
          </div>
        </div>

        {error ? (
          <p className="error-banner" role="alert">
            {error}
          </p>
        ) : null}

        {loading && events.length === 0 ? (
          <BrandLoader label="Chargement du registre…" />
        ) : null}

        {!loading && focusedEvents.length === 0 ? (
          <div className="panel rg-empty">
            <strong>Aucun événement pour ces filtres.</strong>
            <p className="muted">
              Changez la période, le site ou le type pour afficher le registre.
            </p>
          </div>
        ) : null}

        <div
          className={
            loading && events.length > 0 ? "rg-feed is-loading" : "rg-feed"
          }
        >
          {view === "timeline"
            ? days.map((day, index) => (
                <RegistreDayBlock
                  key={day.date}
                  day={day}
                  defaultOpen={index < 3}
                  hideSite={lockedSite}
                />
              ))
            : focusedEvents.length > 0
              ? (
                  <section className="panel panel-wide rg-table-panel">
                    <div className="table-scroll">
                      <table className="data-table hist-table">
                        <thead>
                          <tr>
                            <th scope="col">Quand</th>
                            <th scope="col">Type</th>
                            {lockedSite ? null : <th scope="col">Site</th>}
                            <th scope="col">Jour</th>
                            <th scope="col">Événement</th>
                            <th scope="col">Par</th>
                            <th scope="col" className="col-money">
                              Montant
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {focusedEvents.map((ev) => (
                            <tr
                              key={ev.id}
                              className={`hist-row hist-kind-${ev.kind}`}
                            >
                              <td className="mono hist-when">
                                {formatWhen(ev.at)}
                              </td>
                              <td>
                                <span
                                  className={`hist-badge hist-badge-${ev.kind}`}
                                >
                                  {HISTORIQUE_KIND_LABELS[ev.kind]}
                                </span>
                              </td>
                              {lockedSite ? null : (
                                <td>{siteLabel(ev.site)}</td>
                              )}
                              <td className="mono">{ev.date ?? "—"}</td>
                              <td>
                                <div className="hist-event-title">{ev.title}</div>
                                <div className="hist-event-detail muted">
                                  {ev.detail}
                                </div>
                              </td>
                              <td>{formatActorLabel(ev)}</td>
                              <td className="col-money mono cell-readonly">
                                {ev.amount === null || ev.amount === undefined
                                  ? "—"
                                  : formatFcfa(ev.amount)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )
              : null}
        </div>
      </DashboardShell>
    </AppShell>
  );
}

function RegistreDayBlock({
  day,
  defaultOpen,
  hideSite,
}: {
  day: DayGroup;
  defaultOpen: boolean;
  hideSite: boolean;
}) {
  const openedOnce = useRef(false);

  return (
    <details
      className="panel rg-day"
      ref={(el) => {
        if (!el || openedOnce.current) return;
        openedOnce.current = true;
        if (defaultOpen) el.open = true;
      }}
    >
      <summary className="rg-day-summary">
        <span className="rg-day-title">
          <strong>{formatDateLong(day.date)}</strong>
          <span>
            {day.events.length} événement{day.events.length > 1 ? "s" : ""}
          </span>
        </span>
        <strong className="rg-day-total mono">
          {day.amount !== 0 ? formatFcfa(day.amount) : "—"}
        </strong>
      </summary>

      <div className="rg-events">
        {day.events.map((ev) => (
          <RegistreEventCard key={ev.id} event={ev} hideSite={hideSite} />
        ))}
      </div>
    </details>
  );
}

function RegistreEventCard({
  event,
  hideSite,
}: {
  event: HistoriqueEvent;
  hideSite: boolean;
}) {
  const meta = [
    hideSite ? null : siteLabel(event.site),
    formatActorLabel(event),
  ]
    .filter((x) => x && x !== "—")
    .join(" · ");

  return (
    <details className={`rg-event rg-event-${event.kind}`}>
      <summary className="rg-event-summary">
        <span className="rg-event-time">{formatHeureOnly(event.at)}</span>
        <span className="rg-event-id">
          <strong>{event.title}</strong>
          <span className="rg-event-preview">{event.detail || "—"}</span>
          {meta ? <span className="rg-event-meta">{meta}</span> : null}
        </span>
        <span className={`hist-badge hist-badge-${event.kind}`}>
          {HISTORIQUE_KIND_LABELS[event.kind]}
        </span>
        <strong className="rg-event-amount mono">
          {event.amount === null || event.amount === undefined
            ? "—"
            : formatFcfa(event.amount)}
        </strong>
      </summary>
      <div className="rg-event-body">
        <dl className="rg-event-facts">
          <div>
            <dt>Quand</dt>
            <dd className="mono">{formatWhen(event.at)}</dd>
          </div>
          <div>
            <dt>Type</dt>
            <dd>{HISTORIQUE_KIND_LABELS[event.kind]}</dd>
          </div>
          {!hideSite ? (
            <div>
              <dt>Site</dt>
              <dd>{siteLabel(event.site)}</dd>
            </div>
          ) : null}
          <div>
            <dt>Jour</dt>
            <dd className="mono">{event.date ?? "—"}</dd>
          </div>
          <div>
            <dt>Par</dt>
            <dd>{formatActorLabel(event)}</dd>
          </div>
          <div>
            <dt>Montant</dt>
            <dd className="mono">
              {event.amount === null || event.amount === undefined
                ? "—"
                : formatFcfa(event.amount)}
            </dd>
          </div>
        </dl>
        {event.detail ? <p className="rg-event-detail">{event.detail}</p> : null}
      </div>
    </details>
  );
}
