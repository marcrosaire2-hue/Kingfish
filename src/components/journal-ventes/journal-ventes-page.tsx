"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { AppShell } from "@/components/app-shell";
import { BrandLoader } from "@/components/brand-loader";
import { DashboardShell } from "@/components/dashboard/dashboard-layout";
import { ExportExcelButton } from "@/components/export-excel-button";
import { RegistreDrawer } from "@/components/registre-drawer";
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
import { useSession } from "@/components/session-provider";
import type { UserRole } from "@/lib/auth-types";
import {
  venteActionEnabled,
  type SiteRolesConfig,
} from "@/lib/site-roles-model";
import type { VenteSite } from "@/lib/types";
import "./journal-ventes-page.css";

type SiteFilter = "all" | "zogbo" | "gbegamey";
type StatutFilter = "all" | "valide" | "annule" | "encours";
type SourceFilter = "all" | "kingfish" | "aquapro";
type PeriodPreset = "today" | "week" | "month" | "custom";
type JournalView = "tickets" | "categories";
type VenteCategory = "plat" | "accompagnement" | "boisson" | "autre";

type TicketGroup = {
  key: string;
  at: string;
  date: string;
  numero: string;
  site: string;
  statut: JournalVenteLine["statut"];
  statutLabel: string;
  source: JournalVenteLine["source"];
  typeVente: string;
  serveur: string | null;
  caissier: string | null;
  paiement: string | null;
  client: string | null;
  table: string | null;
  ticketId: string | null;
  montant: number;
  lines: JournalVenteLine[];
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

type CatalogItem = { id: string; name: string };
type VenteCatalog = {
  plat: CatalogItem[];
  local: CatalogItem[];
  boisson: CatalogItem[];
};

type EditForm = {
  date: string;
  time: string;
  productId: string;
  qty: string;
  unitPrice: string;
  description: string;
  reason: string;
};

function isoToLocalParts(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-CA", { timeZone: "Africa/Porto-Novo" });
  const time = d.toLocaleTimeString("fr-FR", {
    timeZone: "Africa/Porto-Novo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return { date, time };
}

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
  if (value === "all" || value === "zogbo" || value === "gbegamey") {
    return value;
  }
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

function siteLabel(site: string): string {
  if (site === "zogbo") return "Zogbo";
  if (site === "gbegamey") return "Gbégamey";
  return "—";
}

function venteCategory(kind?: string): VenteCategory {
  if (kind === "plat" || kind === "combo") return "plat";
  if (kind === "local") return "accompagnement";
  if (kind === "boisson") return "boisson";
  return "autre";
}

const CATEGORY_LABELS: Record<VenteCategory, string> = {
  plat: "Plats",
  accompagnement: "Accompagnements",
  boisson: "Boissons",
  autre: "Autres",
};

const CATEGORIES: VenteCategory[] = [
  "plat",
  "accompagnement",
  "boisson",
  "autre",
];

function sumCategoryLines(
  lines: JournalVenteLine[],
  category: VenteCategory,
): { qty: number; montant: number; lignes: number } {
  let qty = 0;
  let montant = 0;
  let lignes = 0;
  for (const l of lines) {
    if (l.statut !== "valide") continue;
    if (venteCategory(l.kind) !== category) continue;
    qty += l.qty;
    montant += l.montant;
    lignes += 1;
  }
  return { qty, montant, lignes };
}

function ticketKey(line: JournalVenteLine): string {
  if (line.ticketId) return line.ticketId;
  return `${line.numero}::${line.site}::${line.at}`;
}

function groupByTicket(lines: JournalVenteLine[]): TicketGroup[] {
  const map = new Map<string, TicketGroup>();
  for (const l of lines) {
    const key = ticketKey(l);
    let g = map.get(key);
    if (!g) {
      g = {
        key,
        at: l.at,
        date: l.date,
        numero: l.numero,
        site: l.site,
        statut: l.statut,
        statutLabel: l.statutLabel,
        source: l.source,
        typeVente: l.typeVente,
        serveur: l.serveur,
        caissier: l.caissier,
        paiement: l.paiement,
        client: l.client,
        table: l.table,
        ticketId: l.ticketId,
        montant: 0,
        lines: [],
      };
      map.set(key, g);
    }
    g.lines.push(l);
    g.montant += l.montant;
  }
  // Heure la plus récente en premier.
  return [...map.values()].sort((a, b) =>
    a.at === b.at ? a.numero.localeCompare(b.numero) : a.at < b.at ? 1 : -1,
  );
}

function useDebouncedValue<T>(value: T, delayMs = 280): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

const EMPTY_RESULT: JournalVenteResult = {
  days: [],
  totals: { count: 0, montant: 0, valide: 0, annule: 0, encours: 0 },
  facets: { serveurs: [], paiements: [] },
};

const PERIODS: { id: PeriodPreset; label: string }[] = [
  { id: "today", label: "Aujourd’hui" },
  { id: "week", label: "7 jours" },
  { id: "month", label: "Mois" },
];

type JournalVentesPageProps = {
  initialFrom?: string;
  initialTo?: string;
  initialSite?: string;
};

export function JournalVentesPage({
  initialFrom,
  initialTo,
  initialSite,
}: JournalVentesPageProps) {
  const { user: sessionUser } = useSession();
  const today = todayIsoDate();
  const startFrom = parseIsoDate(initialFrom) ?? monthStartIso(today);
  const startTo = parseIsoDate(initialTo) ?? today;
  const startSite = parseSite(initialSite) ?? "all";

  const [from, setFrom] = useState(startFrom);
  const [to, setTo] = useState(startTo);
  const [site, setSite] = useState<SiteFilter>(startSite);
  const [statut, setStatut] = useState<StatutFilter>("valide");
  const [source, setSource] = useState<SourceFilter>("all");
  const [serveur, setServeur] = useState("");
  const [paiement, setPaiement] = useState("");
  const [qInput, setQInput] = useState("");
  const q = useDebouncedValue(qInput);
  const [view, setView] = useState<JournalView>("tickets");
  const [categoryFocus, setCategoryFocus] = useState<VenteCategory | "all">(
    "all",
  );
  const [lockedSite, setLockedSite] = useState(false);
  const [allowedSites, setAllowedSites] = useState<("zogbo" | "gbegamey")[]>([
    "zogbo",
    "gbegamey",
  ]);
  const [result, setResult] = useState<JournalVenteResult>(EMPTY_RESULT);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busyTicketId, setBusyTicketId] = useState<string | null>(null);
  const [busyLineId, setBusyLineId] = useState<string | null>(null);
  const [canManagePast, setCanManagePast] = useState(false);
  const [canPurge, setCanPurge] = useState(false);
  const [canEditFull, setCanEditFull] = useState(false);
  const [catalog, setCatalog] = useState<VenteCatalog | null>(null);
  const [sitePolicies, setSitePolicies] = useState<SiteRolesConfig | null>(
    null,
  );
  const [editing, setEditing] = useState<JournalVenteLine | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

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
        setLockedSite(body.lockedSite);
        if (body.site && body.site !== "all") {
          setSite(body.site as SiteFilter);
        }
      }
      if (Array.isArray(body.allowedSites) && body.allowedSites.length > 0) {
        setAllowedSites(body.allowedSites);
      }
      setCanManagePast(!!body.canManagePast);
      setCanPurge(!!body.canPurge);
      setCanEditFull(!!body.canEditFull);
      if (body.catalog) setCatalog(body.catalog as VenteCatalog);
      if (body.sitePolicies) {
        setSitePolicies(body.sitePolicies as SiteRolesConfig);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement");
      setResult(EMPTY_RESULT);
    } finally {
      setLoading(false);
    }
  }, [from, to, site, statut, source, serveur, paiement, q]);

  const allLines = useMemo(
    () => result.days.flatMap((d) => d.lines),
    [result.days],
  );

  const categoryTotals = useMemo(
    () =>
      CATEGORIES.map((cat) => ({
        cat,
        label: CATEGORY_LABELS[cat],
        ...sumCategoryLines(allLines, cat),
      })),
    [allLines],
  );

  const mixTotal = categoryTotals.reduce((s, c) => s + c.montant, 0);
  const panierMoyen =
    result.totals.valide > 0
      ? Math.round(result.totals.montant / result.totals.valide)
      : 0;

  const extraFilterCount = Number(source !== "all") + Number(!!serveur) + Number(!!paiement);

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
      setError(
        "Quantité invalide (minimum 1). Pour supprimer, utilisez Suppr.",
      );
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

  function ouvrirEdition(l: JournalVenteLine) {
    if (!l.venteLogId) return;
    const { time } = isoToLocalParts(l.at);
    setEditError(null);
    setEditing(l);
    setEditForm({
      date: l.date,
      time,
      productId: l.productId || "",
      qty: String(Math.abs(l.qty)),
      unitPrice: String(l.unitPrice),
      description: l.produit,
      reason: "",
    });
  }

  function fermerEdition() {
    setEditing(null);
    setEditForm(null);
    setEditError(null);
  }

  async function enregistrerEdition(e: FormEvent) {
    e.preventDefault();
    if (!editing || !editForm || !editing.venteLogId) return;
    const qty = Number(editForm.qty);
    if (!Number.isFinite(qty) || qty < 1) {
      setEditError("Quantité invalide (minimum 1).");
      return;
    }
    if (editForm.reason.trim().length < 8) {
      setEditError("Motif d'audit requis (8 caractères minimum).");
      return;
    }
    setEditBusy(true);
    setEditError(null);
    try {
      const payload: Record<string, unknown> = {
        action: "edit-full",
        id: editing.venteLogId,
        date: editing.date,
        site: editing.site,
        newDate: editForm.date,
        newTime: editForm.time,
        qty,
        reason: editForm.reason.trim(),
      };
      if (editing.kind === "extra") {
        payload.description = editForm.description;
        payload.unitPrice = Number(editForm.unitPrice) || 0;
      } else if (editForm.productId) {
        payload.productId = editForm.productId;
      }
      const res = await fetch("/api/vente", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Modification impossible");
      setFlash(
        `Vente « ${body.entry?.name ?? editing.produit} » modifiée avec précision`,
      );
      fermerEdition();
      await load();
    } catch (err) {
      setEditError(
        err instanceof Error ? err.message : "Modification impossible",
      );
    } finally {
      setEditBusy(false);
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
    const motif = window.prompt(
      "Motif de la suppression (obligatoire, 8 caractères minimum) :",
    );
    if (motif === null) return;
    if (motif.trim().length < 8) {
      setError("Motif d'audit requis (au moins 8 caractères).");
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
          reason: motif.trim(),
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
    const motif = window.prompt(
      "Motif de la suppression (obligatoire, 8 caractères minimum) :",
    );
    if (motif === null) return;
    if (motif.trim().length < 8) {
      setError("Motif d'audit requis (au moins 8 caractères).");
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
          reason: motif.trim(),
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

  const editCatalogOptions = useMemo<CatalogItem[]>(() => {
    if (!editing || !editForm || !catalog) return [];
    const kind = editing.kind;
    if (kind !== "plat" && kind !== "local" && kind !== "boisson") return [];
    const list = catalog[kind] ?? [];
    if (
      editForm.productId &&
      !list.some((p) => p.id === editForm.productId)
    ) {
      return [
        { id: editForm.productId, name: `${editing.produit} (actuel)` },
        ...list,
      ];
    }
    return list;
  }, [editing, editForm, catalog]);

  const periodHint =
    from === to
      ? formatDateLong(from)
      : `${formatDateShort(from)} → ${formatDateShort(to)}`;

  const pageSubtitle = lockedSite && site !== "all"
    ? `Tickets et articles · ${siteLabel(site)}`
    : "Tickets POS, journal et importés — lecture chronologique.";

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
      title="Journal des ventes"
      subtitle={pageSubtitle}
      mainClassName="main-journal-ventes"
    >
      <DashboardShell className="jv-page">
        <header className="jv-banner">
          <span className="jv-banner-ico" aria-hidden>
            <svg viewBox="0 0 24 24" focusable="false">
              <path d="M4 5h2l2 10h9l2-7H7M10 19.5h.01M16 19.5h.01" />
            </svg>
          </span>
          <div className="jv-banner-copy">
            <h2>Journal des ventes</h2>
            <p>{pageSubtitle}</p>
          </div>
          <div className="jv-banner-side">
            {!canManagePast && !canPurge && !canEditFull ? (
              <span className="jv-readonly">
                <svg viewBox="0 0 24 24" aria-hidden focusable="false">
                  <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Zm9.5 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
                </svg>
                Lecture seule
              </span>
            ) : null}
          </div>
          <svg className="jv-banner-art" viewBox="0 0 120 80" aria-hidden focusable="false">
            <rect x="14" y="48" width="16" height="26" rx="3" fill="#1d6fd6" />
            <rect x="40" y="34" width="16" height="40" rx="3" fill="#2a7ec8" />
            <rect x="66" y="20" width="16" height="54" rx="3" fill="#075ea8" />
            <path d="M12 38 44 20l22 8 36-22" fill="none" stroke="#f5b400" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
            <path d="m92 4 12 2-4 11" fill="none" stroke="#f5b400" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </header>

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
            <label className="jv-search">
              <span className="sr-only">Recherche</span>
              <svg className="jv-search-ico" viewBox="0 0 24 24" aria-hidden focusable="false">
                <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm9 16-4-4" />
              </svg>
              <input
                type="search"
                placeholder="N° ticket, produit, client…"
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
              />
            </label>
          </div>

          <div className="jv-toolbar-row">
            {lockedSite ? (
              <span className="jv-lock-pill">{siteLabel(site)}</span>
            ) : (
              <div className="jv-seg" role="tablist" aria-label="Site">
                {siteOptions.map(([value, label]) => (
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
            )}
            <div className="jv-seg" role="tablist" aria-label="Statut">
              {(
                [
                  ["valide", "Validé"],
                  ["all", "Tous"],
                  ["annule", "Annulé"],
                  ["encours", "En cours"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={statut === value}
                  className={`jv-seg-btn jv-statut-${value}${statut === value ? " is-active" : ""}`}
                  onClick={() => setStatut(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="jv-toolbar-actions">
          <ExportExcelButton
            label="Excel (par jour)"
            onExport={() => void exportJournal()}
            disabled={loading || exporting || result.totals.count === 0}
          />
          <ExportExcelButton
            label="Excel (articles)"
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
            </div>
            <details className="jv-more">
              <summary>
                <svg viewBox="0 0 24 24" aria-hidden focusable="false">
                  <path d="M4 5h16l-6 8v6l-4-2v-4L4 5Z" />
                </svg>
                Plus de filtres
                {extraFilterCount > 0 ? (
                  <span className="jv-more-count">{extraFilterCount}</span>
                ) : null}
              </summary>
              <div className="jv-more-body">
                <label className="date-field date-field-pill">
                  <span>Source</span>
                  <select
                    className="select-input"
                    value={source}
                    onChange={(e) =>
                      setSource(e.target.value as SourceFilter)
                    }
                  >
                    <option value="all">Toutes</option>
                    <option value="kingfish">King Fish</option>
                    <option value="aquapro">Importé</option>
                  </select>
                </label>
                <label className="date-field date-field-pill">
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
                <label className="date-field date-field-pill">
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
              </div>
            </details>
          </div>
        </section>

        <section className="jv-hero" aria-label="Synthèse de la période">
          <div className="jv-hero-ca">
            <div className="jv-hero-top">
              <i className="jv-ico jv-ico-blue" aria-hidden>
                <svg viewBox="0 0 24 24" focusable="false"><path d="M5 5h14v14H5V5Zm3 4h8M8 13h3m2 0h3M8 16h3m2 0h3" /></svg>
              </i>
              <span className="jv-kicker">CA filtré (validé)</span>
            </div>
            <strong className="jv-hero-value mono">
              {formatFcfa(result.totals.montant)}
            </strong>
            <ul className="jv-hero-facts">
              <li>
                <svg viewBox="0 0 24 24" aria-hidden focusable="false"><path d="M4 6h16v14H4V6Zm0 5h16M8 3v4M16 3v4" /></svg>
                {periodHint}
              </li>
              <li>
                <svg viewBox="0 0 24 24" aria-hidden focusable="false"><path d="M4 8h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4V8Zm10 0v10" /></svg>
                {result.totals.count} ticket{result.totals.count > 1 ? "s" : ""} · {result.days.length} jour{result.days.length > 1 ? "s" : ""}
              </li>
              {panierMoyen > 0 ? (
                <li>
                  <svg viewBox="0 0 24 24" aria-hidden focusable="false"><path d="M12 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-7 9c0-3.3 3-5.5 7-5.5s7 2.2 7 5.5" /></svg>
                  Panier moyen {formatFcfa(panierMoyen)}
                </li>
              ) : null}
            </ul>
            <svg className="jv-hero-art" viewBox="0 0 90 60" aria-hidden focusable="false">
              <rect x="6" y="38" width="14" height="20" rx="3" fill="#bcd6ee" />
              <rect x="28" y="26" width="14" height="32" rx="3" fill="#8dbcf0" />
              <rect x="50" y="12" width="14" height="46" rx="3" fill="#5a9be0" />
            </svg>
          </div>
          <div className="jv-hero-side">
            <div className="jv-kpis">
              {(
                [
                  ["valide", "Validé", result.totals.valide],
                  ["annule", "Annulé", result.totals.annule],
                  ["encours", "En cours", result.totals.encours],
                ] as const
              ).map(([tone, label, n]) => {
                const pct = (result.totals.valide + result.totals.annule + result.totals.encours) > 0 ? Math.round((n / (result.totals.valide + result.totals.annule + result.totals.encours)) * 100) : 0;
                return (
                  <div key={tone} className={`jv-kpi is-${tone}`}>
                    <i className="jv-ico" aria-hidden>
                      <svg viewBox="0 0 24 24" focusable="false">
                        {tone === "valide" ? (
                          <path d="m5 12.5 4.5 4.5L19 7.5" />
                        ) : tone === "annule" ? (
                          <path d="m6 6 12 12M18 6 6 18" />
                        ) : (
                          <path d="M12 7v5l3 2" />
                        )}
                      </svg>
                    </i>
                    <span>{label}</span>
                    <strong className="mono">{n}</strong>
                    <em>{pct}%</em>
                    <b className="jv-kpi-bar" aria-hidden>
                      <u style={{ width: `${pct}%` }} />
                    </b>
                  </div>
                );
              })}
            </div>
            <div className="jv-mix" aria-label="Répartition par catégorie">
              <div className="jv-mix-bar" aria-hidden>
                {categoryTotals.map((c) =>
                  c.montant > 0 && mixTotal > 0 ? (
                    <span
                      key={c.cat}
                      className={`jv-mix-seg jv-mix-${c.cat}`}
                      style={{ width: `${(c.montant / mixTotal) * 100}%` }}
                    />
                  ) : null,
                )}
              </div>
              <div className="jv-mix-chips" role="tablist" aria-label="Catégorie">
                <button
                  type="button"
                  className={`jv-mix-chip jv-mix-chip-all${categoryFocus === "all" ? " is-active" : ""}`}
                  onClick={() => setCategoryFocus("all")}
                >
                  Tout
                </button>
                {categoryTotals.map((c) => (
                  <button
                    key={c.cat}
                    type="button"
                    className={`jv-mix-chip jv-mix-chip-${c.cat}${categoryFocus === c.cat ? " is-active" : ""}`}
                    onClick={() =>
                      setCategoryFocus(categoryFocus === c.cat ? "all" : c.cat)
                    }
                    disabled={c.lignes === 0}
                  >
                    <i className="jv-ico" aria-hidden>
                      <CatIcon cat={c.cat} />
                    </i>
                    <span>{c.label}</span>
                    <strong className="mono">{formatFcfa(c.montant)}</strong>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <div className="jv-viewbar">
          <div className="jv-seg" role="tablist" aria-label="Présentation">
            <button
              type="button"
              role="tab"
              aria-selected={view === "tickets"}
              className={`jv-seg-btn${view === "tickets" ? " is-active" : ""}`}
              onClick={() => setView("tickets")}
            >
              Par ticket
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "categories"}
              className={`jv-seg-btn${view === "categories" ? " is-active" : ""}`}
              onClick={() => setView("categories")}
            >
              Par catégorie
            </button>
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

        {loading && result.days.length === 0 ? (
          <BrandLoader label="Chargement du journal…" />
        ) : null}

        {!loading && !result.days.length ? (
          <div className="panel jv-empty">
            <strong>Aucune vente pour ces filtres.</strong>
            <p className="muted">
              Changez la période, le site ou le statut pour afficher le journal.
            </p>
          </div>
        ) : null}

        <div className={loading && result.days.length > 0 ? "jv-feed is-loading" : "jv-feed"}>
          {result.days.map((day, index) => (
            <JournalDayBlock
              key={day.date}
              day={day}
              site={site}
              defaultOpen={index < 3}
              view={view}
              categoryFocus={categoryFocus}
              hideSiteColumn={lockedSite}
              busyTicketId={busyTicketId}
              busyLineId={busyLineId}
              canManagePast={canManagePast}
              canPurge={canPurge}
              canEditFull={canEditFull}
              sitePolicies={sitePolicies}
              userRole={sessionUser?.role}
              onCancel={(l) => void annulerTicket(l)}
              onEdit={(l) => void modifierLigne(l)}
              onEditFull={ouvrirEdition}
              onDeleteLine={(l) => void supprimerLigne(l)}
              onDeleteTicket={(l) => void supprimerTicket(l)}
            />
          ))}
        </div>
      </DashboardShell>

      <RegistreDrawer
        open={!!editing}
        onClose={fermerEdition}
        title="Modifier une vente"
        subtitle={
          editing
            ? `${editing.produit} · ${siteLabel(editing.site)} · ${editing.numero}`
            : undefined
        }
        closeLabel="Fermer la modification de vente"
      >
        {editing && editForm ? (
          <form className="admin-form" onSubmit={enregistrerEdition}>
            {editError ? (
              <p className="error-banner" role="alert">
                {editError}
              </p>
            ) : null}
            <div className="admin-form-grid admin-form-grid-compact">
              <label className="admin-field">
                <span>Jour</span>
                <input
                  type="date"
                  value={editForm.date}
                  onChange={(e) =>
                    setEditForm((f) => (f ? { ...f, date: e.target.value } : f))
                  }
                  required
                />
              </label>
              <label className="admin-field">
                <span>Heure précise</span>
                <input
                  type="time"
                  value={editForm.time}
                  onChange={(e) =>
                    setEditForm((f) => (f ? { ...f, time: e.target.value } : f))
                  }
                  required
                />
              </label>
              {editing.kind && editing.kind !== "extra" ? (
                <label className="admin-field admin-field-full">
                  <span>Produit</span>
                  <select
                    className="select-input"
                    value={editForm.productId}
                    onChange={(e) =>
                      setEditForm((f) =>
                        f ? { ...f, productId: e.target.value } : f,
                      )
                    }
                  >
                    {editCatalogOptions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <>
                  <label className="admin-field admin-field-full">
                    <span>Libellé</span>
                    <input
                      value={editForm.description}
                      onChange={(e) =>
                        setEditForm((f) =>
                          f ? { ...f, description: e.target.value } : f,
                        )
                      }
                    />
                  </label>
                  <label className="admin-field">
                    <span>Prix unitaire (FCFA)</span>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={editForm.unitPrice}
                      onChange={(e) =>
                        setEditForm((f) =>
                          f ? { ...f, unitPrice: e.target.value } : f,
                        )
                      }
                    />
                  </label>
                </>
              )}
              <label className="admin-field">
                <span>Quantité</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={editForm.qty}
                  onChange={(e) =>
                    setEditForm((f) => (f ? { ...f, qty: e.target.value } : f))
                  }
                  required
                />
              </label>
              <label className="admin-field admin-field-full">
                <span>Motif de la correction</span>
                <input
                  value={editForm.reason}
                  onChange={(e) =>
                    setEditForm((f) => (f ? { ...f, reason: e.target.value } : f))
                  }
                  placeholder="ex. Erreur de saisie caisse, corrigé à la demande de…"
                  minLength={8}
                  required
                />
              </label>
            </div>
            <p className="muted">
              Correction admin : stock, montant et journal sont recalculés.
              Si le jour ou le produit changent, le ticket POS d&apos;origine
              n&apos;est plus lié à cette ligne — la vente reste tracée dans
              le journal, comme les ventes carnet et AquaPro.
            </p>
            <div className="equipe-create-actions">
              <button type="submit" className="btn btn-primary" disabled={editBusy}>
                {editBusy ? "Enregistrement…" : "Enregistrer la correction"}
              </button>
            </div>
          </form>
        ) : null}
      </RegistreDrawer>
    </AppShell>
  );
}

function CatIcon({ cat }: { cat: VenteCategory }) {
  const d =
    cat === "plat"
      ? "M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 3c-2 2-2.5 5-2.5 8h2.5v10"
      : cat === "accompagnement"
        ? "M4 12h16a8 8 0 0 1-16 0Zm4-4c0-2 2-2 2-4m4 4c0-2 2-2 2-4"
        : cat === "boisson"
          ? "M6 6h12l-1.5 14h-9L6 6Zm2-3h8M7 11h10"
          : "M6 12h.01M12 12h.01M18 12h.01";
  return (
    <svg viewBox="0 0 24 24" focusable="false">
      <path d={d} />
    </svg>
  );
}

function JournalDayBlock({
  day,
  site,
  defaultOpen,
  view,
  categoryFocus,
  hideSiteColumn,
  busyTicketId,
  busyLineId,
  canManagePast,
  canPurge,
  canEditFull,
  sitePolicies,
  userRole,
  onCancel,
  onEdit,
  onEditFull,
  onDeleteLine,
  onDeleteTicket,
}: {
  day: JournalVenteDay;
  site: string;
  defaultOpen: boolean;
  view: JournalView;
  categoryFocus: VenteCategory | "all";
  hideSiteColumn: boolean;
  busyTicketId: string | null;
  busyLineId: string | null;
  canManagePast: boolean;
  canPurge: boolean;
  canEditFull: boolean;
  sitePolicies: SiteRolesConfig | null;
  userRole?: UserRole;
  onCancel: (line: JournalVenteLine) => void;
  onEdit: (line: JournalVenteLine) => void;
  onEditFull: (line: JournalVenteLine) => void;
  onDeleteLine: (line: JournalVenteLine) => void;
  onDeleteTicket: (line: JournalVenteLine) => void;
}) {
  const openedOnce = useRef(false);
  const focusedLines =
    categoryFocus === "all"
      ? day.lines
      : day.lines.filter((l) => venteCategory(l.kind) === categoryFocus);

  if (focusedLines.length === 0) return null;

  const tickets = groupByTicket(focusedLines);
  const byCategory = CATEGORIES.map((cat) => {
    const lines = focusedLines.filter((l) => venteCategory(l.kind) === cat);
    return {
      cat,
      label: CATEGORY_LABELS[cat],
      lines,
    };
  }).filter((c) => c.lines.length > 0);

  const dayMontant =
    categoryFocus === "all"
      ? day.montant
      : focusedLines.reduce(
          (s, l) => (l.statut === "valide" ? s + l.montant : s),
          0,
        );

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
          <svg viewBox="0 0 24 24" focusable="false"><path d="M4 6h16v14H4V6Zm0 5h16M8 3v4M16 3v4" /></svg>
        </i>
        <span className="jv-day-title">
          <strong>{formatDateLong(day.date)}</strong>
          <span>
            {tickets.length} ticket{tickets.length > 1 ? "s" : ""} ·{" "}
            {focusedLines.length} ligne{focusedLines.length > 1 ? "s" : ""}
          </span>
        </span>
        <strong className="jv-day-total mono">{formatFcfa(dayMontant)}</strong>
        <button
          type="button"
          className="btn btn-ghost"
          title={`Exporter le ${day.date} en Excel`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            try {
              exportJournalVentesExcel({
                days: [day],
                totals: {
                  count: day.nbTickets,
                  montant: day.montant,
                  valide: day.nbTickets,
                  annule: 0,
                  encours: 0,
                },
                from: day.date,
                to: day.date,
                site,
              });
            } catch {
              /* export indisponible */
            }
          }}
        >
          Excel
        </button>
      </summary>

      {view === "tickets" ? (
        <div className="jv-tickets">
          <div className="jv-ticket-head" aria-hidden>
            <span>Heure</span>
            <span>N° ticket</span>
            <span>Client</span>
            <span>Produits / détails</span>
            <span />
            <span className="is-num">Montant</span>
            <span>Statut</span>
            <span />
          </div>
          {tickets.map((ticket) => (
            <JournalTicketCard
              key={ticket.key}
              ticket={ticket}
              hideSite={hideSiteColumn}
              busyTicketId={busyTicketId}
              busyLineId={busyLineId}
              canManagePast={canManagePast}
              canPurge={canPurge}
              canEditFull={canEditFull}
              sitePolicies={sitePolicies}
              userRole={userRole}
              onCancel={onCancel}
              onEdit={onEdit}
              onEditFull={onEditFull}
              onDeleteLine={onDeleteLine}
              onDeleteTicket={onDeleteTicket}
            />
          ))}
        </div>
      ) : (
        <div className="jv-cats">
          {byCategory.map((c) => (
            <JournalLinesTable
              key={c.cat}
              category={c.cat}
              title={c.label}
              lines={c.lines}
              hideSiteColumn={hideSiteColumn}
              busyTicketId={busyTicketId}
              busyLineId={busyLineId}
              canManagePast={canManagePast}
              canPurge={canPurge}
              canEditFull={canEditFull}
              sitePolicies={sitePolicies}
              userRole={userRole}
              onCancel={onCancel}
              onEdit={onEdit}
              onEditFull={onEditFull}
              onDeleteLine={onDeleteLine}
              onDeleteTicket={onDeleteTicket}
            />
          ))}
        </div>
      )}
    </details>
  );
}

function JournalTicketCard({
  ticket,
  hideSite,
  busyTicketId,
  busyLineId,
  canManagePast,
  canPurge,
  canEditFull,
  sitePolicies,
  userRole,
  onCancel,
  onEdit,
  onEditFull,
  onDeleteLine,
  onDeleteTicket,
}: {
  ticket: TicketGroup;
  hideSite: boolean;
  busyTicketId: string | null;
  busyLineId: string | null;
  canManagePast: boolean;
  canPurge: boolean;
  canEditFull: boolean;
  sitePolicies: SiteRolesConfig | null;
  userRole?: UserRole;
  onCancel: (line: JournalVenteLine) => void;
  onEdit: (line: JournalVenteLine) => void;
  onEditFull: (line: JournalVenteLine) => void;
  onDeleteLine: (line: JournalVenteLine) => void;
  onDeleteTicket: (line: JournalVenteLine) => void;
}) {
  const first = ticket.lines[0];
  const enregistrePar = ticket.caissier || ticket.serveur || null;
  const serveurDistinct =
    ticket.serveur &&
    ticket.caissier &&
    ticket.serveur !== ticket.caissier
      ? ticket.serveur
      : null;

  const metaRest = [
    hideSite ? null : siteLabel(ticket.site),
    ticket.table ? `Table ${ticket.table}` : null,
    serveurDistinct,
    enregistrePar ? `Enregistré par ${enregistrePar}` : null,
    ticket.paiement,
    ticket.typeVente,
    ticket.source === "aquapro" ? "Importé" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <details className={`jv-ticket jv-ticket-${ticket.statut}`}>
      <summary className="jv-ticket-summary">
        <span className="jv-ticket-time">{formatHeureOnly(ticket.at)}</span>
        <strong className="jv-ticket-num mono">{ticket.numero}</strong>
        <span className="jv-ticket-client">
          <i className="jv-ticket-avatar" aria-hidden>
            <svg viewBox="0 0 24 24" focusable="false"><path d="M12 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-7 9c0-3.3 3-5.5 7-5.5s7 2.2 7 5.5" /></svg>
          </i>
          <span className="jv-ticket-id">
            <strong>{ticket.client || siteLabel(ticket.site)}</strong>
            {metaRest ? <span className="jv-ticket-meta">{metaRest}</span> : null}
          </span>
        </span>
        <span className="jv-ticket-products">
          <strong>{first.produit}</strong>
          {ticket.lines.length > 1 ? (
            <span>
              {ticket.lines
                .slice(1)
                .map((l) => `+ ${l.produit}`)
                .join(" ")}
            </span>
          ) : null}
        </span>
        <span className="jv-ticket-qty mono">
          x {ticket.lines.reduce((n, l) => n + l.qty, 0)}
        </span>
        <strong className="jv-ticket-amount mono">
          {formatFcfa(ticket.montant)}
        </strong>
        <span className={`hist-statut hist-statut-${ticket.statut}`}>
          {ticket.statutLabel}
        </span>
        <span className="jv-ticket-more" aria-hidden>
          ⋮
        </span>
      </summary>
      <div className="jv-ticket-body">
        <ul className="jv-ticket-lines">
          {ticket.lines.map((l, i) => (
            <li key={`${ticket.key}-${l.venteLogId ?? i}`}>
              <span className={`jv-dot jv-dot-${venteCategory(l.kind)}`} />
              <span className="jv-line-name">
                <strong>{l.produit}</strong>
                <span className="muted">
                  {l.qty} × {formatFcfa(l.unitPrice)}
                </span>
              </span>
              <strong className="mono">{formatFcfa(l.montant)}</strong>
              <span className="jv-line-acts">
                {canManagePast &&
                l.statut === "valide" &&
                l.venteLogId &&
                venteActionEnabled(
                  sitePolicies,
                  userRole,
                  l.site as VenteSite,
                  "modify",
                ) ? (
                  <button
                    type="button"
                    className="btn-link"
                    disabled={busyLineId === l.venteLogId}
                    onClick={() => onEdit(l)}
                  >
                    {busyLineId === l.venteLogId ? "…" : "Qté"}
                  </button>
                ) : null}
                {canEditFull && l.venteLogId && l.statut === "valide" ? (
                  <button
                    type="button"
                    className="btn-link"
                    onClick={() => onEditFull(l)}
                  >
                    Modifier
                  </button>
                ) : null}
                {canPurge &&
                l.venteLogId &&
                venteActionEnabled(
                  sitePolicies,
                  userRole,
                  l.site as VenteSite,
                  "delete",
                ) ? (
                  <button
                    type="button"
                    className="btn-link btn-link-danger"
                    disabled={busyLineId === l.venteLogId}
                    onClick={() => onDeleteLine(l)}
                  >
                    Suppr.
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
        <div className="jv-ticket-actions">
          {first &&
          first.statut === "valide" &&
          first.ticketId &&
          venteActionEnabled(
            sitePolicies,
            userRole,
            first.site as VenteSite,
            "cancel",
          ) ? (
            <button
              type="button"
              className="btn btn-ghost jv-act"
              disabled={busyTicketId === first.ticketId}
              onClick={() => onCancel({ ...first, montant: ticket.montant })}
            >
              {busyTicketId === first.ticketId ? "…" : "Annuler le ticket"}
            </button>
          ) : null}
          {first &&
          canPurge &&
          first.ticketId &&
          venteActionEnabled(
            sitePolicies,
            userRole,
            first.site as VenteSite,
            "delete",
          ) ? (
            <button
              type="button"
              className="btn btn-ghost jv-act jv-act-danger"
              disabled={busyTicketId === first.ticketId}
              onClick={() => onDeleteTicket({ ...first, montant: ticket.montant })}
            >
              {busyTicketId === first.ticketId ? "…" : "Supprimer le ticket"}
            </button>
          ) : null}
        </div>
      </div>
    </details>
  );
}

function JournalLinesTable({
  category,
  title,
  lines,
  hideSiteColumn,
  busyTicketId,
  busyLineId,
  canManagePast,
  canPurge,
  canEditFull,
  sitePolicies,
  userRole,
  onCancel,
  onEdit,
  onEditFull,
  onDeleteLine,
  onDeleteTicket,
}: {
  category: VenteCategory;
  title: string;
  lines: JournalVenteLine[];
  hideSiteColumn: boolean;
  busyTicketId: string | null;
  busyLineId: string | null;
  canManagePast: boolean;
  canPurge: boolean;
  canEditFull: boolean;
  sitePolicies: SiteRolesConfig | null;
  userRole?: UserRole;
  onCancel: (line: JournalVenteLine) => void;
  onEdit: (line: JournalVenteLine) => void;
  onEditFull: (line: JournalVenteLine) => void;
  onDeleteLine: (line: JournalVenteLine) => void;
  onDeleteTicket: (line: JournalVenteLine) => void;
}) {
  if (lines.length === 0) return null;

  const total = lines.reduce(
    (s, l) => (l.statut === "valide" ? s + l.montant : s),
    0,
  );
  const totalQty = lines.reduce(
    (s, l) => (l.statut === "valide" ? s + l.qty : s),
    0,
  );
  const labelColSpan = hideSiteColumn ? 3 : 4;

  return (
    <div className={`jv-group jv-group-${category}`}>
      <h3 className="jv-group-title">
        {title}
        <span>
          {totalQty} vendu{totalQty > 1 ? "s" : ""} · {formatFcfa(total)}
        </span>
      </h3>
      <div className="table-scroll">
        <table className="data-table jv-table">
          <thead>
            <tr>
              <th scope="col">Heure</th>
              <th scope="col">Ticket</th>
              {hideSiteColumn ? null : <th scope="col">Site</th>}
              <th scope="col">Produit</th>
              <th scope="col" className="col-money">
                Qté
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
              <tr key={`${category}-${l.date}-${l.at}-${i}`}>
                <td>{formatHeureOnly(l.at)}</td>
                <td className="cell-name">
                  <strong>{l.numero}</strong>
                  {l.client ? (
                    <span className="cell-sub">{l.client}</span>
                  ) : null}
                </td>
                {hideSiteColumn ? null : <td>{siteLabel(l.site)}</td>}
                <td className="cell-name">
                  <strong>{l.produit}</strong>
                </td>
                <td className="mono col-money">{l.qty}</td>
                <td className="mono col-money">{formatFcfa(l.montant)}</td>
                <td>
                  <span className={`hist-statut hist-statut-${l.statut}`}>
                    {l.statutLabel}
                  </span>
                </td>
                <td>
                  <span className="reg-actions">
                    {canManagePast &&
                    l.statut === "valide" &&
                    l.venteLogId &&
                    venteActionEnabled(
                      sitePolicies,
                      userRole,
                      l.site as VenteSite,
                      "modify",
                    ) ? (
                      <button
                        type="button"
                        className="btn-link"
                        disabled={busyLineId === l.venteLogId}
                        onClick={() => onEdit(l)}
                      >
                        {busyLineId === l.venteLogId ? "…" : "Qté"}
                      </button>
                    ) : null}
                    {canEditFull && l.venteLogId && l.statut === "valide" ? (
                      <button
                        type="button"
                        className="btn-link"
                        onClick={() => onEditFull(l)}
                      >
                        Modifier
                      </button>
                    ) : null}
                    {canPurge &&
                    l.venteLogId &&
                    venteActionEnabled(
                      sitePolicies,
                      userRole,
                      l.site as VenteSite,
                      "delete",
                    ) ? (
                      <button
                        type="button"
                        className="btn-link btn-link-danger"
                        disabled={busyLineId === l.venteLogId}
                        onClick={() => onDeleteLine(l)}
                      >
                        Suppr.
                      </button>
                    ) : null}
                    {canPurge &&
                    l.ticketId &&
                    venteActionEnabled(
                      sitePolicies,
                      userRole,
                      l.site as VenteSite,
                      "delete",
                    ) ? (
                      <button
                        type="button"
                        className="btn-link btn-link-danger"
                        disabled={busyTicketId === l.ticketId}
                        onClick={() => onDeleteTicket(l)}
                      >
                        {busyTicketId === l.ticketId ? "…" : "Ticket"}
                      </button>
                    ) : null}
                    {l.statut === "valide" &&
                    l.ticketId &&
                    venteActionEnabled(
                      sitePolicies,
                      userRole,
                      l.site as VenteSite,
                      "cancel",
                    ) ? (
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
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={labelColSpan}>
                Sous-total {title} (validé)
              </th>
              <td className="mono col-money">{totalQty}</td>
              <td className="mono col-money">{formatFcfa(total)}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
