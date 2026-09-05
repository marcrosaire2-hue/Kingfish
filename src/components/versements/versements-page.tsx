"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
} from "react";
import { AppShell } from "@/components/app-shell";
import { BrandLoader } from "@/components/brand-loader";
import { ExportExcelButton } from "@/components/export-excel-button";
import { CataloguePaginationBar } from "@/components/parametres/catalogue-view";
import { useSession } from "@/components/session-provider";
import {
  effectiveSite,
  SITE_LABELS,
  SHIFT_LABELS,
} from "@/lib/auth-types";
import { formatFcfa } from "@/lib/format";
import { exportVersementsExcel } from "@/lib/page-exports";
import {
  VERSEMENT_STATUT_LABELS,
  VERSEMENT_TRANCHE_LABELS,
  type Versement,
  type VersementStatut,
  type VersementTranche,
  type VenteSite,
} from "@/lib/types";
import { todayIsoDate } from "@/lib/zogbo-calc";
import {
  defaultTrancheFromShift,
  MAX_PREUVES,
} from "@/lib/versements-model";
import "./versements-page.css";

type StatutFilter = "all" | VersementStatut;
type SiteFilter = "all" | VenteSite;
type PeriodPreset = "today" | "week" | "month" | "custom";

const PAGE_SIZE = 10;

const TRANCHE_SHORT: Record<VersementTranche, string> = {
  nuit: "Nuit",
  matin: "Matin",
  soir: "Soir",
};

const TRANCHE_HOURS: Record<VersementTranche, string> = {
  nuit: "00h–08h",
  matin: "08h–16h",
  soir: "16h–00h",
};

const PERIODS: { id: PeriodPreset; label: string }[] = [
  { id: "today", label: "Aujourd’hui" },
  { id: "week", label: "7 jours" },
  { id: "month", label: "Mois" },
  { id: "custom", label: "Dates" },
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

function formatDateFr(iso: string): string {
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "medium",
      timeZone: "Africa/Porto-Novo",
    }).format(new Date(`${iso}T12:00:00`));
  } catch {
    return iso;
  }
}

function formatDateHeure(iso: string): string {
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

function nowHeureLocale(): string {
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Africa/Porto-Novo",
    })
      .format(new Date())
      .replace(".", ":");
  } catch {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
}

function normalizeSearch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function useDebouncedValue<T>(value: T, delayMs = 280): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

function paginate<T>(items: T[], page: number, pageSize: number) {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    page: safePage,
    totalPages,
    total,
    from: total === 0 ? 0 : start + 1,
    to: Math.min(start + pageSize, total),
  };
}

function preuvesOf(v: Versement) {
  if (v.preuves?.length) return v.preuves;
  return [
    {
      url: v.preuveUrl || `/api/versements/${v.id}/preuve`,
      mime: v.preuveMime,
      publicId: v.preuvePublicId,
    },
  ];
}

export function VersementsPage() {
  const { user } = useSession();
  const scope = user ? effectiveSite(user.role, user.site) : null;
  const followAll = scope === "tous";
  const isReaderOnly = user?.role === "admin" || user?.role === "daf";
  const formRef = useRef<HTMLElement | null>(null);

  const [declareDate, setDeclareDate] = useState(() => todayIsoDate());
  const [date, setDate] = useState(() => todayIsoDate());
  const [from, setFrom] = useState(() => monthStartIso());
  const [to, setTo] = useState(() => todayIsoDate());
  const [site, setSite] = useState<VenteSite>("zogbo");
  const [filterSite, setFilterSite] = useState<SiteFilter>("all");
  const [canDeclare, setCanDeclare] = useState(false);
  const [canConfirm, setCanConfirm] = useState(false);

  const [heure, setHeure] = useState(() => nowHeureLocale());
  const [tranche, setTranche] = useState<VersementTranche>("matin");
  const [membres, setMembres] = useState<string[]>([""]);
  const [montant, setMontant] = useState("");
  const [numero, setNumero] = useState("");
  const [preuves, setPreuves] = useState<File[]>([]);
  const [preuvePreviews, setPreuvePreviews] = useState<string[]>([]);
  const [dropActive, setDropActive] = useState(false);

  const [versements, setVersements] = useState<Versement[]>([]);
  const [statutFilter, setStatutFilter] = useState<StatutFilter>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Versement | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const debouncedSearch = useDebouncedValue(search);
  const period = inferPeriod(from, to);

  useEffect(() => {
    if (scope === "zogbo" || scope === "gbegamey") setSite(scope);
  }, [scope]);

  useEffect(() => {
    if (user?.shift) setTranche(defaultTrancheFromShift(user.shift));
  }, [user?.shift]);

  const charger = useCallback(async () => {
    if (!scope) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (followAll) {
        params.set("from", from);
        params.set("to", to);
        if (filterSite !== "all") params.set("site", filterSite);
      } else {
        params.set("date", date);
      }
      const res = await fetch(`/api/versements?${params}`, {
        cache: "no-store",
      });
      const body = (await res.json()) as {
        versements?: Versement[];
        canDeclare?: boolean;
        canConfirm?: boolean;
        error?: string;
      };
      if (!res.ok) throw new Error(body.error || "Chargement impossible.");
      setVersements(body.versements ?? []);
      setCanDeclare(body.canDeclare === true);
      setCanConfirm(body.canConfirm === true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, [scope, followAll, from, to, filterSite, date]);

  useEffect(() => {
    void charger();
  }, [charger]);

  useEffect(() => {
    const urls = preuves.map((file) => URL.createObjectURL(file));
    setPreuvePreviews(urls);
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [preuves]);

  useEffect(() => {
    if (!selected) return;
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") setSelected(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  const filtered = useMemo(() => {
    const q = normalizeSearch(debouncedSearch);
    const list = versements.filter((v) => {
      if (statutFilter !== "all" && v.statut !== statutFilter) return false;
      if (!q) return true;
      const blob = [
        v.numeroTransaction,
        v.actorName,
        v.confirmedByName ?? "",
        SITE_LABELS[v.site],
        TRANCHE_SHORT[v.trancheHoraire],
        String(v.montant),
        v.membresPresents.join(" "),
        v.date,
      ].join(" ");
      return normalizeSearch(blob).includes(q);
    });
    return [...list].sort((a, b) => {
      if (a.statut !== b.statut) return a.statut === "en_attente" ? -1 : 1;
      return b.createdAt.localeCompare(a.createdAt);
    });
  }, [versements, statutFilter, debouncedSearch]);

  const paged = useMemo(
    () => paginate(filtered, page, PAGE_SIZE),
    [filtered, page],
  );

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, statutFilter, date, from, to, filterSite]);

  const totals = useMemo(() => {
    let pending = 0;
    let confirmed = 0;
    let pendingAmount = 0;
    let confirmedAmount = 0;
    for (const v of versements) {
      if (v.statut === "en_attente") {
        pending += 1;
        pendingAmount += v.montant;
      } else {
        confirmed += 1;
        confirmedAmount += v.montant;
      }
    }
    return {
      pending,
      confirmed,
      pendingAmount,
      confirmedAmount,
      totalAmount: pendingAmount + confirmedAmount,
      totalCount: pending + confirmed,
    };
  }, [versements]);

  const checks = {
    montant: Boolean(montant),
    numero: Boolean(numero.trim()),
    membres: membres.some((m) => m.trim().length >= 2),
    preuves: preuves.length > 0,
  };
  const checkDone = Object.values(checks).filter(Boolean).length;
  const formReady = checkDone === 4;
  const montantN = Number(montant);
  const montantOk = Number.isFinite(montantN) && montantN > 0;

  function focusForm() {
    setComposerOpen(true);
    window.setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 40);
  }

  function applyPeriod(id: PeriodPreset) {
    const today = todayIsoDate();
    if (id === "today") {
      setFrom(today);
      setTo(today);
      return;
    }
    if (id === "week") {
      setFrom(addDaysIso(today, -6));
      setTo(today);
      return;
    }
    if (id === "month") {
      setFrom(monthStartIso(today));
      setTo(today);
    }
  }

  function isAllowedImage(file: File): boolean {
    const type = (file.type || "").toLowerCase();
    const name = file.name.toLowerCase();
    return (
      type === "image/jpeg" ||
      type === "image/jpg" ||
      type === "image/png" ||
      type === "image/webp" ||
      (!type &&
        (name.endsWith(".jpg") ||
          name.endsWith(".jpeg") ||
          name.endsWith(".png") ||
          name.endsWith(".webp")))
    );
  }

  function addPreuves(files: FileList | File[] | null) {
    if (!files || files.length === 0) return;
    const incoming = Array.from(files);
    const next = [...preuves];
    for (const file of incoming) {
      if (next.length >= MAX_PREUVES) {
        setError(`Maximum ${MAX_PREUVES} captures.`);
        break;
      }
      if (!isAllowedImage(file)) {
        setError("Capture d’écran : JPEG, PNG ou WebP uniquement.");
        continue;
      }
      if (file.size > 4 * 1024 * 1024) {
        setError("Capture d’écran trop lourde (max. 4 Mo par image).");
        continue;
      }
      next.push(file);
    }
    if (next.length > preuves.length) setError(null);
    setPreuves(next);
  }

  function removePreuve(index: number) {
    setPreuves((prev) => prev.filter((_, i) => i !== index));
  }

  function onDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDropActive(false);
    addPreuves(e.dataTransfer.files);
  }

  async function onDeclare(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!canDeclare) {
      setError("Votre compte ne peut pas déclarer de versement.");
      return;
    }
    if (!formReady) {
      setError(
        "Complétez montant, n° de transaction, membres présents et capture.",
      );
      return;
    }
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      if (preuves.length === 0) throw new Error("Joignez au moins une capture.");
      const form = new FormData();
      form.set("date", declareDate);
      form.set("site", site);
      form.set("heureTransaction", heure.slice(0, 5));
      form.set("trancheHoraire", tranche);
      for (const nom of membres) {
        if (nom.trim()) form.append("membresPresents", nom.trim());
      }
      form.set("montant", montant);
      form.set("numeroTransaction", numero);
      for (const file of preuves) {
        form.append("preuve", file);
      }
      const res = await fetch("/api/versements", {
        method: "POST",
        body: form,
      });
      let body: { error?: string } = {};
      try {
        body = (await res.json()) as { error?: string };
      } catch {
        throw new Error(
          res.ok
            ? "Réponse serveur invalide."
            : `Enregistrement impossible (${res.status}).`,
        );
      }
      if (!res.ok) throw new Error(body.error || "Enregistrement impossible.");
      setMontant("");
      setNumero("");
      setMembres([""]);
      setPreuves([]);
      setHeure(nowHeureLocale());
      setTranche(defaultTrancheFromShift(user?.shift));
      setDate(declareDate);
      setFlash("Versement enregistré — en attente de confirmation.");
      setComposerOpen(false);
      await charger();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement impossible.");
      setComposerOpen(true);
    } finally {
      setBusy(false);
    }
  }

  async function onConfirm(id: string) {
    if (busy || !canConfirm) return;
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      const res = await fetch("/api/versements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm", id }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error || "Confirmation impossible.");
      setFlash("Versement confirmé et verrouillé.");
      setSelected(null);
      await charger();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Confirmation impossible.");
    } finally {
      setBusy(false);
    }
  }

  const siteLocked = scope === "zogbo" || scope === "gbegamey";
  const periodHint = followAll
    ? from === to
      ? formatDateFr(from)
      : `${formatDateFr(from)} → ${formatDateFr(to)}`
    : formatDateFr(date);
  const mixTotal = totals.totalAmount;

  return (
    <AppShell
      title="Versements"
      subtitle={
        isReaderOnly
          ? "Consultation des déclarations et confirmations."
          : canDeclare
            ? "Déclarez le versement avec preuve, puis suivez les confirmations."
            : "Vérifiez la preuve puis confirmez la transaction."
      }
      mainClassName="main-versements"
      actions={
        <>
          <ExportExcelButton
            disabled={loading || filtered.length === 0}
            className="btn btn-ghost"
            onExport={() => {
              exportVersementsExcel({
                versements: filtered,
                from: followAll ? from : undefined,
                to: followAll ? to : undefined,
                date: followAll ? undefined : date,
                site: followAll
                  ? filterSite === "all"
                    ? "tous"
                    : filterSite
                  : site,
                statutLabel:
                  statutFilter === "all"
                    ? undefined
                    : VERSEMENT_STATUT_LABELS[statutFilter],
              });
              return Promise.resolve();
            }}
          />
          {canDeclare ? (
            <button
              type="button"
              className="btn btn-primary vs-action-new"
              onClick={focusForm}
            >
              <span className="vs-action-full">+ Nouveau versement</span>
              <span className="vs-action-short">+ Versement</span>
            </button>
          ) : canConfirm && totals.pending > 0 ? (
            <button
              type="button"
              className="btn btn-primary vs-action-confirm"
              onClick={() => {
                setStatutFilter("en_attente");
                setComposerOpen(false);
              }}
            >
              {totals.pending} à confirmer
            </button>
          ) : null}
        </>
      }
    >
      <div className="versements-page">
        <section className="vs-hero" aria-label="Synthèse des versements">
          <div className="vs-hero-ca">
            <span className="vs-kicker">
              Total période
              {followAll && filterSite !== "all" ? (
                <i className="vs-hero-site">{SITE_LABELS[filterSite]}</i>
              ) : null}
            </span>
            <strong className="vs-hero-value mono">
              {loading ? "…" : formatFcfa(totals.totalAmount)}
            </strong>
            <p className="vs-hero-hint">{periodHint}</p>
            <p className="vs-hero-meta">
              {loading
                ? "Chargement…"
                : `${totals.totalCount} versement${totals.totalCount > 1 ? "s" : ""}`}
            </p>
          </div>
          <div className="vs-hero-side">
            <div className="vs-kpis">
              <button
                type="button"
                className={`vs-kpi is-pending${statutFilter === "en_attente" ? " is-on" : ""}`}
                onClick={() =>
                  setStatutFilter(
                    statutFilter === "en_attente" ? "all" : "en_attente",
                  )
                }
              >
                <span>À confirmer</span>
                <strong className="mono">
                  {loading ? "…" : formatFcfa(totals.pendingAmount)}
                </strong>
                <em>
                  {loading
                    ? "…"
                    : `${totals.pending} en attente`}
                </em>
              </button>
              <button
                type="button"
                className={`vs-kpi is-ok${statutFilter === "confirmee" ? " is-on" : ""}`}
                onClick={() =>
                  setStatutFilter(
                    statutFilter === "confirmee" ? "all" : "confirmee",
                  )
                }
              >
                <span>Confirmés</span>
                <strong className="mono">
                  {loading ? "…" : formatFcfa(totals.confirmedAmount)}
                </strong>
                <em>
                  {loading
                    ? "…"
                    : `${totals.confirmed} verrouillé${totals.confirmed > 1 ? "s" : ""}`}
                </em>
              </button>
            </div>
            <div className="vs-mix" aria-hidden={mixTotal === 0}>
              <div className="vs-mix-bar">
                {mixTotal > 0 ? (
                  <>
                    <span
                      className="vs-mix-seg is-pending"
                      style={{
                        width: `${(totals.pendingAmount / mixTotal) * 100}%`,
                      }}
                    />
                    <span
                      className="vs-mix-seg is-ok"
                      style={{
                        width: `${(totals.confirmedAmount / mixTotal) * 100}%`,
                      }}
                    />
                  </>
                ) : null}
              </div>
              <p className="vs-mix-legend">
                En attente vs confirmé — cliquez un indicateur pour filtrer
              </p>
            </div>
          </div>
        </section>

        {error ? (
          <p className="error-banner" role="alert">
            {error}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => void charger()}
            >
              Réessayer
            </button>
          </p>
        ) : null}
        {flash ? (
          <p className="vs-flash" role="status">
            {flash}
          </p>
        ) : null}

        <section className="panel vs-toolbar" aria-label="Filtres du registre">
          <div className="vs-toolbar-top">
            {followAll ? (
              <div className="vs-periods" role="tablist" aria-label="Période">
                {PERIODS.filter((p) => p.id !== "custom" || period === "custom").map(
                  (p) => (
                    <button
                      key={p.id}
                      type="button"
                      role="tab"
                      aria-selected={period === p.id}
                      className={`vs-chip${period === p.id ? " is-active" : ""}${p.id === "custom" ? " is-static" : ""}`}
                      onClick={() => {
                        if (p.id !== "custom") applyPeriod(p.id);
                      }}
                    >
                      {p.label}
                    </button>
                  ),
                )}
              </div>
            ) : (
              <div className="vs-periods">
                <button
                  type="button"
                  className={`vs-chip${date === todayIsoDate() ? " is-active" : ""}`}
                  onClick={() => setDate(todayIsoDate())}
                >
                  Aujourd’hui
                </button>
              </div>
            )}
            <div className="vs-dates">
              {followAll ? (
                <>
                  <label className="vs-field">
                    <span>Du</span>
                    <input
                      type="date"
                      value={from}
                      max={todayIsoDate()}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
                        setFrom(v);
                      }}
                    />
                  </label>
                  <label className="vs-field">
                    <span>Au</span>
                    <input
                      type="date"
                      value={to}
                      max={todayIsoDate()}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
                        setTo(v);
                      }}
                    />
                  </label>
                </>
              ) : (
                <label className="vs-field">
                  <span>Jour</span>
                  <input
                    type="date"
                    value={date}
                    max={todayIsoDate()}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
                      setDate(v);
                    }}
                  />
                </label>
              )}
            </div>
            <label className="vs-search">
              <span className="sr-only">Recherche</span>
              <input
                type="search"
                placeholder="N°, nom, site…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
          </div>
          <div className="vs-toolbar-row">
            {followAll ? (
              <div className="vs-seg" role="tablist" aria-label="Site">
                {(
                  [
                    ["all", "Tous"],
                    ["zogbo", SITE_LABELS.zogbo],
                    ["gbegamey", SITE_LABELS.gbegamey],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={filterSite === key}
                    className={`vs-seg-btn${filterSite === key ? " is-active" : ""}`}
                    onClick={() => setFilterSite(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            ) : (
              <span className="vs-lock-pill">{SITE_LABELS[site]}</span>
            )}
            <div className="vs-seg" role="tablist" aria-label="Statut">
              {(
                [
                  ["all", "Tous", totals.totalCount],
                  ["en_attente", "En attente", totals.pending],
                  ["confirmee", "Confirmés", totals.confirmed],
                ] as const
              ).map(([key, label, count]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={statutFilter === key}
                  className={`vs-seg-btn${statutFilter === key ? " is-active" : ""}`}
                  onClick={() => setStatutFilter(key)}
                >
                  {label}
                  <i>{count}</i>
                </button>
              ))}
            </div>
            {canDeclare ? (
              <button
                type="button"
                className={`vs-composer-toggle${composerOpen ? " is-on" : ""}`}
                onClick={() =>
                  composerOpen ? setComposerOpen(false) : focusForm()
                }
              >
                {composerOpen ? "Fermer le bordereau" : "Ouvrir le bordereau"}
              </button>
            ) : null}
          </div>
        </section>

        {canDeclare && composerOpen ? (
          <section
            ref={formRef}
            className="vs-bordereau"
            id="nouveau-versement"
            aria-label="Nouveau versement"
          >
            <form className="vs-bordereau-form" onSubmit={onDeclare}>
              <header className="vs-bordereau-head">
                <div>
                  <p className="vs-kicker">Nouveau bordereau</p>
                  <h2>Déclarer un versement</h2>
                  <p>
                    Après confirmation comptable, plus aucune modification.
                  </p>
                </div>
                <div
                  className="vs-progress"
                  aria-label={`${checkDone} pièces sur 4`}
                >
                  <span className={checks.montant ? "is-ok" : ""} />
                  <span className={checks.numero ? "is-ok" : ""} />
                  <span className={checks.membres ? "is-ok" : ""} />
                  <span className={checks.preuves ? "is-ok" : ""} />
                </div>
              </header>

              <div className="vs-step">
                <h3>
                  <i>1</i> Contexte
                </h3>
                <div className="vs-step-grid vs-step-grid-4">
                  <label className="vs-field">
                    <span>Jour</span>
                    <input
                      type="date"
                      value={declareDate}
                      max={todayIsoDate()}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
                        setDeclareDate(v);
                      }}
                      required
                    />
                  </label>
                  {siteLocked ? (
                    <div className="vs-field">
                      <span>Site</span>
                      <p className="vs-readonly">{SITE_LABELS[site]}</p>
                    </div>
                  ) : (
                    <div className="vs-field">
                      <span>Site</span>
                      <div className="vs-seg vs-seg-fill" role="group">
                        <button
                          type="button"
                          className={`vs-seg-btn${site === "zogbo" ? " is-active" : ""}`}
                          onClick={() => setSite("zogbo")}
                        >
                          {SITE_LABELS.zogbo}
                        </button>
                        <button
                          type="button"
                          className={`vs-seg-btn${site === "gbegamey" ? " is-active" : ""}`}
                          onClick={() => setSite("gbegamey")}
                        >
                          {SITE_LABELS.gbegamey}
                        </button>
                      </div>
                    </div>
                  )}
                  <label className="vs-field">
                    <span>Heure</span>
                    <input
                      type="time"
                      value={heure}
                      onChange={(e) => setHeure(e.target.value)}
                      required
                    />
                  </label>
                  <div className="vs-field vs-field-wide">
                    <span>Tranche</span>
                    <div className="vs-seg vs-seg-fill" role="radiogroup">
                      {(
                        Object.keys(VERSEMENT_TRANCHE_LABELS) as VersementTranche[]
                      ).map((key) => (
                        <button
                          key={key}
                          type="button"
                          role="radio"
                          aria-checked={tranche === key}
                          className={`vs-seg-btn vs-tranche-btn${tranche === key ? " is-active" : ""}`}
                          onClick={() => setTranche(key)}
                        >
                          {TRANCHE_SHORT[key]}
                          <small>{TRANCHE_HOURS[key]}</small>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="vs-step">
                <h3>
                  <i>2</i> Transaction
                </h3>
                <div className="vs-tx">
                  <label className="vs-field vs-amount-field">
                    <span>Montant</span>
                    <div className="vs-amount-wrap">
                      <input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        step={1}
                        value={montant}
                        onChange={(e) => setMontant(e.target.value)}
                        placeholder="150000"
                        required
                      />
                      <span className="vs-amount-suffix">FCFA</span>
                    </div>
                    <em className="vs-amount-live">
                      {montantOk ? formatFcfa(montantN) : "Saisissez le montant versé"}
                    </em>
                  </label>
                  <label className="vs-field vs-numero-field">
                    <span>N° de transaction</span>
                    <input
                      type="text"
                      value={numero}
                      onChange={(e) => setNumero(e.target.value)}
                      maxLength={80}
                      placeholder="Référence MTN / Moov…"
                      autoCapitalize="characters"
                      required
                    />
                  </label>
                </div>
              </div>

              <div className="vs-step-split">
                <div className="vs-step">
                  <h3>
                    <i>3</i> Membres présents
                  </h3>
                  <fieldset className="vs-membres">
                    <legend className="sr-only">Membres présents</legend>
                    {membres.map((nom, index) => (
                      <div key={index} className="vs-membre-row">
                        <b aria-hidden>{index + 1}</b>
                        <input
                          type="text"
                          value={nom}
                          onChange={(e) => {
                            const next = [...membres];
                            next[index] = e.target.value;
                            setMembres(next);
                          }}
                          placeholder={`Membre ${index + 1}`}
                          autoComplete="name"
                          required={index === 0}
                        />
                        {membres.length > 1 ? (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            aria-label={`Retirer le membre ${index + 1}`}
                            onClick={() =>
                              setMembres(membres.filter((_, i) => i !== index))
                            }
                          >
                            Retirer
                          </button>
                        ) : null}
                      </div>
                    ))}
                    {membres.length < 12 ? (
                      <button
                        type="button"
                        className="btn btn-ghost vs-add-membre"
                        onClick={() => setMembres([...membres, ""])}
                      >
                        + Ajouter un membre
                      </button>
                    ) : null}
                  </fieldset>
                </div>

                <div className="vs-step">
                  <h3>
                    <i>4</i> Captures d’écran
                  </h3>
                  <label
                    className={`vs-dropzone${dropActive ? " is-active" : ""}${preuves.length ? " has-file" : ""}`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDropActive(true);
                    }}
                    onDragLeave={() => setDropActive(false)}
                    onDrop={onDrop}
                  >
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      multiple
                      onChange={(e) => {
                        addPreuves(e.target.files);
                        e.target.value = "";
                      }}
                    />
                    <strong>
                      {preuves.length === 0
                        ? "Déposez ou cliquez pour joindre"
                        : `${preuves.length} image${preuves.length > 1 ? "s" : ""} — cliquer pour ajouter`}
                    </strong>
                    <em>
                      JPEG, PNG, WebP · 4 Mo max · jusqu’à {MAX_PREUVES}
                      {preuves.length > 0 && preuves.length < MAX_PREUVES
                        ? ` · ${MAX_PREUVES - preuves.length} restante${MAX_PREUVES - preuves.length > 1 ? "s" : ""}`
                        : ""}
                    </em>
                  </label>
                  {preuves.length > 0 ? (
                    <ul className="vs-preuves-grid" aria-label="Aperçus">
                      {preuves.map((file, index) => (
                        <li key={`${file.name}-${file.size}-${index}`}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={preuvePreviews[index]}
                            alt=""
                            className="vs-preuve-preview"
                          />
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => removePreuve(index)}
                          >
                            Retirer
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </div>

              <footer className="vs-bordereau-foot">
                <ul className="vs-checks" aria-label="Pièces du bordereau">
                  <li className={checks.montant ? "is-ok" : ""}>Montant</li>
                  <li className={checks.numero ? "is-ok" : ""}>
                    N° de transaction
                  </li>
                  <li className={checks.membres ? "is-ok" : ""}>Membres</li>
                  <li className={checks.preuves ? "is-ok" : ""}>
                    Capture{preuves.length > 1 ? `s (${preuves.length})` : ""}
                  </li>
                </ul>
                <div className="vs-form-actions">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setComposerOpen(false)}
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary vs-submit"
                    disabled={busy || !formReady}
                  >
                    {busy ? "Enregistrement…" : "Envoyer le bordereau"}
                  </button>
                </div>
              </footer>
            </form>
          </section>
        ) : null}

        <section className="vs-ledger" aria-label="Liste des versements">
          <div className="vs-ledger-head">
            <div className="vs-ledger-title">
              <h2>Registre</h2>
              {canConfirm && totals.pending > 0 ? (
                <p className="vs-queue-note">
                  {totals.pending} en attente de votre confirmation
                </p>
              ) : (
                <p className="vs-ledger-meta">
                  {filtered.length} ligne{filtered.length > 1 ? "s" : ""}
                  {statutFilter !== "all"
                    ? ` · ${VERSEMENT_STATUT_LABELS[statutFilter]}`
                    : ""}
                </p>
              )}
            </div>
          </div>

          {loading || !scope ? (
            <BrandLoader label="Chargement du registre…" />
          ) : filtered.length === 0 ? (
            <div className="vs-empty">
              <strong>
                {versements.length === 0
                  ? "Aucun versement sur cette période"
                  : "Aucun versement trouvé"}
              </strong>
              <span>
                {versements.length === 0
                  ? canDeclare
                    ? "Ouvrez le bordereau pour enregistrer la première ligne."
                    : "Changez les dates ou le site pour élargir la période."
                  : "Modifiez la recherche ou le filtre de statut."}
              </span>
              {versements.length === 0 && canDeclare ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={focusForm}
                >
                  + Nouveau versement
                </button>
              ) : null}
            </div>
          ) : (
            <>
              <ul className="vs-cards" aria-label="Versements">
                {paged.items.map((v) => (
                  <li key={v.id}>
                    <article
                      className={`vs-card${v.statut === "en_attente" ? " is-pending" : ""}`}
                    >
                      <button
                        type="button"
                        className="vs-card-main"
                        onClick={() => setSelected(v)}
                      >
                        <header>
                          <strong className="mono">{formatFcfa(v.montant)}</strong>
                          <span className={`vs-statut is-${v.statut}`}>
                            {VERSEMENT_STATUT_LABELS[v.statut]}
                          </span>
                        </header>
                        <p>
                          {formatDateFr(v.date)} · {v.heureTransaction} ·{" "}
                          {TRANCHE_SHORT[v.trancheHoraire]}
                          {followAll ? ` · ${SITE_LABELS[v.site]}` : ""}
                        </p>
                        <code className="vs-numero">{v.numeroTransaction}</code>
                        <small>{v.actorName}</small>
                      </button>
                      <div className="vs-card-actions">
                        {canConfirm && v.statut === "en_attente" ? (
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={busy}
                            onClick={() => void onConfirm(v.id)}
                          >
                            Confirmer
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => setSelected(v)}
                        >
                          Voir
                        </button>
                      </div>
                    </article>
                  </li>
                ))}
              </ul>

              <div className="table-scroll vs-table-wrap">
                <table className="data-table vs-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Tranche</th>
                      {followAll ? <th>Site</th> : null}
                      <th>N°</th>
                      <th className="num">Montant</th>
                      <th>Statut</th>
                      <th className="vs-col-action">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {paged.items.map((v) => (
                      <tr
                        key={v.id}
                        className={
                          v.statut === "en_attente" ? "is-pending" : ""
                        }
                      >
                        <td className="vs-td-date">
                          <button
                            type="button"
                            className="vs-row-open"
                            onClick={() => setSelected(v)}
                          >
                            {formatDateFr(v.date)}
                            <small>
                              {v.heureTransaction} · {v.actorName}
                            </small>
                          </button>
                        </td>
                        <td>
                          <span className={`vs-tranche is-${v.trancheHoraire}`}>
                            {TRANCHE_SHORT[v.trancheHoraire]}
                          </span>
                        </td>
                        {followAll ? <td>{SITE_LABELS[v.site]}</td> : null}
                        <td>
                          <code className="vs-numero">{v.numeroTransaction}</code>
                        </td>
                        <td className="num mono vs-td-amount">
                          {formatFcfa(v.montant)}
                        </td>
                        <td>
                          <span className={`vs-statut is-${v.statut}`}>
                            {VERSEMENT_STATUT_LABELS[v.statut]}
                          </span>
                        </td>
                        <td className="vs-col-action">
                          {canConfirm && v.statut === "en_attente" ? (
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              disabled={busy}
                              onClick={() => void onConfirm(v.id)}
                            >
                              Confirmer
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => setSelected(v)}
                          >
                            Voir
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <CataloguePaginationBar
                from={paged.from}
                to={paged.to}
                total={paged.total}
                page={paged.page}
                totalPages={paged.totalPages}
                onPage={setPage}
                itemLabel="versement"
              />
            </>
          )}
        </section>

        {selected ? (
          <div
            className="vs-modal-backdrop"
            role="presentation"
            onClick={() => setSelected(null)}
          >
            <div
              className="vs-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="versements-modal-title"
              onClick={(e) => e.stopPropagation()}
            >
              <header className="vs-modal-head">
                <div className="vs-modal-head-main">
                  <p className="vs-kicker">Détail du versement</p>
                  <h2 id="versements-modal-title">
                    {formatFcfa(selected.montant)}
                  </h2>
                  <div className="vs-modal-head-meta">
                    <span className={`vs-statut is-${selected.statut}`}>
                      {VERSEMENT_STATUT_LABELS[selected.statut]}
                    </span>
                    <span>
                      {formatDateFr(selected.date)} · {selected.heureTransaction}{" "}
                      · {SITE_LABELS[selected.site]}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setSelected(null)}
                >
                  Fermer
                </button>
              </header>

              <div className="vs-modal-body">
                <div className="vs-modal-info">
                  <dl className="vs-detail">
                    <div>
                      <dt>Jour</dt>
                      <dd>{formatDateFr(selected.date)}</dd>
                    </div>
                    <div>
                      <dt>Heure tx</dt>
                      <dd>{selected.heureTransaction}</dd>
                    </div>
                    <div>
                      <dt>Tranche</dt>
                      <dd>
                        {VERSEMENT_TRANCHE_LABELS[selected.trancheHoraire]}
                      </dd>
                    </div>
                    <div>
                      <dt>Site</dt>
                      <dd>{SITE_LABELS[selected.site]}</dd>
                    </div>
                    <div className="is-wide">
                      <dt>Membres</dt>
                      <dd>
                        {selected.membresPresents.length
                          ? selected.membresPresents.join(", ")
                          : "—"}
                      </dd>
                    </div>
                    <div className="is-wide">
                      <dt>N° transaction</dt>
                      <dd>
                        <code className="vs-numero">
                          {selected.numeroTransaction}
                        </code>
                      </dd>
                    </div>
                    <div className="is-wide">
                      <dt>Déclaré</dt>
                      <dd>
                        {formatDateHeure(selected.createdAt)} —{" "}
                        {selected.actorName} ({SHIFT_LABELS[selected.shift]})
                      </dd>
                    </div>
                    <div className="is-wide">
                      <dt>Confirmé</dt>
                      <dd>
                        {selected.confirmedAt
                          ? `${formatDateHeure(selected.confirmedAt)} — ${selected.confirmedByName}`
                          : "En attente"}
                      </dd>
                    </div>
                  </dl>
                </div>

                <figure className="vs-preuve-figure">
                  <figcaption>
                    Capture
                    {preuvesOf(selected).length > 1
                      ? `s (${preuvesOf(selected).length})`
                      : ""}
                  </figcaption>
                  <div className="vs-preuve-gallery">
                    {preuvesOf(selected).map((p, index) => (
                      <a
                        key={`${p.url}-${index}`}
                        href={p.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.url} alt={`Capture ${index + 1}`} />
                      </a>
                    ))}
                  </div>
                </figure>
              </div>

              <footer className="vs-modal-foot">
                {canConfirm && selected.statut === "en_attente" ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={() => void onConfirm(selected.id)}
                  >
                    {busy ? "Confirmation…" : "Confirmer la transaction"}
                  </button>
                ) : selected.statut === "confirmee" ? (
                  <p className="vs-locked-note">Transaction verrouillée.</p>
                ) : isReaderOnly ? (
                  <p className="vs-locked-note">
                    Consultation seule — confirmation réservée au comptable.
                  </p>
                ) : (
                  <p className="vs-locked-note">
                    En attente de confirmation par le comptable.
                  </p>
                )}
              </footer>
            </div>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
