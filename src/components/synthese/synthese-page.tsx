"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { BrandLoader } from "@/components/brand-loader";
import {
  DashKpiGrid,
  DashboardShell,
  DashboardToolbar,
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
import { APP_SITES_LABEL } from "@/lib/brand";
import { exportSyntheseExcel } from "@/lib/page-exports";
import { chargesTotal, emptyCharges } from "@/lib/synthese-calc";
import type { EpuiseRow } from "@/lib/stock-repo";
import type {
  DayCharges,
  DayPoint,
  MonthPoint,
  ProductRanking as ProductRankingData,
  YearPoint,
} from "@/lib/types";
import { formatDisplayDate, todayIsoDate } from "@/lib/zogbo-calc";
import "@/components/synthese/synthese-dashboard.css";

type ViewKey = "day" | "month" | "year";

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

function mixFromDay(day: DayPoint) {
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
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const qs =
          viewMode === "day"
            ? `view=day&date=${encodeURIComponent(date)}`
            : viewMode === "month"
              ? `view=month&month=${encodeURIComponent(month)}`
              : `view=year&year=${encodeURIComponent(year)}`;

        const res = await fetch(`/api/synthese?${qs}`, { cache: "no-store" });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Erreur de chargement");

        if (cancelled) return;

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
  }, [viewMode, view, date, month, year, reloadTick]);

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
            `/api/synthese?view=day&date=${encodeURIComponent(date)}`,
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
  }, [viewMode, date, dirtyCharges]);

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
        body: JSON.stringify({ ...chargesDraft, date }),
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
  const status = caFinalStatus({ viewMode, cancelNotice });

  return (
    <AppShell
      title="Tableau de bord"
      subtitle={`Vue d’ensemble ${APP_SITES_LABEL}`}
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
        <div className="dash-hero">
          <DashboardToolbar
            tabs={
              !isGeneral
                ? [
                    { id: "day", label: "Journalier" },
                    { id: "month", label: "Mensuel" },
                    { id: "year", label: "Annuel" },
                  ]
                : [{ id: "day", label: "Jour" }]
            }
            activeTab={viewMode}
            onTabChange={(id) => {
              if (!isGeneral) setView(id as ViewKey);
            }}
            filters={
              <>
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
                <ExportExcelButton
                  onExport={exportBoard}
                  disabled={loading}
                />
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
              </>
            }
          />

          {!loading && caCumuls ? (
            <section
              className="dash-ca-final"
              aria-label="Chiffre d’affaires final"
            >
              <div className="dash-ca-final-main">
                <span className="dash-ca-final-label">CA final</span>
                <strong className="dash-ca-final-value mono">
                  {formatFcfa(
                    caFinalAmount({ viewMode, cancelNotice, caCumuls }),
                  )}
                </strong>
                <span
                  className={`dash-ca-final-hint is-${status.tone}`}
                >
                  {status.tone === "ok" ? (
                    <span className="dash-status-check" aria-hidden>
                      ✓
                    </span>
                  ) : null}
                  {status.label}
                </span>
              </div>
              {isGeneral ? null : (
                <div className="dash-ca-final-side">
                  <div>
                    <span>Jour</span>
                    <strong className="mono">
                      {formatFcfa(caCumuls.jour)}
                    </strong>
                  </div>
                  <div>
                    <span>Mois</span>
                    <strong className="mono">
                      {formatFcfa(caCumuls.mois)}
                    </strong>
                  </div>
                  <div>
                    <span>Total</span>
                    <strong className="mono">
                      {formatFcfa(caCumuls.total)}
                    </strong>
                  </div>
                </div>
              )}
            </section>
          ) : (
            <section
              className="dash-ca-final dash-ca-final-placeholder"
              aria-hidden
            >
              <div className="dash-ca-final-main">
                <span className="dash-ca-final-label">CA final</span>
                <strong className="dash-ca-final-value mono">…</strong>
                <span className="dash-ca-final-hint">Chargement…</span>
              </div>
            </section>
          )}
        </div>

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
        <BrandLoader variant="ligne" label="Chargement du tableau de bord…" />
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
      <p className="section-hint">
        <strong>{formatDisplayDate(day.date)}</strong>
        {" · "}
        Résumé des ventes de la journée, matin comme soir · FCFA
      </p>

      <DashKpiGrid
        className="dash-kpi-grid-day"
        items={[
          {
            label: "CA de la journée",
            value: formatFcfa(day.caTotal),
            accent: "green",
            icon: <KpiGlyph name="ca" />,
          },
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

      <div className="dash-grid">
        <section className="panel dash-card">
          <h2 className="panel-title">Mix des ventes (FCFA)</h2>
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
          <h2 className="panel-title">Points de vente</h2>
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

      <section className="panel dash-card dash-card-wide">
        <h2 className="panel-title">Ventes du jour</h2>
        <ProductRanking
          best={ranking.best}
          worst={ranking.worst}
          sites={ranking.sites}
          plats={ranking.plats}
          accompagnements={ranking.accompagnements}
          boissons={ranking.boissons}
        />
      </section>

      <EpuisesPanel epuises={epuises} />
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
      <p className="section-hint">
        <strong>{formatDisplayDate(day.date)}</strong>
        {" · "}
        Montants en FCFA
      </p>

      <DashKpiGrid
        className="dash-kpi-grid-day"
        items={[
          {
            label: "CA final",
            value: formatFcfa(day.caTotal),
            accent: "green",
            icon: <KpiGlyph name="ca" />,
          },
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

      <div className="dash-grid">
        <section className="panel dash-card">
          <h2 className="panel-title">Mix du jour (FCFA)</h2>
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
          <h2 className="panel-title">Points de vente</h2>
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

      <section className="panel dash-card dash-card-wide">
        <h2 className="panel-title">Tableaux de ventes</h2>
        <ProductRanking
          best={ranking.best}
          worst={ranking.worst}
          sites={ranking.sites}
          plats={ranking.plats}
          accompagnements={ranking.accompagnements}
          boissons={ranking.boissons}
        />
      </section>

      <div className="dash-grid">
        <section className="panel dash-card">
          <h2 className="panel-title">Répartition des charges</h2>
          {chargeBars.length ? (
            <HorizontalBars rows={chargeBars} />
          ) : (
            <p className="muted">Saisissez les charges ci-dessous.</p>
          )}
        </section>

        <section className="panel dash-card">
          <h2 className="panel-title">Saisie des charges (FCFA)</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Poste</th>
                <th scope="col" className="col-price">
                  Montant
                </th>
              </tr>
            </thead>
            <tbody>
              {CHARGE_FIELDS.map((f) => (
                <tr key={f.key}>
                  <td>{f.label}</td>
                  <td className="col-price">
                    <PriceInput
                      value={chargesDraft[f.key]}
                      ariaLabel={f.label}
                      onChange={(v) => onChargeChange(f.key, v)}
                    />
                  </td>
                </tr>
              ))}
              <tr>
                <td>Matières consommées (CMV)</td>
                <td className="mono cell-readonly">
                  {formatFcfa(day.charges.matieresConsommees ?? 0)}
                </td>
              </tr>
              <tr>
                <td>Dotations aux amortissements</td>
                <td className="mono cell-readonly">
                  {formatFcfa(day.charges.amortissements ?? 0)}
                </td>
              </tr>
              <tr>
                <td>Pertes déclarées</td>
                <td className="mono cell-readonly">
                  {formatFcfa(day.charges.pertes ?? 0)}
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">TOTAL CHARGES</th>
                <td className="mono">{formatFcfa(charges)}</td>
              </tr>
            </tfoot>
          </table>
        </section>
      </div>

      <EpuisesPanel epuises={epuises} />
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
  const mixSlices = [
    {
      key: "zogbo",
      label: "Zogbo",
      value: data.totals.caZogbo,
      color: CHART_COLORS.zogbo,
    },
    {
      key: "gbegamey",
      label: "Gbégamey",
      value: data.totals.caGbegamey,
      color: CHART_COLORS.gbegamey,
    },
  ].filter((s) => s.value > 0);

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

  return (
    <div className="dash">
      <p className="section-hint">
        <strong>
          {MONTH_NAMES[data.month - 1]} {data.year}
        </strong>
        {" · "}
        FCFA
      </p>

      <DashKpiGrid
        items={[
          {
            label: "CA final",
            value: formatFcfa(data.totals.caTotal),
            tone: "accent",
          },
          { label: "Zogbo", value: formatFcfa(data.totals.caZogbo) },
          { label: "Gbégamey", value: formatFcfa(data.totals.caGbegamey) },
          { label: "Charges", value: formatFcfa(data.totals.chargesTotal) },
          {
            label: "Résultat",
            value: formatFcfa(data.totals.resultat),
            tone: data.totals.resultat < 0 ? "warn" : "accent",
          },
        ]}
      />

      <div className="dash-grid dash-grid-wide">
        <section className="panel dash-card dash-card-wide">
          <h2 className="panel-title">Évolution du CA journalier</h2>
          <LineAreaChart labels={labels} series={caSeries} />
        </section>
      </div>

      <div className="dash-grid">
        <section className="panel dash-card dash-card-wide">
          <h2 className="panel-title">Zogbo vs Gbégamey par jour</h2>
          <GroupedBarChart labels={labels} series={sitesSeries} />
        </section>
      </div>

      <div className="dash-grid">
        <section className="panel dash-card">
          <h2 className="panel-title">Part des points</h2>
          {mixSlices.length ? (
            <DonutChart
              slices={mixSlices}
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
          <h2 className="panel-title">Boissons · Charges</h2>
          <HorizontalBars rows={categoryBars} />
        </section>
      </div>

      <section className="panel dash-card dash-card-wide">
        <h2 className="panel-title">Tableaux de ventes (mois)</h2>
        <ProductRanking
          best={ranking.best}
          worst={ranking.worst}
          sites={ranking.sites}
          plats={ranking.plats}
          accompagnements={ranking.accompagnements}
          boissons={ranking.boissons}
        />
      </section>

      <section className="panel panel-wide">
        <h2 className="panel-title">Détail des jours</h2>
        <table className="data-table zogbo-table">
          <thead>
            <tr>
              <th scope="col">Jour</th>
              <th scope="col" className="col-money">
                Zogbo
              </th>
              <th scope="col" className="col-money">
                Gbégamey
              </th>
              <th scope="col" className="col-money">
                CA
              </th>
              <th scope="col" className="col-money">
                Résultat
              </th>
              <th scope="col" className="col-actions">
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
                <tr key={d.date} className={active ? undefined : "row-muted"}>
                  <td className="cell-name">{d.date.slice(8)}</td>
                  <td className="mono cell-readonly">{formatFcfa(d.caZogbo)}</td>
                  <td className="mono cell-readonly">
                    {formatFcfa(d.caGbegamey)}
                  </td>
                  <td className="mono cell-readonly">{formatFcfa(d.caTotal)}</td>
                  <td
                    className={`mono cell-readonly${d.resultat < 0 ? " cell-variance" : ""}`}
                  >
                    {formatFcfa(d.resultat)}
                  </td>
                  <td className="col-actions">
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

  return (
    <div className="dash">
      <p className="section-hint">
        <strong>Année {data.year}</strong>
        {" · "}
        FCFA
      </p>

      <DashKpiGrid
        items={[
          {
            label: "CA final",
            value: formatFcfa(data.totals.caTotal),
            tone: "accent",
          },
          { label: "Charges", value: formatFcfa(data.totals.chargesTotal) },
          {
            label: "Résultat",
            value: formatFcfa(data.totals.resultat),
            tone: data.totals.resultat < 0 ? "warn" : "accent",
          },
        ]}
      />

      <section className="panel dash-card dash-card-wide">
        <h2 className="panel-title">CA · Charges · Résultat par mois</h2>
        <GroupedBarChart labels={labels} series={series} height={280} />
      </section>

      <section className="panel dash-card dash-card-wide">
        <h2 className="panel-title">Tableaux de ventes (année)</h2>
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
        <div className="panel-head dash-months-head">
          <h2 className="panel-title">Mois de l’année</h2>
          <p className="muted">CA, charges et résultat — cliquez Voir pour le détail</p>
        </div>
        <ul className="dash-month-list">
          {data.months.map((m) => (
            <li key={m.month} className="dash-month-card">
              <div className="dash-month-top">
                <strong className="dash-month-name">
                  {MONTH_NAMES[m.month - 1]}
                </strong>
                <button
                  type="button"
                  className="btn-link dash-month-voir"
                  onClick={() => onOpenMonth(m.month)}
                >
                  Voir
                </button>
              </div>
              <dl className="dash-month-metrics">
                <div>
                  <dt>CA</dt>
                  <dd className="mono">{formatFcfa(m.caTotal)}</dd>
                </div>
                <div>
                  <dt>Charges</dt>
                  <dd className="mono">{formatFcfa(m.chargesTotal)}</dd>
                </div>
                <div>
                  <dt>Résultat</dt>
                  <dd
                    className={`mono${m.resultat < 0 ? " is-neg" : m.resultat > 0 ? " is-pos" : ""}`}
                  >
                    {formatFcfa(m.resultat)}
                  </dd>
                </div>
                <div>
                  <dt>Jours actifs</dt>
                  <dd className="mono">{m.daysWithData}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
