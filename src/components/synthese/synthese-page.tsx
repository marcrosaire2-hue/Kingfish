"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ContextBar } from "@/components/context-bar";
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
import { emptyCharges } from "@/lib/synthese-calc";
import type {
  DayCharges,
  DayPoint,
  MonthPoint,
  ProductRanking as ProductRankingData,
  YearPoint,
} from "@/lib/types";
import { formatDisplayDate, todayIsoDate } from "@/lib/zogbo-calc";

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
  key: keyof Omit<DayCharges, "date" | "updatedAt" | "pertes">;
  label: string;
}[] = [
  { key: "matieresPremieres", label: "Achats matières 1ères" },
  { key: "loyer", label: "Charge locative" },
  { key: "salaires", label: "Salaires" },
  { key: "electricite", label: "Électricité" },
  { key: "carburant", label: "Carburant" },
  { key: "reparations", label: "Réparations / entretien" },
];

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
  const [caCumuls, setCaCumuls] = useState<{
    jour: number;
    mois: number;
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const qs =
          view === "day"
            ? `view=day&date=${encodeURIComponent(date)}`
            : view === "month"
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
            total: number;
          } | null) ?? null,
        );

        if (view === "day") {
          setDay(body.day as DayPoint);
          setChargesDraft((body.day as DayPoint).charges);
          setDirtyCharges(false);
          setMonthData(null);
          setYearData(null);
        } else if (view === "month") {
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
  }, [view, date, month, year]);

  const dayResultat = useMemo(() => {
    if (!day) return null;
    const chargesTotal = CHARGE_FIELDS.reduce(
      (s, f) => s + (Number(chargesDraft[f.key]) || 0),
      0,
    );
    return {
      chargesTotal,
      resultat: day.caTotal - chargesTotal,
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
    if (view === "day") {
      if (
        dirtyCharges &&
        !window.confirm("Charges non enregistrées. Changer de jour ?")
      ) {
        return;
      }
      setDate(next);
    } else if (view === "month") {
      setMonth(next);
    } else {
      setYear(next);
    }
  }

  return (
    <AppShell
      title="Tableau de bord"
      subtitle={`Vue d’ensemble ${APP_SITES_LABEL} — CA final Validé (hors annulées / en cours), mix, charges et résultat en FCFA.`}
    >
      <div className="section-tabs" role="tablist" aria-label="Période">
        {(
          [
            ["day", "Journalier"],
            ["month", "Mensuel"],
            ["year", "Annuel"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={view === key}
            className={`section-tab${view === key ? " is-active" : ""}`}
            onClick={() => setView(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <ContextBar
        date={view === "day" ? date : undefined}
        onDateChange={
          view === "day" ? (v) => handlePeriodChange(v) : undefined
        }
      >
        <ExportExcelButton
          onExport={() =>
            exportSyntheseExcel({
              view,
              date,
              month,
              year,
            })
          }
          disabled={loading}
        />
        {view === "month" ? (
          <label className="date-field date-field-pill">
            <span>Mois</span>
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </label>
        ) : null}
        {view === "year" ? (
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
        {view === "day" ? (
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
      </ContextBar>

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

      {!loading && caCumuls ? (
        <section className="dash-ca-final" aria-label="Chiffre d’affaires final">
          <div className="dash-ca-final-main">
            <span className="dash-ca-final-label">CA final</span>
            <strong className="dash-ca-final-value mono">
              {formatFcfa(
                cancelNotice?.caActif ??
                  (view === "day"
                    ? caCumuls.jour
                    : view === "month"
                      ? caCumuls.mois
                      : caCumuls.total),
              )}
            </strong>
            <span className="dash-ca-final-hint">
              {view === "day"
                ? "Jour sélectionné · Validé (comme AquaPro)"
                : view === "month"
                  ? "Mois sélectionné · Validé (comme AquaPro)"
                  : "Année / historique · Validé (comme AquaPro)"}
            </span>
          </div>
          <div className="dash-ca-final-side">
            <div>
              <span>Jour</span>
              <strong className="mono">{formatFcfa(caCumuls.jour)}</strong>
            </div>
            <div>
              <span>Mois</span>
              <strong className="mono">{formatFcfa(caCumuls.mois)}</strong>
            </div>
            <div>
              <span>Total</span>
              <strong className="mono">{formatFcfa(caCumuls.total)}</strong>
            </div>
          </div>
        </section>
      ) : null}

      {loading ? <p className="muted">Chargement du tableau de bord…</p> : null}

      {!loading && view === "day" && day ? (
        <DayDashboard
          day={day}
          ranking={ranking}
          chargesDraft={chargesDraft}
          dayResultat={dayResultat}
          onChargeChange={(key, value) => {
            setChargesDraft((prev) => ({ ...prev, [key]: value ?? 0 }));
            setDirtyCharges(true);
          }}
        />
      ) : null}

      {!loading && view === "month" && monthData ? (
        <MonthDashboard
          data={monthData}
          ranking={ranking}
          onOpenDay={(d) => {
            setDate(d);
            setView("day");
          }}
        />
      ) : null}

      {!loading && view === "year" && yearData ? (
        <YearDashboard
          data={yearData}
          ranking={ranking}
          onOpenMonth={(m) => {
            setMonth(`${yearData.year}-${String(m).padStart(2, "0")}`);
            setView("month");
          }}
        />
      ) : null}
    </AppShell>
  );
}

function KpiGrid({
  items,
}: {
  items: {
    label: string;
    value: string;
    tone?: "accent" | "warn" | "muted";
  }[];
}) {
  return (
    <div className="dash-kpi-grid">
      {items.map((it) => (
        <div
          key={it.label}
          className={`dash-kpi${it.tone ? ` dash-kpi-${it.tone}` : ""}`}
        >
          <span className="dash-kpi-label">{it.label}</span>
          <span className="dash-kpi-value mono">{it.value}</span>
        </div>
      ))}
    </div>
  );
}

function DayDashboard({
  day,
  ranking,
  chargesDraft,
  dayResultat,
  onChargeChange,
}: {
  day: DayPoint;
  ranking: ProductRankingData;
  chargesDraft: DayCharges;
  dayResultat: { chargesTotal: number; resultat: number } | null;
  onChargeChange: (
    key: keyof Omit<DayCharges, "date" | "updatedAt">,
    value: number | null,
  ) => void;
}) {
  const charges = dayResultat?.chargesTotal ?? day.chargesTotal;
  const resultat = dayResultat?.resultat ?? day.resultat;

  const mixSlices = [
    {
      key: "plats",
      label: "Plats",
      value: day.caZogboPlats + day.caGbegameyPlats,
      color: CHART_COLORS.plats,
    },
    {
      key: "combos",
      label: "Combos",
      value: day.caCombos,
      color: CHART_COLORS.combos,
    },
    {
      key: "boissons",
      label: "Boissons",
      value: day.caBoissons,
      color: CHART_COLORS.boissons,
    },
    {
      key: "extra",
      label: "Extra",
      value: day.caExtra,
      color: CHART_COLORS.extra,
    },
  ].filter((s) => s.value > 0);

  const sites = [
    {
      key: "zogbo",
      label: "Zogbo",
      value: day.caZogbo,
      color: CHART_COLORS.zogbo,
    },
    {
      key: "gbegamey",
      label: "Gbégamey",
      value: day.caGbegamey,
      color: CHART_COLORS.gbegamey,
    },
  ];

  const chargeBars = CHARGE_FIELDS.map((f) => ({
    key: f.key,
    label: f.label,
    value: Number(chargesDraft[f.key]) || 0,
    color: CHART_COLORS.charges,
  })).filter((r) => r.value > 0);

  return (
    <div className="dash">
      <p className="section-hint">
        <strong>{formatDisplayDate(day.date)}</strong>
        {" · "}
        Montants en FCFA
      </p>

      <KpiGrid
        items={[
          { label: "CA final", value: formatFcfa(day.caTotal), tone: "accent" },
          { label: "Point Zogbo", value: formatFcfa(day.caZogbo) },
          { label: "Point Gbégamey", value: formatFcfa(day.caGbegamey) },
          { label: "Marge boissons", value: formatFcfa(day.margeBoissons) },
          { label: "Charges", value: formatFcfa(charges) },
          {
            label: "Résultat",
            value: formatFcfa(resultat),
            tone: resultat < 0 ? "warn" : "accent",
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
          {mixSlices.length ? (
            <DonutChart
              slices={mixSlices}
              centerLabel="CA"
              centerValue={
                day.caTotal >= 1000
                  ? `${Math.round(day.caTotal / 1000)}k`
                  : String(day.caTotal)
              }
            />
          ) : (
            <p className="muted">Aucune vente enregistrée ce jour.</p>
          )}
        </section>

        <section className="panel dash-card">
          <h2 className="panel-title">Points de vente</h2>
          <HorizontalBars rows={sites} />
          <div className="dash-breakdown">
            <p>
              <strong>Zogbo</strong> — plats {formatFcfa(day.caZogboPlats)} ·
              combos {formatFcfa(day.caCombosZogbo)} · boissons{" "}
              {formatFcfa(day.caBoissonsZogbo)} · extra{" "}
              {formatFcfa(day.caExtraZogbo)}
            </p>
            <p>
              <strong>Gbégamey</strong> — plats{" "}
              {formatFcfa(day.caGbegameyPlats)} · combos{" "}
              {formatFcfa(day.caCombosGbegamey)} · boissons{" "}
              {formatFcfa(day.caBoissonsGbegamey)} · extra{" "}
              {formatFcfa(day.caExtraGbegamey)}
            </p>
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
      key: "combos",
      label: "Combos",
      value: data.totals.caCombos,
      color: CHART_COLORS.combos,
    },
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

      <KpiGrid
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
          <h2 className="panel-title">Combos · Boissons · Charges</h2>
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
                d.hasCombosData ||
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

      <KpiGrid
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

      <section className="panel panel-wide">
        <h2 className="panel-title">Mois de l’année</h2>
        <table className="data-table zogbo-table">
          <thead>
            <tr>
              <th scope="col">Mois</th>
              <th scope="col" className="col-money">
                CA
              </th>
              <th scope="col" className="col-money">
                Charges
              </th>
              <th scope="col" className="col-money">
                Résultat
              </th>
              <th scope="col" className="col-qty">
                Jours actifs
              </th>
              <th scope="col" className="col-actions">
                <span className="sr-only">Ouvrir</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.months.map((m) => (
              <tr key={m.month}>
                <td className="cell-name">{MONTH_NAMES[m.month - 1]}</td>
                <td className="mono cell-readonly">{formatFcfa(m.caTotal)}</td>
                <td className="mono cell-readonly">
                  {formatFcfa(m.chargesTotal)}
                </td>
                <td
                  className={`mono cell-readonly${m.resultat < 0 ? " cell-variance" : ""}`}
                >
                  {formatFcfa(m.resultat)}
                </td>
                <td className="mono cell-readonly">{m.daysWithData}</td>
                <td className="col-actions">
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
      </section>
    </div>
  );
}
