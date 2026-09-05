"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { BrandLoader } from "@/components/brand-loader";
import {
  DashKpiGrid,
  DashboardShell,
} from "@/components/dashboard/dashboard-layout";
import {
  CHART_COLORS,
  DonutChart,
  GroupedBarChart,
  HorizontalBars,
  LineAreaChart,
  ProductRanking,
} from "@/components/charts/charts";
import { ExportExcelButton } from "@/components/export-excel-button";
import { PriceInput } from "@/components/parametres/price-input";
import { formatFcfa } from "@/lib/format";
import { exportSyntheseExcel } from "@/lib/page-exports";
import { chargesTotal, emptyCharges } from "@/lib/synthese-calc";
import type { EpuiseRow } from "@/lib/stock-repo";
import type {
  DayCharges,
  DayPoint,
  MonthPoint,
  ProductRanking as ProductRankingData,
  VenteSite,
  YearPoint,
} from "@/lib/types";
import { formatDisplayDate, todayIsoDate } from "@/lib/zogbo-calc";
import "@/components/synthese/synthese-dashboard.css";

type ViewKey = "day" | "month" | "year";

const DASH_SITE_KEY = "kf-dash-site";

function readStoredDashSite(): VenteSite {
  if (typeof window === "undefined") return "zogbo";
  try {
    const v = window.sessionStorage.getItem(DASH_SITE_KEY);
    if (v === "zogbo" || v === "gbegamey") return v;
  } catch {
    /* ignore */
  }
  return "zogbo";
}

const MONTH_NAMES = [
  "Janvier",
  "Février",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Août",
  "Septembre",
  "Octobre",
  "Novembre",
  "Décembre",
];

const CHARGE_FIELDS: {
  // « pertes » est calculé depuis le journal des pertes : jamais saisi ici.
  key: keyof Omit<
    DayCharges,
    | "date"
    | "updatedAt"
    | "pertes"
    | "achatsStock"
    | "immobilisations"
    | "matieresConsommees"
    | "amortissements"
    | "cmvBoissons"
    | "cmvEmballages"
  >;
  label: string;
}[] = [
  { key: "matieresPremieres", label: "Achats matières 1ères" },
  { key: "loyer", label: "Charge locative" },
  { key: "salaires", label: "Salaires" },
  { key: "electricite", label: "Électricité" },
  { key: "carburant", label: "Carburant" },
  { key: "reparations", label: "Réparations / entretien" },
];

const MIX_COLORS = {
  plats: "#003d82",
  accompagnements: "#2a7ec8",
  boissons: "#7eb6e0",
  extra: "#7c5cbf",
};

const SITE_COLORS = {
  zogbo: "#005098",
  gbegamey: "#e67e22",
};

type CancelNotice = {
  caActif: number;
  caAnnule: number;
  nActif: number;
  nAnnule: number;
};

type MixSlice = {
  key: string;
  label: string;
  value: number;
  color: string;
};

function mixFromDay(day: DayPoint): MixSlice[] {
  return [
    {
      key: "plats",
      label: "Plats",
      value: day.caZogboPlats + day.caGbegameyPlats,
      color: MIX_COLORS.plats,
    },
    {
      key: "accompagnements",
      label: "Accompagnements",
      value: day.caAccompagnements,
      color: MIX_COLORS.accompagnements,
    },
    {
      key: "boissons",
      label: "Boissons",
      value: day.caBoissons,
      color: MIX_COLORS.boissons,
    },
    {
      key: "extra",
      label: "Extras",
      value: day.caExtra,
      color: MIX_COLORS.extra,
    },
  ];
}

function mixFromPeriodTotals(t: {
  caPlatsZogbo: number;
  caPlatsGbegamey: number;
  caAccompagnementsZogbo: number;
  caAccompagnementsGbegamey: number;
  caBoissons: number;
  caExtraZogbo: number;
  caExtraGbegamey: number;
}): MixSlice[] {
  return [
    {
      key: "plats",
      label: "Plats",
      value: t.caPlatsZogbo + t.caPlatsGbegamey,
      color: MIX_COLORS.plats,
    },
    {
      key: "accompagnements",
      label: "Accompagnements",
      value: t.caAccompagnementsZogbo + t.caAccompagnementsGbegamey,
      color: MIX_COLORS.accompagnements,
    },
    {
      key: "boissons",
      label: "Boissons",
      value: t.caBoissons,
      color: MIX_COLORS.boissons,
    },
    {
      key: "extra",
      label: "Extras",
      value: t.caExtraZogbo + t.caExtraGbegamey,
      color: MIX_COLORS.extra,
    },
  ];
}

function sitesFromDay(day: DayPoint) {
  return [
    {
      key: "zogbo",
      label: "Zogbo",
      value: day.caZogbo,
      color: SITE_COLORS.zogbo,
    },
    {
      key: "gbegamey",
      label: "Gbégamey",
      value: day.caGbegamey,
      color: SITE_COLORS.gbegamey,
    },
  ];
}

function caFinalAmount(input: {
  viewMode: ViewKey;
  cancelNotice: CancelNotice | null;
  caCumuls: { jour: number; mois: number; annee?: number; total: number };
}): number {
  if (input.cancelNotice) return input.cancelNotice.caActif;
  if (input.viewMode === "day") return input.caCumuls.jour;
  if (input.viewMode === "month") return input.caCumuls.mois;
  return input.caCumuls.annee ?? input.caCumuls.total;
}

function caFinalStatus(input: {
  viewMode: ViewKey;
  cancelNotice: CancelNotice | null;
}): { label: string; tone: "ok" | "warn" | "muted" } {
  const period =
    input.viewMode === "day"
      ? "Jour sélectionné"
      : input.viewMode === "month"
        ? "Mois sélectionné"
        : "Année / historique";
  const notice = input.cancelNotice;
  if (!notice) return { label: period, tone: "muted" };
  if (notice.nActif === 0 && notice.nAnnule === 0) {
    return { label: `${period} · Aucune vente`, tone: "muted" };
  }
  if (notice.caAnnule > 0) {
    const n = notice.nAnnule;
    return {
      label: `${period} · CA validé · ${n} ligne${n > 1 ? "s" : ""} exclue${n > 1 ? "s" : ""}`,
      tone: "warn",
    };
  }
  return { label: `${period} · Validé`, tone: "ok" };
}

function KpiGlyph({
  name,
}: {
  name:
    | "ca"
    | "matin"
    | "soir"
    | "zogbo"
    | "gbegamey"
    | "hors"
    | "charges"
    | "resultat"
    | "marge";
}) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    width: 22,
    height: 22,
    "aria-hidden": true,
  };
  switch (name) {
    case "ca":
      return (
        <svg {...common}>
          <path d="M4 16.5 9 11l4 3.5 7-9" />
          <path d="M4 20h16" />
        </svg>
      );
    case "matin":
      return (
        <svg {...common}>
          <circle cx="9" cy="10" r="2.2" />
          <circle cx="15" cy="10" r="2.2" />
          <circle cx="12" cy="8.5" r="2.2" />
          <path d="M5 18c.6-2.4 2.6-4 7-4s6.4 1.6 7 4" />
        </svg>
      );
    case "soir":
      return (
        <svg {...common}>
          <path d="M15.5 13.5A6 6 0 0 1 10 5.2 6.2 6.2 0 1 0 18.8 14a6 6 0 0 1-3.3-.5Z" />
        </svg>
      );
    case "zogbo":
      return (
        <svg {...common}>
          <path d="M12 21s7-5.4 7-11a7 7 0 1 0-14 0c0 5.6 7 11 7 11Z" />
          <circle cx="12" cy="10" r="2.1" />
        </svg>
      );
    case "gbegamey":
      return (
        <svg {...common}>
          <path d="M4 19V6.5L12 4l8 2.5V19" />
          <path d="M4 19h16" />
          <path d="M12 4v15" />
        </svg>
      );
    case "hors":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
          <path d="M8 12h8" />
        </svg>
      );
    case "charges":
      return (
        <svg {...common}>
          <rect x="4" y="4" width="16" height="16" rx="3" />
          <path d="M8 9h8M8 12.5h8M8 16h5" />
        </svg>
      );
    case "resultat":
      return (
        <svg {...common}>
          <path d="M4 16 9 9l4 4 7-8" />
        </svg>
      );
    case "marge":
      return (
        <svg {...common}>
          <path d="M5 19V8h4v11H5Zm5 0V5h4v14h-4Zm5 0v-7h4v7h-4Z" />
        </svg>
      );
  }
}

function BreakdownLine({
  label,
  amount,
}: {
  label: string;
  amount: number;
}) {
  return (
    <li>
      <span>{label}</span>
      <span className="dash-leader" aria-hidden />
      <em className="mono">{formatFcfa(amount)}</em>
    </li>
  );
}

function MixStrip({
  slices,
  onDark,
}: {
  slices: MixSlice[];
  onDark?: boolean;
}) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (total <= 0) return null;
  return (
    <div
      className={`dash-mix-strip${onDark ? " is-on-dark" : ""}`}
      aria-label="Mix des ventes"
    >
      <div className="dash-mix-bar" aria-hidden>
        {slices
          .filter((s) => s.value > 0)
          .map((s) => (
            <span
              key={s.key}
              style={{
                width: `${(s.value / total) * 100}%`,
                background: s.color,
              }}
              title={`${s.label} · ${formatFcfa(s.value)}`}
            />
          ))}
      </div>
      <ul className="dash-mix-legend">
        {slices.map((s) => (
          <li key={s.key}>
            <i style={{ background: s.color }} aria-hidden />
            {s.label}
            <em className="mono">{Math.round((s.value / total) * 100)}%</em>
          </li>
        ))}
      </ul>
    </div>
  );
}

function weekdayShort(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("fr-FR", {
    weekday: "short",
  });
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function shortDay(iso: string): string {
  return iso.slice(8);
}

export function SynthesePage() {
  const [view, setView] = useState<ViewKey>("year");
  const [date, setDate] = useState(() => todayIsoDate());
  const [month, setMonth] = useState(() => currentMonth());
  const [year, setYear] = useState(() => String(new Date().getFullYear()));
  const [site, setSite] = useState<VenteSite>(() => readStoredDashSite());
  const [allowedSites, setAllowedSites] = useState<VenteSite[]>([
    "zogbo",
    "gbegamey",
  ]);
  const [lockedSite, setLockedSite] = useState(false);

  /** Produits épuisés du jour (vue journalière uniquement). */
  const [epuises, setEpuises] = useState<EpuiseRow[]>([]);

  const [day, setDay] = useState<DayPoint | null>(null);
  const [monthData, setMonthData] = useState<MonthPoint | null>(null);
  const [yearData, setYearData] = useState<YearPoint | null>(null);
  const [ranking, setRanking] = useState<ProductRankingData>({
    best: [],
    worst: [],
    sites: [],
    plats: { best: [], worst: [] },
    accompagnements: { best: [], worst: [] },
    boissons: { best: [], worst: [] },
  });
  const [cancelNotice, setCancelNotice] = useState<{
    caActif: number;
    caAnnule: number;
    nActif: number;
    nAnnule: number;
  } | null>(null);
  const [shiftTotals, setShiftTotals] = useState<{
    jour: number;
    soir: number;
    nuit: number;
    aucune: number;
  } | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [caCumuls, setCaCumuls] = useState<{
    jour: number;
    mois: number;
    annee?: number;
    total: number;
  } | null>(null);

  const [chargesDraft, setChargesDraft] = useState<DayCharges>(
    emptyCharges(date),
  );
  const [dirtyCharges, setDirtyCharges] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  const isGeneral = role !== null && role !== "admin" && role !== "daf" && role !== "comptable";
  const viewMode = isGeneral ? "day" : view;

  useEffect(() => {
    try {
      window.sessionStorage.setItem(DASH_SITE_KEY, site);
    } catch {
      /* ignore */
    }
  }, [site]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const siteQs = `&site=${encodeURIComponent(site)}`;
        const qs =
          viewMode === "day"
            ? `view=day&date=${encodeURIComponent(date)}${siteQs}`
            : viewMode === "month"
              ? `view=month&month=${encodeURIComponent(month)}${siteQs}`
              : `view=year&year=${encodeURIComponent(year)}${siteQs}`;

        const res = await fetch(`/api/synthese?${qs}`, { cache: "no-store" });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Erreur de chargement");

        if (cancelled) return;

        if (Array.isArray(body.allowedSites) && body.allowedSites.length) {
          setAllowedSites(body.allowedSites as VenteSite[]);
        }
        if (typeof body.lockedSite === "boolean") {
          setLockedSite(body.lockedSite);
        }
        if (body.scopeSite === "zogbo" || body.scopeSite === "gbegamey") {
          if (body.lockedSite) setSite(body.scopeSite);
        }

        const nextRanking = (body.ranking as ProductRankingData | undefined) ?? {
          best: [],
          worst: [],
          sites: [],
          plats: { best: [], worst: [] },
          accompagnements: { best: [], worst: [] },
          boissons: { best: [], worst: [] },
        };
        setRanking({
          best: nextRanking.best ?? [],
          worst: nextRanking.worst ?? [],
          sites: nextRanking.sites ?? [],
          plats: nextRanking.plats ?? { best: [], worst: [] },
          accompagnements: nextRanking.accompagnements ?? {
            best: [],
            worst: [],
          },
          boissons: nextRanking.boissons ?? { best: [], worst: [] },
        });
        setCancelNotice(
          (body.cancelNotice as {
            caActif: number;
            caAnnule: number;
            nActif: number;
            nAnnule: number;
          } | null) ?? null,
        );
        setCaCumuls(
          (body.caCumuls as {
            jour: number;
            mois: number;
            annee?: number;
            total: number;
          } | null) ?? null,
        );
        setShiftTotals(
          (body.shiftTotals as {
            jour: number;
            soir: number;
            nuit: number;
            aucune: number;
          } | null) ?? null,
        );
        setRole((body.role as string | null) ?? null);

        if (viewMode === "day") {
          setDay(body.day as DayPoint);
          setChargesDraft((body.day as DayPoint).charges);
          setDirtyCharges(false);
          setEpuises((body.epuises as EpuiseRow[] | undefined) ?? []);
          setMonthData(null);
          setYearData(null);
        } else if (viewMode === "month") {
          setMonthData(body.month as MonthPoint);
          setDay(null);
          setYearData(null);
          setEpuises([]);
        } else {
          setYearData(body.year as YearPoint);
          setDay(null);
          setMonthData(null);
          setEpuises([]);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Erreur de chargement");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [viewMode, view, date, month, year, site, reloadTick]);

  // Rafraîchissement silencieux de la vue jour : le gérant voit en direct
  // les produits épuisés au fur et à mesure des ventes. Suspendu pendant
  // la saisie des charges non enregistrées (on ne touche pas au brouillon).
  useEffect(() => {
    if (viewMode !== "day") return;
    const id = window.setInterval(() => {
      if (dirtyCharges || document.visibilityState !== "visible") return;
      void (async () => {
        try {
          const res = await fetch(
            `/api/synthese?view=day&date=${encodeURIComponent(date)}&site=${encodeURIComponent(site)}`,
            { cache: "no-store" },
          );
          const body = await res.json();
          if (!res.ok || !body.day) return;
          setDay(body.day as DayPoint);
          setEpuises((body.epuises as EpuiseRow[] | undefined) ?? []);
        } catch {
          // Silencieux : le prochain passage retentera.
        }
      })();
    }, 45000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, date, site, dirtyCharges]);

  const dayResultat = useMemo(() => {
    if (!day) return null;
    const total = chargesTotal({
      ...chargesDraft,
      pertes: day.charges.pertes,
      matieresConsommees: day.charges.matieresConsommees,
      cmvBoissons: day.charges.cmvBoissons,
      cmvEmballages: day.charges.cmvEmballages,
      amortissements: day.charges.amortissements,
    });
    return {
      chargesTotal: total,
      resultat: day.caTotal - total,
    };
  }, [day, chargesDraft]);

  async function saveCharges() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/synthese", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...chargesDraft, date, site }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Erreur d’enregistrement");
      setDay(body.day as DayPoint);
      setChargesDraft((body.day as DayPoint).charges);
      setDirtyCharges(false);
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur d’enregistrement");
    } finally {
      setSaving(false);
    }
  }

  function handlePeriodChange(next: string) {
    if (viewMode === "day") {
      if (
        dirtyCharges &&
        !window.confirm("Charges non enregistrées. Changer de jour ?")
      ) {
        return;
      }
      setDate(next);
    } else if (viewMode === "month") {
      setMonth(next);
    } else {
      setYear(next);
    }
  }

  function exportBoard() {
    return exportSyntheseExcel({
      view: viewMode,
      date,
      month,
      year,
    });
  }

  const headerPeriodLabel =
    viewMode === "day"
      ? formatDisplayDate(date)
      : viewMode === "month"
        ? month
        : year;
  const siteLabel = site === "zogbo" ? "Zogbo" : "Gbégamey";
  const status = caFinalStatus({ viewMode, cancelNotice });
  const heroMix =
    viewMode === "day" && day
      ? mixFromDay(day)
      : viewMode === "month" && monthData
        ? mixFromPeriodTotals(monthData.totals)
        : viewMode === "year" && yearData
          ? mixFromPeriodTotals(yearData.totals)
          : [];
  const heroSide =
    isGeneral && shiftTotals
      ? [
          { label: "Matin", value: formatFcfa(shiftTotals.jour) },
          { label: "Soir", value: formatFcfa(shiftTotals.soir) },
          { label: "Nuit", value: formatFcfa(shiftTotals.nuit) },
        ]
      : caCumuls
        ? [
            { label: "Jour", value: formatFcfa(caCumuls.jour) },
            { label: "Mois", value: formatFcfa(caCumuls.mois) },
            { label: "Total", value: formatFcfa(caCumuls.total) },
          ]
        : [];

  return (
    <AppShell
      title="Tableau de bord"
      subtitle={`Vue d’ensemble · ${siteLabel}`}
      mainClassName="main-dash"
      actions={
        <>
          <span className="dash-header-date" title="Période affichée">
            <svg
              className="dash-header-date-ico"
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden
            >
              <rect x="4" y="6" width="16" height="14" rx="2" />
              <path d="M8 4v4M16 4v4M4 11h16" />
            </svg>
            {headerPeriodLabel}
          </span>
          <ExportExcelButton
            label="Exporter Excel"
            className="btn btn-ghost dash-header-excel"
            onExport={exportBoard}
            disabled={loading}
          />
          <button
            type="button"
            className="dash-refresh-btn"
            aria-label="Actualiser"
            title="Actualiser"
            disabled={loading}
            onClick={() => setReloadTick((n) => n + 1)}
          >
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M20 12a8 8 0 1 1-2.2-5.5M20 4v6h-6"
              />
            </svg>
          </button>
        </>
      }
    >
      <DashboardShell>
        <div className="dash-command panel">
          <div className="dash-command-row">
            <div className="dash-periods" role="tablist" aria-label="Période">
              {(!isGeneral
                ? [
                    { id: "day" as const, label: "Journalier" },
                    { id: "month" as const, label: "Mensuel" },
                    { id: "year" as const, label: "Annuel" },
                  ]
                : [{ id: "day" as const, label: "Jour" }]
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={viewMode === t.id}
                  className={`dash-chip${viewMode === t.id ? " is-active" : ""}${isGeneral ? " is-static" : ""}`}
                  onClick={() => {
                    if (!isGeneral) setView(t.id);
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <span className="dash-command-spacer" aria-hidden />
            {viewMode === "day" && !isGeneral ? (
              <button
                type="button"
                className={`btn btn-primary${savedFlash && !dirtyCharges ? " btn-saved" : ""}`}
                onClick={saveCharges}
                disabled={!dirtyCharges || saving || loading}
              >
                {saving
                  ? "Enregistrement…"
                  : savedFlash
                    ? "Enregistré"
                    : dirtyCharges
                      ? "Enregistrer charges"
                      : "À jour"}
              </button>
            ) : null}
          </div>
          <div className="dash-command-row">
            {!lockedSite && allowedSites.length > 1 ? (
              <div className="dash-sites" role="group" aria-label="Site">
                {allowedSites.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`dash-chip${site === s ? " is-active" : ""}`}
                    onClick={() => {
                      if (
                        dirtyCharges &&
                        !window.confirm(
                          "Charges non enregistrées. Changer de site ?",
                        )
                      ) {
                        return;
                      }
                      setSite(s);
                    }}
                  >
                    {s === "zogbo" ? "Zogbo" : "Gbégamey"}
                  </button>
                ))}
              </div>
            ) : null}
            {viewMode === "day" ? (
              <label className="date-field date-field-pill">
                <span>Jour</span>
                <input
                  type="date"
                  value={date}
                  max={todayIsoDate()}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
                    handlePeriodChange(v);
                  }}
                />
              </label>
            ) : null}
            {viewMode === "month" ? (
              <label className="date-field date-field-pill">
                <span>Mois</span>
                <input
                  type="month"
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                />
              </label>
            ) : null}
            {viewMode === "year" ? (
              <label className="date-field date-field-pill">
                <span>Année</span>
                <input
                  type="number"
                  min={2020}
                  max={2100}
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                />
              </label>
            ) : null}
          </div>
        </div>

        <section
          className={`dash-spotlight${loading || !caCumuls ? " is-placeholder" : ""}`}
          aria-label="Chiffre d’affaires"
        >
          <div className="dash-spotlight-main">
            <span className="dash-spotlight-kicker">
              Chiffre d’affaires
              <span className="dash-spotlight-site">{siteLabel}</span>
            </span>
            <strong className="dash-spotlight-value mono">
              {loading || !caCumuls
                ? "…"
                : formatFcfa(
                    caFinalAmount({ viewMode, cancelNotice, caCumuls }),
                  )}
            </strong>
            <span className={`dash-spotlight-hint is-${status.tone}`}>
              {status.tone === "ok" ? (
                <span className="dash-status-check" aria-hidden>
                  ✓
                </span>
              ) : null}
              {loading ? "Chargement…" : status.label}
            </span>
          </div>
          {heroSide.length ? (
            <div className="dash-spotlight-side">
              {heroSide.map((item) => (
                <div key={item.label}>
                  <span>{item.label}</span>
                  <strong className="mono">{item.value}</strong>
                </div>
              ))}
            </div>
          ) : null}
          {heroMix.some((s) => s.value > 0) ? (
            <div className="dash-spotlight-mix">
              <MixStrip slices={heroMix} onDark />
            </div>
          ) : null}
        </section>

      {error ? (
        <p className="error-banner" role="alert">
          {error}
        </p>
      ) : null}

      {!loading && cancelNotice && cancelNotice.caAnnule > 0 ? (
        <div className="ui-info" role="status">
          <span className="ui-info-mark" aria-hidden>
            i
          </span>
          <p>
            <strong>CA Validé uniquement</strong>
            {" · "}
            {formatFcfa(cancelNotice.caActif)} comptabilisé sur la période
            {" · "}
            {formatFcfa(cancelNotice.caAnnule)} exclus (annulées / en cours,{" "}
            {cancelNotice.nAnnule} ligne
            {cancelNotice.nAnnule > 1 ? "s" : ""})
          </p>
        </div>
      ) : null}

      {loading ? (
        <BrandLoader label="Chargement du tableau de bord…" />
      ) : null}

      {!loading && isGeneral && day ? (
        <GeneralDayDashboard
          day={day}
          ranking={ranking}
          shiftTotals={shiftTotals}
          epuises={epuises}
        />
      ) : null}

      {!loading && !isGeneral && viewMode === "day" && day ? (
        <DayDashboard
          day={day}
          ranking={ranking}
          chargesDraft={chargesDraft}
          dayResultat={dayResultat}
          epuises={epuises}
          onChargeChange={(key, value) => {
            setChargesDraft((prev) => ({ ...prev, [key]: value ?? 0 }));
            setDirtyCharges(true);
          }}
        />
      ) : null}

      {!loading && !isGeneral && viewMode === "month" && monthData ? (
        <MonthDashboard
          data={monthData}
          ranking={ranking}
          onOpenDay={(d) => {
            setDate(d);
            setView("day");
          }}
        />
      ) : null}

      {!loading && !isGeneral && viewMode === "year" && yearData ? (
        <YearDashboard
          data={yearData}
          ranking={ranking}
          onOpenMonth={(m) => {
            setMonth(`${yearData.year}-${String(m).padStart(2, "0")}`);
            setView("month");
          }}
        />
      ) : null}
      </DashboardShell>
    </AppShell>
  );
}

/** Vue d’ensemble pour gérants et équipiers : résumé des ventes du jour,
 * matin comme soir, sans charges ni résultat ni périodes mensuelles. */
function GeneralDayDashboard({
  day,
  ranking,
  shiftTotals,
  epuises,
}: {
  day: DayPoint;
  ranking: ProductRankingData;
  shiftTotals: { jour: number; soir: number; nuit: number; aucune: number } | null;
  epuises: EpuiseRow[];
}) {
  const mixSlices = mixFromDay(day);
  const mixTotal = mixSlices.reduce((s, x) => s + x.value, 0);
  const sites = sitesFromDay(day);

  return (
    <div className="dash">
      <DashKpiGrid
        className={`dash-kpi-grid-day${shiftTotals && shiftTotals.aucune > 0 ? " is-wide" : ""}`}
        items={[
          {
            label: "Matin (équipe jour)",
            value: formatFcfa(shiftTotals?.jour ?? 0),
            accent: "blue",
            icon: <KpiGlyph name="matin" />,
          },
          {
            label: "Soir (équipe soir)",
            value: formatFcfa(shiftTotals?.soir ?? 0),
            accent: "purple",
            icon: <KpiGlyph name="soir" />,
          },
          {
            label: "Nuit (équipe nuit)",
            value: formatFcfa(shiftTotals?.nuit ?? 0),
            accent: "sky",
            icon: <KpiGlyph name="hors" />,
          },
          ...(shiftTotals && shiftTotals.aucune > 0
            ? [
                {
                  label: "Hors équipe",
                  value: formatFcfa(shiftTotals.aucune),
                  accent: "muted" as const,
                  icon: <KpiGlyph name="hors" />,
                },
              ]
            : []),
          {
            label: "Zogbo",
            value: formatFcfa(day.caZogbo),
            accent: "sky",
            icon: <KpiGlyph name="zogbo" />,
          },
          {
            label: "Gbégamey",
            value: formatFcfa(day.caGbegamey),
            accent: "orange",
            icon: <KpiGlyph name="gbegamey" />,
          },
        ]}
      />

      <EpuisesPanel epuises={epuises} />

      <div className="dash-bento">
        <section className="panel dash-card">
          <div className="panel-head">
            <h2 className="panel-title">Mix des ventes</h2>
            <p className="muted">Répartition du CA</p>
          </div>
          {mixTotal > 0 ? (
            <DonutChart
              slices={mixSlices}
              centerLabel="CA"
              centerValue={formatFcfa(day.caTotal)}
            />
          ) : (
            <p className="muted">Aucune vente enregistrée ce jour.</p>
          )}
        </section>

        <section className="panel dash-card">
          <div className="panel-head">
            <h2 className="panel-title">Points de vente</h2>
            <p className="muted">Zogbo et Gbégamey</p>
          </div>
          <HorizontalBars rows={sites} />
          <div className="dash-breakdown">
            <div className="dash-breakdown-site">
              <strong>Zogbo</strong>
              <ul>
                <BreakdownLine label="Plats" amount={day.caZogboPlats} />
                <BreakdownLine
                  label="Accompagnements"
                  amount={day.caAccompagnementsZogbo}
                />
                <BreakdownLine
                  label="Boissons"
                  amount={day.caBoissonsZogbo}
                />
                <BreakdownLine label="Extras" amount={day.caExtraZogbo} />
              </ul>
            </div>
            <div className="dash-breakdown-site">
              <strong>Gbégamey</strong>
              <ul>
                <BreakdownLine label="Plats" amount={day.caGbegameyPlats} />
                <BreakdownLine
                  label="Accompagnements"
                  amount={day.caAccompagnementsGbegamey}
                />
                <BreakdownLine
                  label="Boissons"
                  amount={day.caBoissonsGbegamey}
                />
                <BreakdownLine
                  label="Extras"
                  amount={day.caExtraGbegamey}
                />
              </ul>
            </div>
          </div>
        </section>
      </div>

      <section className="panel dash-card dash-card-wide dash-rank-panel">
        <div className="panel-head">
          <h2 className="panel-title">Classements</h2>
          <p className="muted">Zones et produits du jour</p>
        </div>
        <ProductRanking
          best={ranking.best}
          worst={ranking.worst}
          sites={ranking.sites}
          plats={ranking.plats}
          accompagnements={ranking.accompagnements}
          boissons={ranking.boissons}
        />
      </section>
    </div>
  );
}

function EpuisesPanel({ epuises }: { epuises: EpuiseRow[] }) {
  if (!epuises.length) return null;
  return (
    <section
      className="panel dash-card dash-card-wide dash-epuises-panel"
      aria-label="Produits épuisés"
    >
      <h2 className="panel-title">Produits épuisés</h2>
      <p className="muted">
        Plus rien à vendre en fin de journée — à préparer / réapprovisionner.
      </p>
      <div className="dash-epuises">
        {epuises.map((e) => (
          <span key={`${e.zone}:${e.productId}`} className="dash-epuise">
            <strong>{e.name}</strong>
            <em>{e.zoneLabel}</em>
          </span>
        ))}
      </div>
    </section>
  );
}

function DayDashboard({
  day,
  ranking,
  chargesDraft,
  dayResultat,
  epuises,
  onChargeChange,
}: {
  day: DayPoint;
  ranking: ProductRankingData;
  chargesDraft: DayCharges;
  dayResultat: { chargesTotal: number; resultat: number } | null;
  epuises: EpuiseRow[];
  onChargeChange: (
    key: keyof Omit<
      DayCharges,
      | "date"
      | "updatedAt"
      | "pertes"
      | "achatsStock"
      | "immobilisations"
      | "matieresConsommees"
      | "amortissements"
    >,
    value: number | null,
  ) => void;
}) {
  const charges = dayResultat?.chargesTotal ?? day.chargesTotal;
  const resultat = dayResultat?.resultat ?? day.resultat;

  const mixSlices = mixFromDay(day);
  const mixTotal = mixSlices.reduce((s, x) => s + x.value, 0);
  const sites = sitesFromDay(day);

  const chargeBars = [
    ...CHARGE_FIELDS.map((f) => ({
      key: f.key,
      label: f.label,
      value: Number(chargesDraft[f.key]) || 0,
      color: CHART_COLORS.charges,
    })),
    {
      key: "matieresConsommees",
      label: "Matières consommées (CMV)",
      value: day.charges.matieresConsommees ?? 0,
      color: CHART_COLORS.charges,
    },
    {
      key: "cmvBoissons",
      label: "CMV boissons",
      value: day.charges.cmvBoissons ?? 0,
      color: CHART_COLORS.charges,
    },
    {
      key: "cmvEmballages",
      label: "CMV emballages",
      value: day.charges.cmvEmballages ?? 0,
      color: CHART_COLORS.charges,
    },
    {
      key: "amortissements",
      label: "Dotations aux amortissements",
      value: day.charges.amortissements ?? 0,
      color: CHART_COLORS.charges,
    },
    {
      key: "pertes",
      label: "Pertes déclarées",
      value: day.charges.pertes ?? 0,
      color: CHART_COLORS.charges,
    },
  ].filter((r) => r.value > 0);

  return (
    <div className="dash">
      <EpuisesPanel epuises={epuises} />

      <DashKpiGrid
        className="dash-kpi-grid-day is-wide"
        items={[
          {
            label: "Point Zogbo",
            value: formatFcfa(day.caZogbo),
            accent: "sky",
            icon: <KpiGlyph name="zogbo" />,
          },
          {
            label: "Point Gbégamey",
            value: formatFcfa(day.caGbegamey),
            accent: "orange",
            icon: <KpiGlyph name="gbegamey" />,
          },
          {
            label: "Marge boissons",
            value: formatFcfa(day.margeBoissons),
            accent: "blue",
            icon: <KpiGlyph name="marge" />,
          },
          {
            label: "Charges",
            value: formatFcfa(charges),
            accent: "gold",
            icon: <KpiGlyph name="charges" />,
          },
          {
            label: "Résultat",
            value: formatFcfa(resultat),
            accent: resultat < 0 ? "orange" : "green",
            tone: resultat < 0 ? "warn" : "accent",
            icon: <KpiGlyph name="resultat" />,
          },
        ]}
      />

      {(day.varianceZogbo > 0 ||
        day.varianceGbegamey > 0 ||
        day.varianceBoissons > 0) && (
        <p className="warn-inline">
          Écarts stock : Zogbo {day.varianceZogbo} · Gbégamey{" "}
          {day.varianceGbegamey} · Boissons {day.varianceBoissons}
        </p>
      )}

      <div className="dash-bento">
        <section className="panel dash-card">
          <div className="panel-head">
            <h2 className="panel-title">Mix du jour</h2>
            <p className="muted">Répartition du CA</p>
          </div>
          {mixTotal > 0 ? (
            <DonutChart
              slices={mixSlices}
              centerLabel="CA"
              centerValue={formatFcfa(day.caTotal)}
            />
          ) : (
            <p className="muted">Aucune vente enregistrée ce jour.</p>
          )}
        </section>

        <section className="panel dash-card">
          <div className="panel-head">
            <h2 className="panel-title">Points de vente</h2>
            <p className="muted">Détail par catégorie</p>
          </div>
          <HorizontalBars rows={sites} />
          <div className="dash-breakdown">
            <div className="dash-breakdown-site">
              <strong>Zogbo</strong>
              <ul>
                <BreakdownLine label="Plats" amount={day.caZogboPlats} />
                <BreakdownLine
                  label="Accompagnements"
                  amount={day.caAccompagnementsZogbo}
                />
                <BreakdownLine
                  label="Boissons"
                  amount={day.caBoissonsZogbo}
                />
                <BreakdownLine label="Extras" amount={day.caExtraZogbo} />
              </ul>
            </div>
            <div className="dash-breakdown-site">
              <strong>Gbégamey</strong>
              <ul>
                <BreakdownLine label="Plats" amount={day.caGbegameyPlats} />
                <BreakdownLine
                  label="Accompagnements"
                  amount={day.caAccompagnementsGbegamey}
                />
                <BreakdownLine
                  label="Boissons"
                  amount={day.caBoissonsGbegamey}
                />
                <BreakdownLine
                  label="Extras"
                  amount={day.caExtraGbegamey}
                />
              </ul>
            </div>
          </div>
        </section>
      </div>

      <section className="panel dash-card dash-card-wide dash-rank-panel">
        <div className="panel-head">
          <h2 className="panel-title">Classements</h2>
          <p className="muted">Meilleurs et plus faibles produits du jour</p>
        </div>
        <ProductRanking
          best={ranking.best}
          worst={ranking.worst}
          sites={ranking.sites}
          plats={ranking.plats}
          accompagnements={ranking.accompagnements}
          boissons={ranking.boissons}
        />
      </section>

      <div className="dash-grid dash-grid-charges">
        <section className="panel dash-card">
          <div className="panel-head">
            <h2 className="panel-title">Répartition des charges</h2>
            <p className="muted">Postes renseignés</p>
          </div>
          {chargeBars.length ? (
            <HorizontalBars rows={chargeBars} />
          ) : (
            <p className="muted">Saisissez les charges ci-contre.</p>
          )}
        </section>

        <section className="panel dash-card">
          <div className="panel-head">
            <h2 className="panel-title">Saisie des charges</h2>
            <p className="muted">Montants en FCFA</p>
          </div>
          <div className="dash-charges-scroll">
            <div className="dash-charge-list">
              {CHARGE_FIELDS.map((f) => (
                <label key={f.key} className="dash-charge-row">
                  <span>{f.label}</span>
                  <PriceInput
                    value={chargesDraft[f.key]}
                    ariaLabel={f.label}
                    onChange={(v) => onChargeChange(f.key, v)}
                  />
                </label>
              ))}
              <div className="dash-charge-row is-readonly">
                <span>Matières consommées (CMV)</span>
                <em className="mono">
                  {formatFcfa(day.charges.matieresConsommees ?? 0)}
                </em>
              </div>
              <div className="dash-charge-row is-readonly">
                <span>Dotations aux amortissements</span>
                <em className="mono">
                  {formatFcfa(day.charges.amortissements ?? 0)}
                </em>
              </div>
              <div className="dash-charge-row is-readonly">
                <span>Pertes déclarées</span>
                <em className="mono">
                  {formatFcfa(day.charges.pertes ?? 0)}
                </em>
              </div>
              <div className="dash-charge-total">
                <span>Total charges</span>
                <strong className="mono">{formatFcfa(charges)}</strong>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function MonthDashboard({
  data,
  ranking,
  onOpenDay,
}: {
  data: MonthPoint;
  ranking: ProductRankingData;
  onOpenDay: (date: string) => void;
}) {
  const labels = data.days.map((d) => shortDay(d.date));
  const caSeries = [
    {
      key: "total",
      label: "CA total",
      color: CHART_COLORS.accent,
      values: data.days.map((d) => d.caTotal),
    },
    {
      key: "resultat",
      label: "Résultat",
      color: CHART_COLORS.resultat,
      values: data.days.map((d) => Math.max(0, d.resultat)),
    },
  ];
  const sitesSeries = [
    {
      key: "zogbo",
      label: "Zogbo",
      color: CHART_COLORS.zogbo,
      values: data.days.map((d) => d.caZogbo),
    },
    {
      key: "gbegamey",
      label: "Gbégamey",
      color: CHART_COLORS.gbegamey,
      values: data.days.map((d) => d.caGbegamey),
    },
  ];
  const mixSlices = mixFromPeriodTotals(data.totals);
  const mixTotal = mixSlices.reduce((s, x) => s + x.value, 0);
  const sites = [
    {
      key: "zogbo",
      label: "Zogbo",
      value: data.totals.caZogbo,
      color: SITE_COLORS.zogbo,
    },
    {
      key: "gbegamey",
      label: "Gbégamey",
      value: data.totals.caGbegamey,
      color: SITE_COLORS.gbegamey,
    },
  ];

  const categoryBars = [
    {
      key: "boissons",
      label: "Boissons",
      value: data.totals.caBoissons,
      color: CHART_COLORS.boissons,
    },
    {
      key: "charges",
      label: "Charges",
      value: data.totals.chargesTotal,
      color: CHART_COLORS.charges,
    },
  ];

  const siteSlices = sites.filter((s) => s.value > 0);

  return (
    <div className="dash">
      <DashKpiGrid
        className="dash-kpi-grid-month"
        items={[
          {
            label: "Zogbo",
            value: formatFcfa(data.totals.caZogbo),
            accent: "sky",
            icon: <KpiGlyph name="zogbo" />,
          },
          {
            label: "Gbégamey",
            value: formatFcfa(data.totals.caGbegamey),
            accent: "orange",
            icon: <KpiGlyph name="gbegamey" />,
          },
          {
            label: "Charges",
            value: formatFcfa(data.totals.chargesTotal),
            accent: "gold",
            icon: <KpiGlyph name="charges" />,
          },
          {
            label: "Résultat",
            value: formatFcfa(data.totals.resultat),
            accent: data.totals.resultat < 0 ? "orange" : "green",
            tone: data.totals.resultat < 0 ? "warn" : "accent",
            icon: <KpiGlyph name="resultat" />,
          },
        ]}
      />

      <section className="panel dash-card dash-card-wide">
        <div className="panel-head">
          <h2 className="panel-title">Évolution du mois</h2>
          <p className="muted">CA et résultat jour par jour</p>
        </div>
        <LineAreaChart labels={labels} series={caSeries} />
      </section>

      <div className="dash-bento-month">
        <section className="panel dash-card">
          <div className="panel-head">
            <h2 className="panel-title">Zogbo vs Gbégamey</h2>
            <p className="muted">CA par jour et par site</p>
          </div>
          <GroupedBarChart labels={labels} series={sitesSeries} />
        </section>
        <div className="dash-bento-stack">
          <section className="panel dash-card">
            <div className="panel-head">
              <h2 className="panel-title">Part des points</h2>
              <p className="muted">Répartition du CA</p>
            </div>
            {siteSlices.length ? (
              <DonutChart
                slices={siteSlices}
                centerLabel="CA"
                centerValue={
                  data.totals.caTotal >= 1000
                    ? `${Math.round(data.totals.caTotal / 1000)}k`
                    : String(data.totals.caTotal)
                }
              />
            ) : (
              <p className="muted">Pas encore de CA ce mois.</p>
            )}
          </section>
          <section className="panel dash-card">
            <div className="panel-head">
              <h2 className="panel-title">Mix · Boissons · Charges</h2>
              <p className="muted">Totaux du mois</p>
            </div>
            {mixTotal > 0 ? <MixStrip slices={mixSlices} /> : null}
            <HorizontalBars rows={categoryBars} />
          </section>
        </div>
      </div>

      <section className="panel dash-card dash-card-wide dash-rank-panel">
        <div className="panel-head">
          <h2 className="panel-title">Classements</h2>
          <p className="muted">Zones et produits sur le mois</p>
        </div>
        <ProductRanking
          best={ranking.best}
          worst={ranking.worst}
          sites={ranking.sites}
          plats={ranking.plats}
          accompagnements={ranking.accompagnements}
          boissons={ranking.boissons}
        />
      </section>

      <section className="panel dash-card dash-card-wide dash-days-panel">
        <div className="panel-head">
          <h2 className="panel-title">Détail des jours</h2>
          <p className="muted">Ouvrir le point journalier</p>
        </div>
        <div className="dash-period-scroll">
          <table className="dash-period-table">
            <thead>
              <tr>
                <th scope="col">Jour</th>
                <th scope="col" className="col-num">
                  Zogbo
                </th>
                <th scope="col" className="col-num">
                  Gbégamey
                </th>
                <th scope="col" className="col-num">
                  CA
                </th>
                <th scope="col" className="col-num">
                  Résultat
                </th>
                <th scope="col" className="col-act">
                  <span className="sr-only">Ouvrir</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.days.map((d) => {
                const active =
                  d.hasZogboData ||
                  d.hasGbegameyData ||
                  d.hasBoissonsData ||
                  d.chargesTotal > 0;
                return (
                  <tr
                    key={d.date}
                    className={active ? undefined : "is-empty"}
                  >
                    <th scope="row">
                      <span className="dash-period-day">
                        {shortDay(d.date)}
                      </span>
                      <span className="muted dash-period-week">
                        {weekdayShort(d.date)}
                      </span>
                    </th>
                    <td className="mono col-num">{formatFcfa(d.caZogbo)}</td>
                    <td className="mono col-num">
                      {formatFcfa(d.caGbegamey)}
                    </td>
                    <td className="mono col-num">{formatFcfa(d.caTotal)}</td>
                    <td
                      className={`mono col-num${d.resultat < 0 ? " is-neg" : d.resultat > 0 ? " is-pos" : ""}`}
                    >
                      {formatFcfa(d.resultat)}
                    </td>
                    <td className="col-act">
                      <button
                        type="button"
                        className="btn-link"
                        onClick={() => onOpenDay(d.date)}
                      >
                        Voir
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function YearDashboard({
  data,
  ranking,
  onOpenMonth,
}: {
  data: YearPoint;
  ranking: ProductRankingData;
  onOpenMonth: (month: number) => void;
}) {
  const labels = data.months.map((m) => MONTH_NAMES[m.month - 1]!.slice(0, 3));
  const series = [
    {
      key: "ca",
      label: "CA",
      color: CHART_COLORS.accent,
      values: data.months.map((m) => m.caTotal),
    },
    {
      key: "charges",
      label: "Charges",
      color: CHART_COLORS.charges,
      values: data.months.map((m) => m.chargesTotal),
    },
    {
      key: "resultat",
      label: "Résultat",
      color: CHART_COLORS.resultat,
      values: data.months.map((m) => Math.max(0, m.resultat)),
    },
  ];

  const mixSlices = mixFromPeriodTotals(data.totals);
  const mixTotal = mixSlices.reduce((s, x) => s + x.value, 0);
  const sites = [
    {
      key: "zogbo",
      label: "Zogbo",
      value: data.totals.caZogbo,
      color: SITE_COLORS.zogbo,
    },
    {
      key: "gbegamey",
      label: "Gbégamey",
      value: data.totals.caGbegamey,
      color: SITE_COLORS.gbegamey,
    },
  ];

  return (
    <div className="dash">
      <DashKpiGrid
        className="dash-kpi-grid-year"
        items={[
          {
            label: "Zogbo",
            value: formatFcfa(data.totals.caZogbo),
            accent: "sky",
            icon: <KpiGlyph name="zogbo" />,
          },
          {
            label: "Gbégamey",
            value: formatFcfa(data.totals.caGbegamey),
            accent: "orange",
            icon: <KpiGlyph name="gbegamey" />,
          },
          {
            label: "Charges",
            value: formatFcfa(data.totals.chargesTotal),
            accent: "gold",
            icon: <KpiGlyph name="charges" />,
          },
          {
            label: "Résultat",
            value: formatFcfa(data.totals.resultat),
            accent: data.totals.resultat < 0 ? "orange" : "green",
            tone: data.totals.resultat < 0 ? "warn" : "accent",
            icon: <KpiGlyph name="resultat" />,
          },
        ]}
      />

      <section className="panel dash-card dash-card-wide">
        <div className="panel-head">
          <h2 className="panel-title">CA · Charges · Résultat</h2>
          <p className="muted">Par mois sur l’année {data.year}</p>
        </div>
        <GroupedBarChart labels={labels} series={series} height={280} />
      </section>

      <div className="dash-bento">
        <section className="panel dash-card">
          <div className="panel-head">
            <h2 className="panel-title">Mix de l’année</h2>
            <p className="muted">Répartition du CA</p>
          </div>
          {mixTotal > 0 ? (
            <DonutChart
              slices={mixSlices.filter((s) => s.value > 0)}
              centerLabel="CA"
              centerValue={formatFcfa(data.totals.caTotal)}
            />
          ) : (
            <p className="muted">Pas encore de CA cette année.</p>
          )}
        </section>
        <section className="panel dash-card">
          <div className="panel-head">
            <h2 className="panel-title">Points de vente</h2>
            <p className="muted">Zogbo et Gbégamey</p>
          </div>
          {sites.some((s) => s.value > 0) ? (
            <HorizontalBars rows={sites} />
          ) : (
            <p className="muted">Pas encore de CA cette année.</p>
          )}
        </section>
      </div>

      <section className="panel dash-card dash-card-wide dash-rank-panel">
        <div className="panel-head">
          <h2 className="panel-title">Classements</h2>
          <p className="muted">Zones et produits sur l’année</p>
        </div>
        <ProductRanking
          best={ranking.best}
          worst={ranking.worst}
          sites={ranking.sites}
          plats={ranking.plats}
          accompagnements={ranking.accompagnements}
          boissons={ranking.boissons}
        />
      </section>

      <section className="panel dash-card dash-card-wide dash-months-panel">
        <div className="panel-head">
          <h2 className="panel-title">Mois de l’année</h2>
          <p className="muted">CA, charges et résultat</p>
        </div>
        <div className="dash-period-scroll">
          <table className="dash-period-table">
            <thead>
              <tr>
                <th scope="col">Mois</th>
                <th scope="col" className="col-num">
                  CA
                </th>
                <th scope="col" className="col-num">
                  Charges
                </th>
                <th scope="col" className="col-num">
                  Résultat
                </th>
                <th scope="col" className="col-num">
                  Jours
                </th>
                <th scope="col" className="col-act">
                  <span className="sr-only">Ouvrir</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.months.map((m) => (
                <tr
                  key={m.month}
                  className={m.daysWithData ? undefined : "is-empty"}
                >
                  <th scope="row">{MONTH_NAMES[m.month - 1]}</th>
                  <td className="mono col-num">{formatFcfa(m.caTotal)}</td>
                  <td className="mono col-num">
                    {formatFcfa(m.chargesTotal)}
                  </td>
                  <td
                    className={`mono col-num${m.resultat < 0 ? " is-neg" : m.resultat > 0 ? " is-pos" : ""}`}
                  >
                    {formatFcfa(m.resultat)}
                  </td>
                  <td className="mono col-num">{m.daysWithData}</td>
                  <td className="col-act">
                    <button
                      type="button"
                      className="btn-link"
                      onClick={() => onOpenMonth(m.month)}
                    >
                      Voir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
