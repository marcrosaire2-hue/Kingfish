"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ContextBar } from "@/components/context-bar";
import { ExportExcelButton } from "@/components/export-excel-button";
import { PriceInput } from "@/components/parametres/price-input";
import { CAISSE_LABELS, CAISSES } from "@/lib/caisse-model";
import {
  downloadExcel,
  excelFilename,
} from "@/lib/export-excel";
import { formatFcfa } from "@/lib/format";
import { emptyCharges } from "@/lib/synthese-calc";
import type {
  CaisseKey,
  DayCharges,
  DayPoint,
  MonthPoint,
  YearPoint,
} from "@/lib/types";
import { formatDisplayDate, todayIsoDate } from "@/lib/zogbo-calc";
import { BrandLoader } from "@/components/brand-loader";

type ViewKey = "day" | "month" | "year";

type Payload = {
  view: ViewKey;
  label: string;
  date?: string;
  month?: string;
  year?: number;
  day?: DayPoint;
  data?: MonthPoint | YearPoint;
  caisseDepenses: number;
  caisseRecettes: number;
  caisseSessions: number;
  caisseParCaisse: { caisse: CaisseKey; totalDepense: number; totalRecette: number; sessions: number }[];
  matieresPurchasesToday?: number;
};

const CHARGE_FIELDS: {
  // « pertes » est calculé depuis le journal des pertes : jamais saisi ici.
  key: keyof Omit<DayCharges, "date" | "updatedAt" | "pertes">;
  label: string;
}[] = [
  { key: "matieresPremieres", label: "Achats matières premières" },
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

type StatementLine = {
  label: string;
  amount: number;
  kind: "item" | "subtotal" | "result" | "info";
};

type Statement = {
  title: string;
  produits: StatementLine[];
  charges: StatementLine[];
  resultat: StatementLine[];
  caTotal: number;
  chargesTotal: number;
  resultatAmount: number;
};

function buildDayStatement(day: DayPoint, date: string): Statement {
  // Les combos ne sont plus vendus : le compte de résultat les exclut des
  // produits (le journal les garde pour l'historique).
  const produitsTotal = day.caTotal - day.caCombos;
  return {
    title: `Compte de résultat — ${formatDisplayDate(date)}`,
    produits: [
      { label: "CA plats Zogbo", amount: day.caZogboPlats, kind: "item" },
      { label: "CA plats Gbégamey", amount: day.caGbegameyPlats, kind: "item" },
      {
        label: "CA accompagnements Zogbo",
        amount: day.caAccompagnementsZogbo,
        kind: "item",
      },
      {
        label: "CA accompagnements Gbégamey",
        amount: day.caAccompagnementsGbegamey,
        kind: "item",
      },
      {
        label: "CA boissons Zogbo",
        amount: day.caBoissonsZogbo,
        kind: "item",
      },
      {
        label: "CA boissons Gbégamey",
        amount: day.caBoissonsGbegamey,
        kind: "item",
      },
      { label: "CA extra Zogbo", amount: day.caExtraZogbo, kind: "item" },
      {
        label: "CA extra Gbégamey",
        amount: day.caExtraGbegamey,
        kind: "item",
      },
      {
        label: "Total produits d’exploitation",
        amount: produitsTotal,
        kind: "subtotal",
      },
    ],
    charges: [
      {
        label: "Achats matières premières",
        amount: day.charges.matieresPremieres,
        kind: "item",
      },
      { label: "Charge locative", amount: day.charges.loyer, kind: "item" },
      { label: "Salaires", amount: day.charges.salaires, kind: "item" },
      { label: "Électricité", amount: day.charges.electricite, kind: "item" },
      { label: "Carburant", amount: day.charges.carburant, kind: "item" },
      {
        label: "Réparations / entretien",
        amount: day.charges.reparations,
        kind: "item",
      },
      {
        label: "Pertes déclarées",
        amount: day.charges.pertes ?? 0,
        kind: "item",
      },
      {
        label: "Total charges d’exploitation",
        amount: day.chargesTotal,
        kind: "subtotal",
      },
    ],
    resultat: [
      {
        label: "Résultat d’exploitation",
        amount: produitsTotal - day.chargesTotal,
        kind: "result",
      },
      {
        label: "Marge boissons (indicatif)",
        amount: day.margeBoissons,
        kind: "info",
      },
    ],
    caTotal: produitsTotal,
    chargesTotal: day.chargesTotal,
    resultatAmount: produitsTotal - day.chargesTotal,
  };
}

function buildMonthStatement(data: MonthPoint, label: string): Statement {
  const t = data.totals;
  // Les combos sont exclus des produits (arrêtés à la vente).
  const produitsTotal = t.caTotal - t.caCombos;
  return {
    title: `Compte de résultat — ${label}`,
    produits: [
      { label: "CA plats Zogbo", amount: t.caPlatsZogbo, kind: "item" },
      { label: "CA plats Gbégamey", amount: t.caPlatsGbegamey, kind: "item" },
      {
        label: "CA accompagnements Zogbo",
        amount: t.caAccompagnementsZogbo,
        kind: "item",
      },
      {
        label: "CA accompagnements Gbégamey",
        amount: t.caAccompagnementsGbegamey,
        kind: "item",
      },
      {
        label: "CA boissons Zogbo",
        amount: t.caBoissonsZogbo,
        kind: "item",
      },
      {
        label: "CA boissons Gbégamey",
        amount: t.caBoissonsGbegamey,
        kind: "item",
      },
      { label: "CA extra Zogbo", amount: t.caExtraZogbo, kind: "item" },
      { label: "CA extra Gbégamey", amount: t.caExtraGbegamey, kind: "item" },
      {
        label: "Total produits d’exploitation",
        amount: produitsTotal,
        kind: "subtotal",
      },
    ],
    charges: [
      {
        label: "Total charges d’exploitation",
        amount: t.chargesTotal,
        kind: "subtotal",
      },
    ],
    resultat: [
      {
        label: "Résultat d’exploitation",
        amount: produitsTotal - t.chargesTotal,
        kind: "result",
      },
    ],
    caTotal: produitsTotal,
    chargesTotal: t.chargesTotal,
    resultatAmount: produitsTotal - t.chargesTotal,
  };
}

function buildYearStatement(data: YearPoint, label: string): Statement {
  const t = data.totals;
  // Les combos sont exclus des produits (arrêtés à la vente).
  const produitsTotal = t.caTotal - t.caCombos;
  return {
    title: `Compte de résultat — ${label}`,
    produits: [
      {
        label: "Total produits d’exploitation (CA hors combos)",
        amount: produitsTotal,
        kind: "subtotal",
      },
    ],
    charges: [
      {
        label: "Total charges d’exploitation",
        amount: t.chargesTotal,
        kind: "subtotal",
      },
    ],
    resultat: [
      {
        label: "Résultat d’exploitation",
        amount: produitsTotal - t.chargesTotal,
        kind: "result",
      },
    ],
    caTotal: produitsTotal,
    chargesTotal: t.chargesTotal,
    resultatAmount: produitsTotal - t.chargesTotal,
  };
}

export function CompteResultatPage() {
  const [view, setView] = useState<ViewKey>("day");
  const [date, setDate] = useState(() => todayIsoDate());
  const [month, setMonth] = useState(currentMonth);
  const [year, setYear] = useState(() => String(new Date().getFullYear()));
  const [payload, setPayload] = useState<Payload | null>(null);
  const [chargesDraft, setChargesDraft] = useState<DayCharges>(
    emptyCharges(date),
  );
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const qs =
        view === "day"
          ? `view=day&date=${encodeURIComponent(date)}`
          : view === "month"
            ? `view=month&month=${encodeURIComponent(month)}`
            : `view=year&year=${encodeURIComponent(year)}`;
      const res = await fetch(`/api/compte-resultat?${qs}`, {
        cache: "no-store",
      });
      const body = (await res.json()) as Payload & { error?: string };
      if (!res.ok) throw new Error(body.error || "Erreur");
      setPayload(body);
      if (body.view === "day" && body.day) {
        setChargesDraft(body.day.charges);
        setDirty(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, date, month, year]);

  const statement = useMemo((): Statement | null => {
    if (!payload) return null;
    if (payload.view === "day" && payload.day) {
      return buildDayStatement(payload.day, payload.date || date);
    }
    if (payload.view === "month" && payload.data) {
      return buildMonthStatement(payload.data as MonthPoint, payload.label);
    }
    if (payload.view === "year" && payload.data) {
      return buildYearStatement(payload.data as YearPoint, payload.label);
    }
    return null;
  }, [payload, date]);

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
      setDirty(false);
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1800);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSaving(false);
    }
  }

  function exportExcel() {
    if (!payload || !statement) return;
    const rows = [
      ...statement.produits.map((l) => ({ Poste: l.label, Montant: l.amount })),
      ...statement.charges.map((l) => ({ Poste: l.label, Montant: l.amount })),
      ...statement.resultat.map((l) => ({ Poste: l.label, Montant: l.amount })),
      {
        Poste: "Dépenses caisse (info, hors résultat)",
        Montant: payload.caisseDepenses,
      },
      {
        Poste: "Autres recettes caisse (info)",
        Montant: payload.caisseRecettes,
      },
    ];
    downloadExcel(
      excelFilename(
        "compte-resultat",
        payload.view === "day"
          ? payload.date
          : payload.view === "month"
            ? payload.month
            : String(payload.year),
      ),
      [{ name: "Compte de résultat", rows }],
    );
  }

  return (
    <AppShell
      title="Compte de résultat"
      subtitle="Produits, charges et résultat d’exploitation"
      actions={
        <>
          <ExportExcelButton disabled={!statement} onExport={exportExcel} />
          {view === "day" ? (
            <button
              type="button"
              className={`btn btn-primary${savedFlash ? " btn-saved" : ""}`}
              disabled={!dirty || saving}
              onClick={() => void saveCharges()}
            >
              {saving ? "…" : savedFlash ? "Enregistré" : "Enregistrer charges"}
            </button>
          ) : null}
        </>
      }
    >
      <div className="section-tabs" role="tablist" aria-label="Période">
        {(
          [
            { key: "day", label: "Jour" },
            { key: "month", label: "Mois" },
            { key: "year", label: "Année" },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={view === t.key}
            className={`section-tab${view === t.key ? " is-active" : ""}`}
            onClick={() => setView(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <ContextBar
        date={view === "day" ? date : undefined}
        onDateChange={view === "day" ? setDate : undefined}
        siteLabel="Tous sites"
      >
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
      </ContextBar>

      {error ? <p className="error-banner">{error}</p> : null}

      {loading || !statement || !payload ? (
        <BrandLoader variant="ligne" label="Chargement du compte de résultat…" />
      ) : (
        <div className="pnl-layout">
          <section className="panel pnl-statement">
            <header className="pnl-header">
              <h2>{statement.title}</h2>
              <p className="muted">Montants en FCFA</p>
              <p className="muted">Combos historiques exclus des produits</p>
            </header>

            <div className="pnl-section-label">I — Produits d’exploitation</div>
            <PnlTable lines={statement.produits} />

            <div className="pnl-section-label">II — Charges d’exploitation</div>
            <PnlTable lines={statement.charges} />

            <div className="pnl-section-label">III — Résultat</div>
            <PnlTable lines={statement.resultat} />
          </section>

          <aside className="pnl-side">
            <section className="panel pnl-kpis">
              <dl className="caisse-stats">
                <div>
                  <dt>CA</dt>
                  <dd className="mono">{formatFcfa(statement.caTotal)}</dd>
                </div>
                <div>
                  <dt>Charges</dt>
                  <dd className="mono">
                    {formatFcfa(statement.chargesTotal)}
                  </dd>
                </div>
                <div>
                  <dt>Résultat</dt>
                  <dd
                    className={`mono${statement.resultatAmount < 0 ? " is-neg" : " is-pos"}`}
                  >
                    {formatFcfa(statement.resultatAmount)}
                  </dd>
                </div>
              </dl>
            </section>

            <section className="panel">
              <h3 className="panel-title">Caisse (indicatif)</h3>
              <p className="muted" style={{ marginTop: 0 }}>
                Non inclus dans le résultat (évite le double comptage avec les
                charges).
              </p>
              <dl className="caisse-stats">
                <div>
                  <dt>Dépenses caisse</dt>
                  <dd className="mono">
                    {formatFcfa(payload.caisseDepenses)}
                  </dd>
                </div>
                <div>
                  <dt>Autres recettes</dt>
                  <dd className="mono">
                    {formatFcfa(payload.caisseRecettes)}
                  </dd>
                </div>
                <div>
                  <dt>Sessions</dt>
                  <dd className="mono">{payload.caisseSessions}</dd>
                </div>
              </dl>

              {/* Le total ci-dessus mélange coffre central et caisses de
                  zone : on y perd exactement la visibilité par point que le
                  modèle à trois caisses apporte ailleurs. Détail seulement
                  quand plus d'une caisse est dans le périmètre du compte. */}
              {payload.caisseParCaisse.length > 1 ? (
                <table className="pnl-caisse-table">
                  <thead>
                    <tr>
                      <th scope="col">Caisse</th>
                      <th scope="col" className="col-money">Dépenses</th>
                      <th scope="col" className="col-money">Recettes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {CAISSES.filter((c) =>
                      payload.caisseParCaisse.some((r) => r.caisse === c),
                    ).map((c) => {
                      const row = payload.caisseParCaisse.find(
                        (r) => r.caisse === c,
                      );
                      return (
                        <tr key={c}>
                          <th scope="row">{CAISSE_LABELS[c]}</th>
                          <td className="mono col-money">
                            {formatFcfa(row?.totalDepense ?? 0)}
                          </td>
                          <td className="mono col-money">
                            {formatFcfa(row?.totalRecette ?? 0)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : null}
            </section>

            {view === "day" ? (
              <section className="panel">
                <h3 className="panel-title">Saisie des charges</h3>
                <div className="stack-form">
                  {CHARGE_FIELDS.map((f) => {
                    const suggestion =
                      f.key === "matieresPremieres"
                        ? payload.matieresPurchasesToday
                        : undefined;
                    const suggestionUtile =
                      suggestion !== undefined &&
                      suggestion > 0 &&
                      suggestion !== chargesDraft[f.key];
                    return (
                      <label key={f.key}>
                        {f.label}
                        <PriceInput
                          value={chargesDraft[f.key]}
                          ariaLabel={f.label}
                          onChange={(v) => {
                            setChargesDraft((c) => ({
                              ...c,
                              date,
                              [f.key]: v ?? 0,
                            }));
                            setDirty(true);
                          }}
                        />
                        {/* Suggestion, pas un remplacement automatique :
                            l'onglet Achats → Stock connaît le total exact du
                            jour, mais seul le gérant sait si ce chiffre
                            couvre tout ce qu'il veut mettre dans ce poste. */}
                        {suggestionUtile ? (
                          <span className="pnl-suggestion">
                            Achats du jour (Stock) : {formatFcfa(suggestion)}
                            <button
                              type="button"
                              className="btn-link"
                              onClick={() => {
                                setChargesDraft((c) => ({
                                  ...c,
                                  date,
                                  matieresPremieres: suggestion,
                                }));
                                setDirty(true);
                              }}
                            >
                              Utiliser
                            </button>
                          </span>
                        ) : null}
                      </label>
                    );
                  })}
                </div>
              </section>
            ) : null}

            {view === "month" && payload.data ? (
              <section className="panel">
                <h3 className="panel-title">Jours du mois</h3>
                <ul className="pnl-day-list">
                  {(payload.data as MonthPoint).days
                    .filter(
                      (d) =>
                        d.caTotal > 0 ||
                        d.chargesTotal > 0 ||
                        d.hasZogboData ||
                        d.hasGbegameyData,
                    )
                    .map((d) => (
                      <li key={d.date}>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => {
                            setDate(d.date);
                            setView("day");
                          }}
                        >
                          {d.date.slice(8)}
                        </button>
                        <span className="mono">
                          {formatFcfa(
                            d.caTotal - d.caCombos - d.chargesTotal,
                          )}
                        </span>
                      </li>
                    ))}
                </ul>
              </section>
            ) : null}
          </aside>
        </div>
      )}
    </AppShell>
  );
}

function PnlTable({ lines }: { lines: StatementLine[] }) {
  return (
    <table className="pnl-table">
      <tbody>
        {lines.map((line) => (
          <tr key={line.label} className={`pnl-row is-${line.kind}`}>
            <th scope="row">{line.label}</th>
            <td className={`mono${line.amount < 0 ? " is-neg" : ""}`}>
              {formatFcfa(line.amount)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
