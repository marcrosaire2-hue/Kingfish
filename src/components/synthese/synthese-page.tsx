"use client";

import { useLiveRefresh } from "@/lib/use-live-refresh";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ExportExcelButton } from "@/components/export-excel-button";
import { PriceInput } from "@/components/parametres/price-input";
import {
  AreaChart,
  Donut,
  KpiCard,
  RankTable,
  type DonutSlice,
  type KpiTone,
} from "@/components/synthese/pro-widgets";
import { formatFcfa } from "@/lib/format";
import { exportSyntheseExcel } from "@/lib/page-exports";
import { chargesTotal, emptyCharges } from "@/lib/synthese-calc";
import type {
  DayCharges,
  DayPoint,
  MonthPoint,
  ProductRanking as ProductRankingData,
  VenteSite,
  YearPoint,
} from "@/lib/types";
import { formatDisplayDate, todayIsoDate } from "@/lib/zogbo-calc";
import "@/components/synthese/dashboard-pro.css";

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
  // Même valeur côté serveur et navigateur au premier rendu ; le site mémorisé
  // est rétabli juste après (évite l'erreur d'hydratation et le clignotement).
  const [site, setSite] = useState<VenteSite>("zogbo");
  const [allowedSites, setAllowedSites] = useState<VenteSite[]>([
    "zogbo",
    "gbegamey",
  ]);
  const [lockedSite, setLockedSite] = useState(false);

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
  const [, setCaCumuls] = useState<{
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
  // Rafraîchissement automatique : sans repasser par l'écran de chargement.
  const silentRef = useRef(false);
  useLiveRefresh(() => {
    silentRef.current = true;
    setReloadTick((n) => n + 1);
  });

  const isGeneral = role !== null && role !== "admin" && role !== "daf" && role !== "comptable";
  const viewMode = isGeneral ? "day" : view;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSite(readStoredDashSite());
  }, []);

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
      if (!silentRef.current) setLoading(true);
      silentRef.current = false;
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
          setMonthData(null);
          setYearData(null);
        } else if (viewMode === "month") {
          setMonthData(body.month as MonthPoint);
          setDay(null);
          setYearData(null);
        } else {
          setYearData(body.year as YearPoint);
          setDay(null);
          setMonthData(null);
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

  const siteLabel = site === "zogbo" ? "Zogbo" : "Gbégamey";
  const status = caFinalStatus({ viewMode, cancelNotice });
  const headerPeriodLabel =
    viewMode === "day"
      ? formatDisplayDate(date)
      : viewMode === "month"
        ? `${MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? ""} ${month.slice(0, 4)}`
        : year;
  const periodWord =
    viewMode === "day" ? "du jour" : viewMode === "month" ? "du mois" : "de l’année";

  const mix: MixSlice[] =
    viewMode === "day" && day
      ? mixFromDay(day)
      : viewMode === "month" && monthData
        ? mixFromPeriodTotals(monthData.totals)
        : viewMode === "year" && yearData
          ? mixFromPeriodTotals(yearData.totals)
          : [];

  const totals =
    viewMode === "day" && day
      ? {
          ca: day.caTotal,
          charges: dayResultat?.chargesTotal ?? day.chargesTotal,
          resultat: dayResultat?.resultat ?? day.resultat,
        }
      : viewMode === "month" && monthData
        ? {
            ca: monthData.totals.caTotal,
            charges: monthData.totals.chargesTotal,
            resultat: monthData.totals.resultat,
          }
        : viewMode === "year" && yearData
          ? {
              ca: yearData.totals.caTotal,
              charges: yearData.totals.chargesTotal,
              resultat: yearData.totals.resultat,
            }
          : { ca: 0, charges: 0, resultat: 0 };
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

  const ico = {
    ca: <path d="M4 16.5 9 11l4 3.5 7-9M4 20h16" />,
    charges: (
      <>
        <rect x="4" y="4" width="16" height="16" rx="3" />
        <path d="M8 9h8M8 12.5h8M8 16h5" />
      </>
    ),
    resultat: <path d="M12 3v18M16.5 7.5c-.8-1.2-2.4-2-4.5-2-2.7 0-4 1.3-4 3s1.3 2.4 4 3 4 1.4 4 3.2-1.5 3.3-4.5 3.3c-2.2 0-3.9-.8-4.8-2.2" />,
    cal: (
      <>
        <rect x="4" y="5.5" width="16" height="14.5" rx="2.5" />
        <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
      </>
    ),
    sun: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" />
      </>
    ),
    moon: <path d="M15.5 13.5A6 6 0 0 1 10 5.2 6.2 6.2 0 1 0 18.8 14a6 6 0 0 1-3.3-.5Z" />,
  };

  const activeDays =
    viewMode === "month" && monthData
      ? monthData.days.filter(
          (d) =>
            d.hasZogboData || d.hasGbegameyData || d.hasBoissonsData || d.chargesTotal > 0,
        ).length
      : viewMode === "year" && yearData
        ? yearData.months.reduce((s, m) => s + m.daysWithData, 0)
        : 0;

  const kpis: {
    label: string;
    value: number;
    suffix?: string;
    sub?: string;
    tone: KpiTone;
    icon: React.ReactNode;
  }[] = isGeneral
    ? [
        {
          label: "CA du jour",
          value: day?.caTotal ?? 0,
          sub: siteLabel,
          tone: "blue",
          icon: ico.ca,
        },
        {
          label: "CA du matin",
          value: shiftTotals?.jour ?? 0,
          sub: "Équipe du matin",
          tone: "amber",
          icon: ico.sun,
        },
        {
          label: "CA du soir",
          value: shiftTotals?.soir ?? 0,
          sub: "Équipe du soir",
          tone: "violet",
          icon: ico.moon,
        },
        {
          label: "CA de la nuit",
          value: shiftTotals?.nuit ?? 0,
          sub: "Équipe de nuit",
          tone: "slate",
          icon: ico.moon,
        },
      ]
    : [
        {
          label: "Chiffre d’affaires",
          value: totals.ca,
          sub: siteLabel,
          tone: "blue",
          icon: ico.ca,
        },
        {
          label: "Charges",
          value: totals.charges,
          sub: `${pct(totals.charges, totals.ca)} % du chiffre d’affaires`,
          tone: "amber",
          icon: ico.charges,
        },
        {
          label: "Résultat",
          value: totals.resultat,
          sub: totals.ca
            ? `Marge de ${pct(totals.resultat, totals.ca)} %`
            : "Aucune vente sur la période",
          tone: totals.resultat < 0 ? "red" : "green",
          icon: ico.resultat,
        },
        viewMode === "day"
          ? {
              label: "Marge boissons",
              value: day?.margeBoissons ?? 0,
              sub: "Ventes moins coût d’achat",
              tone: "violet" as KpiTone,
              icon: ico.cal,
            }
          : {
              label: "Jours d’activité",
              value: activeDays,
              suffix: "jours",
              sub: `Période ${periodWord}`,
              tone: "violet" as KpiTone,
              icon: ico.cal,
            },
      ];

  const CHARGE_COLORS = ["#075ea8", "#f5b400", "#1fb99a", "#7c5cbf", "#e67e22", "#d6455d", "#4a6590", "#2a7ec8", "#8aa4c2", "#0d8a62"];
  const chargeSlices: DonutSlice[] =
    viewMode === "day" && day
      ? [
          { key: "mat", label: "Matières", value: (day.charges.matieresConsommees ?? 0) > 0 ? day.charges.matieresConsommees ?? 0 : chargesDraft.matieresPremieres },
          { key: "loyer", label: "Charge locative", value: chargesDraft.loyer },
          { key: "sal", label: "Salaires", value: chargesDraft.salaires },
          { key: "elec", label: "Électricité", value: chargesDraft.electricite },
          { key: "carb", label: "Carburant", value: chargesDraft.carburant },
          { key: "rep", label: "Réparations", value: chargesDraft.reparations },
          { key: "pertes", label: "Pertes", value: day.charges.pertes ?? 0 },
          { key: "cmvb", label: "CMV boissons", value: day.charges.cmvBoissons ?? 0 },
          { key: "emb", label: "Emballages", value: day.charges.cmvEmballages ?? 0 },
          { key: "amort", label: "Amortissements", value: day.charges.amortissements ?? 0 },
        ]
          .filter((s) => s.value > 0)
          .map((s, i) => ({ ...s, color: CHARGE_COLORS[i % CHARGE_COLORS.length]! }))
      : [];

  const chartLabels =
    viewMode === "month" && monthData
      ? monthData.days.map((d) => shortDay(d.date))
      : viewMode === "year" && yearData
        ? yearData.months.map((m) => MONTH_NAMES[m.month - 1]!.slice(0, 3))
        : [];
  const chartSeries =
    viewMode === "month" && monthData
      ? [
          { key: "ca", label: "Chiffre d’affaires", color: "#075ea8", values: monthData.days.map((d) => d.caTotal) },
          { key: "res", label: "Résultat", color: "#1fb99a", values: monthData.days.map((d) => Math.max(0, d.resultat)) },
        ]
      : viewMode === "year" && yearData
        ? [
            { key: "ca", label: "Chiffre d’affaires", color: "#075ea8", values: yearData.months.map((m) => m.caTotal) },
            { key: "ch", label: "Charges", color: "#f5b400", values: yearData.months.map((m) => m.chargesTotal) },
            { key: "res", label: "Résultat", color: "#1fb99a", values: yearData.months.map((m) => Math.max(0, m.resultat)) },
          ]
        : [];

  const hasPeriodData =
    (viewMode === "day" && !!day) ||
    (viewMode === "month" && !!monthData) ||
    (viewMode === "year" && !!yearData);
  const mixTotal = mix.reduce((s, x) => s + x.value, 0);
  const siteVariance =
    day && !isGeneral
      ? (site === "zogbo" ? day.varianceZogbo : day.varianceGbegamey) +
        day.varianceBoissons
      : 0;

  const rankBest = ranking.best.slice(0, 6);
  const rankWorst = ranking.worst.slice(0, 6);

  return (
    <AppShell
      title="Tableau de bord"
      subtitle={`${siteLabel} · ${headerPeriodLabel}`}
      mainClassName="main-dash"
      actions={
        <>
          <ExportExcelButton
            label="Exporter Excel"
            className="btn btn-ghost"
            onExport={exportBoard}
            disabled={loading}
          />
          <button
            type="button"
            className="pd-refresh"
            aria-label="Actualiser"
            title="Actualiser"
            disabled={loading}
            onClick={() => setReloadTick((n) => n + 1)}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M20 12a8 8 0 1 1-2.2-5.5M20 4v6h-6" />
            </svg>
          </button>
        </>
      }
    >
      <div className="pd">
        <div className="pd-toolbar">
          <div className="pd-tabs" role="tablist" aria-label="Période">
            {(!isGeneral
              ? [
                  { id: "day" as const, label: "Jour" },
                  { id: "month" as const, label: "Mois" },
                  { id: "year" as const, label: "Année" },
                ]
              : [{ id: "day" as const, label: "Jour" }]
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={viewMode === t.id}
                className={viewMode === t.id ? "is-active" : undefined}
                onClick={() => {
                  if (!isGeneral) setView(t.id);
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {!lockedSite && allowedSites.length > 1 ? (
            <div className="pd-tabs" role="group" aria-label="Point de vente">
              {allowedSites.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={site === s ? "is-active" : undefined}
                  onClick={() => {
                    if (
                      dirtyCharges &&
                      !window.confirm("Charges non enregistrées. Changer de site ?")
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

          <label className="pd-date">
            <span>Date</span>
            <input
              type="date"
              value={
                viewMode === "day"
                  ? date
                  : viewMode === "month"
                    ? date.slice(0, 7) === month
                      ? date
                      : `${month}-01`
                    : date.slice(0, 4) === year
                      ? date
                      : `${year}-01-01`
              }
              max={todayIsoDate()}
              onChange={(e) => {
                const v = e.target.value;
                if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
                if (viewMode === "day") {
                  handlePeriodChange(v);
                } else {
                  setDate(v);
                  setMonth(v.slice(0, 7));
                  setYear(v.slice(0, 4));
                }
              }}
            />
          </label>

          <span className={`pd-status is-${status.tone}`}>
            <i aria-hidden />
            {loading ? "Chargement…" : status.label}
          </span>
        </div>

        {error ? (
          <p className="pd-alert is-error" role="alert">
            {error}
          </p>
        ) : null}

        {!loading && viewMode !== "year" && cancelNotice && cancelNotice.caAnnule > 0 ? (
          <p className="pd-alert" role="status">
            <b>CA validé uniquement</b> · {formatFcfa(cancelNotice.caActif)} comptabilisé ·{" "}
            {formatFcfa(cancelNotice.caAnnule)} exclus ({cancelNotice.nAnnule} ligne
            {cancelNotice.nAnnule > 1 ? "s" : ""} annulée{cancelNotice.nAnnule > 1 ? "s" : ""} ou en cours)
          </p>
        ) : null}

        {siteVariance > 0 ? (
          <p className="pd-alert is-warn" role="status">
            <b>Écarts de stock</b> détectés aujourd’hui sur {siteLabel} : {siteVariance} unité
            {siteVariance > 1 ? "s" : ""} (plats, accompagnements et boissons).
          </p>
        ) : null}

        <section className="pd-kpis" aria-label="Indicateurs clés">
          {kpis.map((k, i) => (
            <KpiCard
              key={k.label}
              index={i}
              loading={loading || !hasPeriodData}
              label={k.label}
              value={k.value}
              suffix={k.suffix}
              sub={k.sub}
              tone={k.tone}
              icon={k.icon}
            />
          ))}
        </section>

        <div className="pd-row pd-row-main">
          <section className="pd-card" style={{ ["--i" as string]: 4 }}>
            <header className="pd-card-head">
              <div>
                <h2>
                  {viewMode === "day"
                    ? "Chiffre d’affaires par catégorie"
                    : "Évolution du chiffre d’affaires"}
                </h2>
                <p>
                  {viewMode === "day"
                    ? `${siteLabel} · ${headerPeriodLabel}`
                    : viewMode === "month"
                      ? "Jour par jour"
                      : "Mois par mois"}
                </p>
              </div>
            </header>
            {loading || !hasPeriodData ? (
              <div className="pd-skel pd-skel-chart" />
            ) : viewMode === "day" ? (
              <RankTable
                rows={mix
                  .filter((m) => m.value > 0)
                  .sort((a, b) => b.value - a.value)
                  .map((m) => ({ name: m.label, ca: m.value }))}
                color="#075ea8"
                empty="Aucune vente enregistrée ce jour."
              />
            ) : (
              <AreaChart labels={chartLabels} series={chartSeries} />
            )}
          </section>

          <section className="pd-card" style={{ ["--i" as string]: 5 }}>
            <header className="pd-card-head">
              <div>
                <h2>{viewMode === "day" ? "Répartition des charges" : "Répartition du CA"}</h2>
                <p>{viewMode === "day" ? "Postes renseignés" : "Par catégorie"}</p>
              </div>
            </header>
            {loading || !hasPeriodData ? (
              <div className="pd-skel pd-skel-chart" />
            ) : viewMode === "day" ? (
              chargeSlices.length ? (
                <Donut
                  slices={chargeSlices}
                  centerLabel="Charges"
                  centerValue={formatFcfa(totals.charges)}
                />
              ) : (
                <p className="pd-empty">Aucune charge saisie pour ce jour.</p>
              )
            ) : mixTotal > 0 ? (
              <Donut
                slices={mix.filter((s) => s.value > 0)}
                centerLabel="CA"
                centerValue={formatFcfa(totals.ca)}
              />
            ) : (
              <p className="pd-empty">Aucune vente sur la période.</p>
            )}
          </section>
        </div>

        <div className="pd-row pd-row-halves">
          <section className="pd-card" style={{ ["--i" as string]: 6 }}>
            <header className="pd-card-head">
              <div>
                <h2>Meilleures ventes</h2>
                <p>Produits qui rapportent le plus · {siteLabel}</p>
              </div>
            </header>
            {loading ? (
              <div className="pd-skel pd-skel-chart" />
            ) : (
              <RankTable rows={rankBest} color="#1fb99a" empty="Aucune vente sur la période." />
            )}
          </section>
          <section className="pd-card" style={{ ["--i" as string]: 7 }}>
            <header className="pd-card-head">
              <div>
                <h2>Moins vendus</h2>
                <p>Produits à surveiller · {siteLabel}</p>
              </div>
            </header>
            {loading ? (
              <div className="pd-skel pd-skel-chart" />
            ) : (
              <RankTable rows={rankWorst} color="#f5b400" empty="Aucune vente sur la période." />
            )}
          </section>
        </div>

        {!loading && !isGeneral && viewMode === "month" && monthData ? (
          <section className="pd-card" style={{ ["--i" as string]: 8 }}>
            <header className="pd-card-head">
              <div>
                <h2>Détail par jour</h2>
                <p>Chiffre d’affaires, charges et résultat</p>
              </div>
            </header>
            <div className="pd-table-wrap">
              <table className="pd-table">
                <thead>
                  <tr>
                    <th>Jour</th>
                    <th className="n">Chiffre d’affaires</th>
                    <th className="n">Charges</th>
                    <th className="n">Résultat</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {monthData.days.map((d) => {
                    const active =
                      d.hasZogboData || d.hasGbegameyData || d.hasBoissonsData || d.chargesTotal > 0;
                    return (
                      <tr key={d.date} className={active ? undefined : "is-empty"}>
                        <td>
                          <b>{shortDay(d.date)}</b>{" "}
                          <span className="pd-muted">{weekdayShort(d.date)}</span>
                        </td>
                        <td className="n">{formatFcfa(d.caTotal)}</td>
                        <td className="n">{formatFcfa(d.chargesTotal)}</td>
                        <td className={`n${d.resultat < 0 ? " is-neg" : d.resultat > 0 ? " is-pos" : ""}`}>
                          {formatFcfa(d.resultat)}
                        </td>
                        <td className="n">
                          <button
                            type="button"
                            className="pd-link"
                            onClick={() => {
                              setDate(d.date);
                              setView("day");
                            }}
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
        ) : null}

        {!loading && !isGeneral && viewMode === "year" && yearData ? (
          <section className="pd-card" style={{ ["--i" as string]: 8 }}>
            <header className="pd-card-head">
              <div>
                <h2>Détail par mois</h2>
                <p>Année {yearData.year}</p>
              </div>
            </header>
            <div className="pd-table-wrap">
              <table className="pd-table">
                <thead>
                  <tr>
                    <th>Mois</th>
                    <th className="n">Chiffre d’affaires</th>
                    <th className="n">Charges</th>
                    <th className="n">Résultat</th>
                    <th className="n">Jours actifs</th>
                  </tr>
                </thead>
                <tbody>
                  {yearData.months.map((m) => (
                    <tr key={m.month} className={m.daysWithData ? undefined : "is-empty"}>
                      <td>
                        <b>{MONTH_NAMES[m.month - 1]}</b>
                      </td>
                      <td className="n">{formatFcfa(m.caTotal)}</td>
                      <td className="n">{formatFcfa(m.chargesTotal)}</td>
                      <td className={`n${m.resultat < 0 ? " is-neg" : m.resultat > 0 ? " is-pos" : ""}`}>
                        {formatFcfa(m.resultat)}
                      </td>
                      <td className="n">{m.daysWithData}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {!loading && !isGeneral && viewMode === "day" && day ? (
          <section id="dash-charges" className="pd-card" style={{ ["--i" as string]: 8 }}>
            <header className="pd-card-head">
              <div>
                <h2>Saisie des charges</h2>
                <p>Montants en FCFA · {formatDisplayDate(date)}</p>
              </div>
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
                      ? "Enregistrer les charges"
                      : "À jour"}
              </button>
            </header>
            <div className="pd-charges">
              {CHARGE_FIELDS.map((f) => (
                <label key={f.key} className="pd-charge">
                  <span>{f.label}</span>
                  <PriceInput
                    value={chargesDraft[f.key]}
                    ariaLabel={f.label}
                    onChange={(v) => {
                      setChargesDraft((prev) => ({ ...prev, [f.key]: v ?? 0 }));
                      setDirtyCharges(true);
                    }}
                  />
                </label>
              ))}
              <div className="pd-charge is-readonly">
                <span>Matières consommées (CMV)</span>
                <b>{formatFcfa(day.charges.matieresConsommees ?? 0)}</b>
              </div>
              <div className="pd-charge is-readonly">
                <span>Dotations aux amortissements</span>
                <b>{formatFcfa(day.charges.amortissements ?? 0)}</b>
              </div>
              <div className="pd-charge is-readonly">
                <span>Pertes déclarées</span>
                <b>{formatFcfa(day.charges.pertes ?? 0)}</b>
              </div>
              <div className="pd-charge is-total">
                <span>Total des charges</span>
                <b>{formatFcfa(totals.charges)}</b>
              </div>
            </div>
          </section>
        ) : null}

      </div>
    </AppShell>
  );
}
