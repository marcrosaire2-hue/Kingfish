"use client";

import { useLiveRefresh } from "@/lib/use-live-refresh";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppShell } from "@/components/app-shell";
import { BrandLoader } from "@/components/brand-loader";
import { DashboardShell } from "@/components/dashboard/dashboard-layout";
import { SITE_LABELS } from "@/lib/auth-types";
import { formatFcfa } from "@/lib/format";
import type { PosTicket, VenteSite } from "@/lib/types";
import { shiftIsoDate, todayIsoDate } from "@/lib/zogbo-calc";
import "@/components/journal-ventes/journal-ventes-page.css";

type Payload = { from: string; to: string; tickets: PosTicket[]; error?: string };
type Period = "today" | "week" | "month" | "custom";
type StatutFiltre = "attente" | "validee" | "refusee" | "all";
type SiteFiltre = "all" | VenteSite;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const PERIODS: { id: Exclude<Period, "custom">; label: string }[] = [
  { id: "today", label: "Aujourd’hui" },
  { id: "week", label: "7 jours" },
  { id: "month", label: "Mois" },
];

/** Classe d'affichage commune avec le journal des ventes (valide / annule / encours). */
function visuel(statut: string): "valide" | "annule" | "encours" {
  if (statut === "direction_validee" || statut === "valide") return "valide";
  if (statut === "annule") return "annule";
  return "encours";
}

const STATUT_LABELS: Record<string, string> = {
  en_attente: "À valider",
  direction_validee: "Validée",
  annule: "Refusée",
  valide: "Validée",
};

function monthStartIso(d = todayIsoDate()): string {
  return `${d.slice(0, 7)}-01`;
}

function formatDateLong(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  const s = d.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function siteLabel(site: string): string {
  return SITE_LABELS[site as keyof typeof SITE_LABELS] ?? site;
}

function csvCell(value: unknown): string {
  const s = String(value ?? "");
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportCsv(tickets: PosTicket[], from: string, to: string) {
  const header = [
    "Date",
    "Heure",
    "Site",
    "Ticket",
    "Statut",
    "Saisi par",
    "Validé par",
    "Montant (FCFA)",
    "Articles",
  ];
  const rows = tickets.map((t) => [
    t.date,
    t.at.slice(11, 16),
    siteLabel(t.site),
    t.numero,
    STATUT_LABELS[t.statut] ?? t.statut,
    t.userName,
    t.validatedByName ?? "",
    t.montant,
    t.lines.map((l) => `${l.qty} x ${l.name}`).join(" + "),
  ]);
  const csv = [header, ...rows].map((r) => r.map(csvCell).join(";")).join("\r\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `journal-ventes-direction_${from}_${to}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Journal des ventes direction : même présentation que le journal des ventes. */
export function JournalDirectionPage() {
  const today = todayIsoDate();
  const [period, setPeriod] = useState<Period>("month");
  const [from, setFrom] = useState(() => monthStartIso(today));
  const [to, setTo] = useState(today);
  const [site, setSite] = useState<SiteFiltre>("all");
  const [statut, setStatut] = useState<StatutFiltre>("all");
  const [q, setQ] = useState("");
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  function applyPeriod(p: Exclude<Period, "custom">) {
    setPeriod(p);
    setTo(today);
    setFrom(
      p === "today"
        ? today
        : p === "week"
          ? (shiftIsoDate(today, -6) ?? today)
          : monthStartIso(today),
    );
  }

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/ventes-direction?from=${from}&to=${to}`,
        { cache: "no-store" },
      );
      const body = (await res.json()) as Payload;
      if (!res.ok) throw new Error(body.error || "Chargement impossible.");
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    // Chargement initial et à chaque changement de période.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useLiveRefresh(() => void load(true));

  const parSite = useMemo(
    () => (data?.tickets ?? []).filter((t) => site === "all" || t.site === site),
    [data, site],
  );

  const visibles = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return parSite.filter((t) => {
      if (statut === "attente" && t.statut !== "en_attente") return false;
      if (statut === "validee" && t.statut !== "direction_validee") return false;
      if (statut === "refusee" && t.statut !== "annule") return false;
      if (!needle) return true;
      const hay = [
        t.numero,
        t.userName,
        t.validatedByName ?? "",
        ...t.lines.map((l) => l.name),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [parSite, statut, q]);

  const jours = useMemo(() => {
    const map = new Map<string, PosTicket[]>();
    for (const t of visibles) {
      const list = map.get(t.date) ?? [];
      list.push(t);
      map.set(t.date, list);
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [visibles]);

  const totaux = useMemo(() => {
    const somme = (s: string) => {
      const l = parSite.filter((t) => t.statut === s);
      return { n: l.length, montant: l.reduce((a, t) => a + t.montant, 0) };
    };
    return {
      attente: somme("en_attente"),
      validees: somme("direction_validee"),
      refusees: somme("annule"),
    };
  }, [parSite]);

  async function act(ticket: PosTicket, action: "approve-direction" | "cancel") {
    const label = `${ticket.numero} (${formatFcfa(ticket.montant)})`;
    const ok = window.confirm(
      action === "approve-direction"
        ? `Valider la vente direction ${label} ? Elle ne sera jamais comptée dans le CA des ventes clients.`
        : `Refuser la vente direction ${label} ?`,
    );
    if (!ok) return;
    setBusyId(ticket.id);
    setError(null);
    setFlash(null);
    try {
      const res = await fetch("/api/pos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          id: ticket.id,
          date: ticket.date,
          site: ticket.site,
        }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error || "Action impossible.");
      setFlash(
        action === "approve-direction"
          ? `Vente direction ${ticket.numero} validée.`
          : `Vente direction ${ticket.numero} refusée.`,
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action impossible.");
    } finally {
      setBusyId(null);
    }
  }

  const periodHint =
    from === to ? formatDateLong(from) : `${from} → ${to}`;

  return (
    <AppShell
      title="Journal des ventes direction"
      mainClassName="main-journal-ventes"
    >
      <DashboardShell className="jv-page">
        <section className="panel jv-toolbar" aria-label="Filtres du journal">
          <div className="jv-toolbar-top">
            <div className="jv-periods" role="tablist" aria-label="Période">
              {PERIODS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="tab"
                  aria-selected={period === p.id}
                  className={`jv-chip${period === p.id ? " is-active" : ""}`}
                  onClick={() => applyPeriod(p.id)}
                >
                  {p.label}
                </button>
              ))}
              {period === "custom" ? (
                <span className="jv-chip is-active is-static">Perso.</span>
              ) : null}
            </div>
            <div className="jv-dates">
              <label className="date-field date-field-pill">
                <span>Du</span>
                <input
                  type="date"
                  value={from}
                  max={to}
                  onChange={(e) => {
                    if (!ISO_DATE.test(e.target.value)) return;
                    setPeriod("custom");
                    setFrom(e.target.value);
                  }}
                />
              </label>
              <label className="date-field date-field-pill">
                <span>Au</span>
                <input
                  type="date"
                  value={to}
                  min={from}
                  max={today}
                  onChange={(e) => {
                    if (!ISO_DATE.test(e.target.value)) return;
                    setPeriod("custom");
                    setTo(e.target.value);
                  }}
                />
              </label>
            </div>
            <label className="jv-search">
              <span className="sr-only">Recherche</span>
              <svg className="jv-search-ico" viewBox="0 0 24 24" aria-hidden focusable="false">
                <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm9 16-4-4" />
              </svg>
              <input
                type="search"
                placeholder="N° ticket, produit, saisi par…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </label>
          </div>

          <div className="jv-toolbar-row">
            <div className="jv-seg" role="tablist" aria-label="Site">
              {(
                [
                  ["all", "Les deux sites"],
                  ["zogbo", "Zogbo"],
                  ["gbegamey", "Gbégamey"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={site === value}
                  className={`jv-seg-btn${site === value ? " is-active" : ""}`}
                  onClick={() => setSite(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="jv-seg" role="tablist" aria-label="Statut">
              {(
                [
                  ["all", "Tous", "all"],
                  ["attente", "À valider", "encours"],
                  ["validee", "Validées", "valide"],
                  ["refusee", "Refusées", "annule"],
                ] as const
              ).map(([value, label, css]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={statut === value}
                  className={`jv-seg-btn jv-statut-${css}${statut === value ? " is-active" : ""}`}
                  onClick={() => setStatut(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="jv-toolbar-actions">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={!visibles.length}
                onClick={() => exportCsv(visibles, from, to)}
              >
                Exporter CSV
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => void load()}
                disabled={loading}
              >
                Actualiser
              </button>
            </div>
          </div>
        </section>

        <section className="jv-summary" aria-label="Synthèse de la période">
          <div className="jv-summary-main">
            <span className="jv-summary-label">Ventes direction validées · {periodHint}</span>
            <strong className="jv-summary-value mono">
              {formatFcfa(totaux.validees.montant)}
            </strong>
          </div>
          <dl className="jv-summary-facts">
            <div>
              <dt>Tickets</dt>
              <dd className="mono">{parSite.length}</dd>
            </div>
            <div>
              <dt>Jours</dt>
              <dd className="mono">{new Set(parSite.map((t) => t.date)).size}</dd>
            </div>
            <div>
              <dt>À valider</dt>
              <dd className="mono">
                {totaux.attente.n} · {formatFcfa(totaux.attente.montant)}
              </dd>
            </div>
            <div>
              <dt>Validées</dt>
              <dd className="mono">{totaux.validees.n}</dd>
            </div>
            <div>
              <dt>Refusées</dt>
              <dd className="mono">{totaux.refusees.n}</dd>
            </div>
          </dl>
        </section>

        {flash ? (
          <p className="ui-info" role="status">
            {flash}
          </p>
        ) : null}
        {error ? (
          <p className="error-banner" role="alert">
            {error}
          </p>
        ) : null}

        {loading && !data ? <BrandLoader label="Chargement du journal…" /> : null}

        {!loading && !jours.length ? (
          <div className="panel jv-empty">
            <strong>Aucune vente direction pour ces filtres.</strong>
          </div>
        ) : null}

        <div className={loading && jours.length > 0 ? "jv-feed is-loading" : "jv-feed"}>
          {jours.map(([date, tickets], index) => (
            <DirectionDayBlock
              key={date}
              date={date}
              tickets={tickets}
              defaultOpen={index < 3}
              busyId={busyId}
              onAct={act}
            />
          ))}
        </div>
      </DashboardShell>
    </AppShell>
  );
}

function DirectionDayBlock({
  date,
  tickets,
  defaultOpen,
  busyId,
  onAct,
}: {
  date: string;
  tickets: PosTicket[];
  defaultOpen: boolean;
  busyId: string | null;
  onAct: (ticket: PosTicket, action: "approve-direction" | "cancel") => void;
}) {
  const openedOnce = useRef(false);
  const total = tickets
    .filter((t) => t.statut !== "annule")
    .reduce((s, t) => s + t.montant, 0);

  return (
    <details
      className="panel jv-day"
      ref={(el) => {
        if (!el || openedOnce.current) return;
        openedOnce.current = true;
        if (defaultOpen) el.open = true;
      }}
    >
      <summary className="jv-day-summary">
        <i className="jv-ico" aria-hidden>
          <svg viewBox="0 0 24 24" focusable="false">
            <path d="M4 6h16v14H4V6Zm0 5h16M8 3v4M16 3v4" />
          </svg>
        </i>
        <span className="jv-day-title">
          <strong>{formatDateLong(date)}</strong>
          <span>
            {tickets.length} ticket{tickets.length > 1 ? "s" : ""}
          </span>
        </span>
        <strong className="jv-day-total mono">{formatFcfa(total)}</strong>
      </summary>

      <div className="jv-tickets">
        <div className="jv-ticket-head" aria-hidden>
          <span>Heure</span>
          <span>N° ticket</span>
          <span>Saisi par</span>
          <span>Produits / détails</span>
          <span />
          <span className="is-num">Montant</span>
          <span>Statut</span>
          <span />
        </div>
        {tickets.map((t) => (
          <DirectionTicketCard key={t.id} ticket={t} busyId={busyId} onAct={onAct} />
        ))}
      </div>
    </details>
  );
}

function DirectionTicketCard({
  ticket,
  busyId,
  onAct,
}: {
  ticket: PosTicket;
  busyId: string | null;
  onAct: (ticket: PosTicket, action: "approve-direction" | "cancel") => void;
}) {
  const v = visuel(ticket.statut);
  const first = ticket.lines[0];
  const meta = [
    siteLabel(ticket.site),
    ticket.validatedByName ? `Validée par ${ticket.validatedByName}` : null,
    ticket.paymentLabel,
    ticket.saleType,
  ]
    .filter(Boolean)
    .join(" · ");
  const busy = busyId === ticket.id;

  return (
    <details className={`jv-ticket jv-ticket-${v}`}>
      <summary className="jv-ticket-summary">
        <span className="jv-ticket-time">{ticket.at.slice(11, 16)}</span>
        <strong className="jv-ticket-num mono">{ticket.numero}</strong>
        <span className="jv-ticket-client">
          <i className="jv-ticket-avatar" aria-hidden>
            <svg viewBox="0 0 24 24" focusable="false">
              <path d="M12 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-7 9c0-3.3 3-5.5 7-5.5s7 2.2 7 5.5" />
            </svg>
          </i>
          <span className="jv-ticket-id">
            <strong>{ticket.userName}</strong>
            {meta ? <span className="jv-ticket-meta">{meta}</span> : null}
          </span>
        </span>
        <span className="jv-ticket-products">
          <strong>{first?.name ?? "—"}</strong>
          {ticket.lines.length > 1 ? (
            <span>
              {ticket.lines
                .slice(1)
                .map((l) => `+ ${l.name}`)
                .join(" ")}
            </span>
          ) : null}
        </span>
        <span className="jv-ticket-qty mono">
          x {ticket.lines.reduce((n, l) => n + l.qty, 0)}
        </span>
        <strong className="jv-ticket-amount mono">{formatFcfa(ticket.montant)}</strong>
        <span className={`hist-statut hist-statut-${v}`}>
          {STATUT_LABELS[ticket.statut] ?? ticket.statut}
        </span>
        <span className="jv-ticket-more" aria-hidden>
          ⋮
        </span>
      </summary>
      <div className="jv-ticket-body">
        <ul className="jv-ticket-lines">
          {ticket.lines.map((l, i) => (
            <li key={`${ticket.id}-${l.venteLogId ?? i}`}>
              <span className="jv-dot" />
              <span className="jv-line-name">
                <strong>{l.name}</strong>
                <span className="muted">
                  {l.qty} × {formatFcfa(l.unitPrice)}
                </span>
              </span>
              <strong className="mono">{formatFcfa(l.amount)}</strong>
              <span className="jv-line-acts" />
            </li>
          ))}
        </ul>
        <div className="jv-ticket-actions">
          {ticket.statut === "en_attente" ? (
            <>
              <button
                type="button"
                className="btn btn-primary jv-act"
                disabled={busy}
                onClick={() => onAct(ticket, "approve-direction")}
              >
                {busy ? "…" : "Valider"}
              </button>
              <button
                type="button"
                className="btn btn-ghost jv-act"
                disabled={busy}
                onClick={() => onAct(ticket, "cancel")}
              >
                Refuser
              </button>
            </>
          ) : ticket.statut === "direction_validee" ? (
            <button
              type="button"
              className="btn btn-ghost jv-act"
              disabled={busy}
              onClick={() => onAct(ticket, "cancel")}
            >
              {busy ? "…" : "Annuler"}
            </button>
          ) : null}
        </div>
      </div>
    </details>
  );
}
