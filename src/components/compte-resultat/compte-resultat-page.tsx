"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ContextBar } from "@/components/context-bar";
import { ExportExcelButton } from "@/components/export-excel-button";
import { PriceInput } from "@/components/parametres/price-input";
import { CAISSE_LABELS, CAISSES } from "@/lib/caisse-model";
import { downloadExcel, excelFilename } from "@/lib/export-excel";
import { formatFcfa } from "@/lib/format";
import {
  emptyCharges,
  sumChargesBreakdown,
} from "@/lib/synthese-calc";
import type {
  CaisseKey,
  ChargesBreakdown,
  CompteResultatDetailLine,
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
  caisseParCaisse: {
    caisse: CaisseKey;
    totalDepense: number;
    totalRecette: number;
    sessions: number;
  }[];
  matieresPurchasesToday?: number;
  detailProduits: CompteResultatDetailLine[];
};

const CHARGE_FIELDS: {
  key: keyof Omit<
    DayCharges,
    | "date"
    | "updatedAt"
    | "pertes"
    | "achatsStock"
    | "immobilisations"
    | "matieresConsommees"
    | "amortissements"
  >;
  label: string;
}[] = [
  { key: "matieresPremieres", label: "Achats matières premières" },
  { key: "loyer", label: "Charge locative" },
  { key: "salaires", label: "Salaires" },
  { key: "electricite", label: "Électricité" },
  { key: "carburant", label: "Carburant" },
  { key: "reparations", label: "Réparations / entretien" },
];

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

const KIND_LABELS: Record<string, string> = {
  plat: "Plat",
  local: "Accompagnement",
  boisson: "Boisson",
  extra: "Extra",
};

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

type StatementLine = {
  label: string;
  amount: number;
  kind: "item" | "subtotal" | "result" | "info" | "group";
  qty?: number;
  tickets?: number;
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

function produitsLinesFromCa(t: {
  caPlatsZogbo: number;
  caPlatsGbegamey: number;
  caAccompagnementsZogbo: number;
  caAccompagnementsGbegamey: number;
  caBoissonsZogbo: number;
  caBoissonsGbegamey: number;
  caExtraZogbo: number;
  caExtraGbegamey: number;
  caTotal: number;
  caZogbo: number;
  caGbegamey: number;
}): StatementLine[] {
  const produitsTotal = t.caTotal;
  const caZogbo = t.caZogbo;
  const caGbegamey = t.caGbegamey;
  return [
    { label: "— Zogbo —", amount: caZogbo, kind: "group" },
    { label: "CA plats Zogbo", amount: t.caPlatsZogbo, kind: "item" },
    {
      label: "CA accompagnements Zogbo",
      amount: t.caAccompagnementsZogbo,
      kind: "item",
    },
    { label: "CA boissons Zogbo", amount: t.caBoissonsZogbo, kind: "item" },
    { label: "CA extra Zogbo", amount: t.caExtraZogbo, kind: "item" },
    { label: "Sous-total Zogbo", amount: caZogbo, kind: "subtotal" },
    { label: "— Gbégamey —", amount: caGbegamey, kind: "group" },
    { label: "CA plats Gbégamey", amount: t.caPlatsGbegamey, kind: "item" },
    {
      label: "CA accompagnements Gbégamey",
      amount: t.caAccompagnementsGbegamey,
      kind: "item",
    },
    {
      label: "CA boissons Gbégamey",
      amount: t.caBoissonsGbegamey,
      kind: "item",
    },
    { label: "CA extra Gbégamey", amount: t.caExtraGbegamey, kind: "item" },
    { label: "Sous-total Gbégamey", amount: caGbegamey, kind: "subtotal" },
    {
      label: "Total produits d’exploitation",
      amount: produitsTotal,
      kind: "subtotal",
    },
  ];
}

function chargesLinesFromBreakdown(
  c: ChargesBreakdown,
  chargesTotal: number,
): StatementLine[] {
  return [
    {
      label: "Matières consommées (CMV)",
      amount: c.matieresConsommees,
      kind: "item",
    },
    {
      label: "Dotations aux amortissements",
      amount: c.amortissements,
      kind: "item",
    },
    {
      label: "Achats matières premières (hors registre)",
      amount: c.matieresPremieres,
      kind: "item",
    },
    { label: "Charge locative", amount: c.loyer, kind: "item" },
    { label: "Salaires", amount: c.salaires, kind: "item" },
    { label: "Électricité", amount: c.electricite, kind: "item" },
    { label: "Carburant", amount: c.carburant, kind: "item" },
    {
      label: "Réparations / entretien",
      amount: c.reparations,
      kind: "item",
    },
    { label: "Pertes déclarées", amount: c.pertes, kind: "item" },
    {
      label: "Total charges d’exploitation",
      amount: chargesTotal,
      kind: "subtotal",
    },
  ];
}

function buildDayStatement(day: DayPoint, date: string): Statement {
  const produitsTotal = day.caTotal;
  const charges: ChargesBreakdown = {
    achatsStock: day.charges.achatsStock ?? 0,
    matieresConsommees: day.charges.matieresConsommees ?? 0,
    amortissements: day.charges.amortissements ?? 0,
    immobilisations: day.charges.immobilisations ?? 0,
    matieresPremieres: day.charges.matieresPremieres,
    loyer: day.charges.loyer,
    salaires: day.charges.salaires,
    electricite: day.charges.electricite,
    carburant: day.charges.carburant,
    reparations: day.charges.reparations,
    pertes: day.charges.pertes ?? 0,
  };
  return {
    title: `Compte de résultat — ${formatDisplayDate(date)}`,
    produits: produitsLinesFromCa({
      caPlatsZogbo: day.caZogboPlats,
      caPlatsGbegamey: day.caGbegameyPlats,
      caAccompagnementsZogbo: day.caAccompagnementsZogbo,
      caAccompagnementsGbegamey: day.caAccompagnementsGbegamey,
      caBoissonsZogbo: day.caBoissonsZogbo,
      caBoissonsGbegamey: day.caBoissonsGbegamey,
      caExtraZogbo: day.caExtraZogbo,
      caExtraGbegamey: day.caExtraGbegamey,
      caTotal: day.caTotal,
      caZogbo: day.caZogbo,
      caGbegamey: day.caGbegamey,
    }),
    charges: chargesLinesFromBreakdown(charges, day.chargesTotal),
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
  const produitsTotal = t.caTotal;
  const charges = sumChargesBreakdown(data.days);
  const activeDays = data.days.filter(
    (d) =>
      d.caTotal > 0 ||
      d.chargesTotal > 0 ||
      d.hasZogboData ||
      d.hasGbegameyData,
  );
  return {
    title: `Compte de résultat — ${label}`,
    produits: produitsLinesFromCa(t),
    charges: chargesLinesFromBreakdown(charges, t.chargesTotal),
    resultat: [
      {
        label: "Résultat d’exploitation",
        amount: produitsTotal - t.chargesTotal,
        kind: "result",
      },
      {
        label: "Jours avec activité",
        amount: activeDays.length,
        kind: "info",
      },
      ...activeDays.map((d) => ({
        label: `Résultat jour ${d.date.slice(8)}`,
        amount: d.caTotal - d.chargesTotal,
        kind: "info" as const,
      })),
    ],
    caTotal: produitsTotal,
    chargesTotal: t.chargesTotal,
    resultatAmount: produitsTotal - t.chargesTotal,
  };
}

function buildYearStatement(data: YearPoint, label: string): Statement {
  const t = data.totals;
  const produitsTotal = t.caTotal;
  const monthLines: StatementLine[] = data.months
    .filter((m) => m.caTotal > 0 || m.chargesTotal > 0 || m.daysWithData > 0)
    .flatMap((m) => {
      const name = MONTH_NAMES[m.month - 1] ?? `Mois ${m.month}`;
      const items: StatementLine[] = [
        {
          label: `— ${name} —`,
          amount: m.caTotal - m.chargesTotal,
          kind: "group",
        },
        {
          label: `${name} · CA plats Zogbo`,
          amount: m.caPlatsZogbo,
          kind: "item",
        },
        {
          label: `${name} · CA plats Gbégamey`,
          amount: m.caPlatsGbegamey,
          kind: "item",
        },
        {
          label: `${name} · CA accompagnements Zogbo`,
          amount: m.caAccompagnementsZogbo,
          kind: "item",
        },
        {
          label: `${name} · CA accompagnements Gbégamey`,
          amount: m.caAccompagnementsGbegamey,
          kind: "item",
        },
        {
          label: `${name} · CA boissons Zogbo`,
          amount: m.caBoissonsZogbo,
          kind: "item",
        },
        {
          label: `${name} · CA boissons Gbégamey`,
          amount: m.caBoissonsGbegamey,
          kind: "item",
        },
        {
          label: `${name} · CA extra Zogbo`,
          amount: m.caExtraZogbo,
          kind: "item",
        },
        {
          label: `${name} · CA extra Gbégamey`,
          amount: m.caExtraGbegamey,
          kind: "item",
        },
        {
          label: `${name} · CMV`,
          amount: m.charges.matieresConsommees,
          kind: "item",
        },
        {
          label: `${name} · amortissements`,
          amount: m.charges.amortissements,
          kind: "item",
        },
        {
          label: `${name} · matières premières`,
          amount: m.charges.matieresPremieres,
          kind: "item",
        },
        {
          label: `${name} · loyer`,
          amount: m.charges.loyer,
          kind: "item",
        },
        {
          label: `${name} · salaires`,
          amount: m.charges.salaires,
          kind: "item",
        },
        {
          label: `${name} · électricité`,
          amount: m.charges.electricite,
          kind: "item",
        },
        {
          label: `${name} · carburant`,
          amount: m.charges.carburant,
          kind: "item",
        },
        {
          label: `${name} · réparations`,
          amount: m.charges.reparations,
          kind: "item",
        },
        {
          label: `${name} · pertes`,
          amount: m.charges.pertes,
          kind: "item",
        },
        {
          label: `${name} · total charges`,
          amount: m.chargesTotal,
          kind: "item",
        },
        {
          label: `${name} · résultat`,
          amount: m.caTotal - m.chargesTotal,
          kind: "subtotal",
        },
      ];
      return items.filter(
        (l) => l.kind === "group" || l.kind === "subtotal" || l.amount !== 0,
      );
    });

  return {
    title: `Compte de résultat — ${label}`,
    produits: [...produitsLinesFromCa(t), ...monthLines],
    charges: chargesLinesFromBreakdown(t.charges, t.chargesTotal),
    resultat: [
      {
        label: "Résultat d’exploitation",
        amount: produitsTotal - t.chargesTotal,
        kind: "result",
      },
      {
        label: "Mois avec activité",
        amount: data.months.filter(
          (m) => m.caTotal > 0 || m.chargesTotal > 0 || m.daysWithData > 0,
        ).length,
        kind: "info",
      },
    ],
    caTotal: produitsTotal,
    chargesTotal: t.chargesTotal,
    resultatAmount: produitsTotal - t.chargesTotal,
  };
}

function summarizeDetails(lines: CompteResultatDetailLine[]) {
  const byKind = new Map<
    string,
    { qty: number; amount: number; tickets: number; products: number }
  >();
  const bySite = new Map<
    string,
    { qty: number; amount: number; tickets: number }
  >();
  for (const l of lines) {
    const k = byKind.get(l.kind) ?? {
      qty: 0,
      amount: 0,
      tickets: 0,
      products: 0,
    };
    k.qty += l.qty;
    k.amount += l.amount;
    k.tickets += l.tickets;
    k.products += 1;
    byKind.set(l.kind, k);
    const s = bySite.get(l.site) ?? { qty: 0, amount: 0, tickets: 0 };
    s.qty += l.qty;
    s.amount += l.amount;
    s.tickets += l.tickets;
    bySite.set(l.site, s);
  }
  return { byKind, bySite };
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
      setPayload({
        ...body,
        detailProduits: body.detailProduits ?? [],
      });
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

  const detailSummary = useMemo(
    () => summarizeDetails(payload?.detailProduits ?? []),
    [payload],
  );

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
      ...statement.produits.map((l) => ({
        Section: "Produits",
        Poste: l.label,
        Quantite: l.qty ?? "",
        Tickets: l.tickets ?? "",
        Montant: l.amount,
      })),
      ...statement.charges.map((l) => ({
        Section: "Charges",
        Poste: l.label,
        Quantite: "",
        Tickets: "",
        Montant: l.amount,
      })),
      ...statement.resultat.map((l) => ({
        Section: "Résultat",
        Poste: l.label,
        Quantite: "",
        Tickets: "",
        Montant: l.amount,
      })),
      ...payload.detailProduits.map((l) => ({
        Section: "Détail produits",
        Poste: `${l.site} · ${KIND_LABELS[l.kind] ?? l.kind} · ${l.name}`,
        Quantite: l.qty,
        Tickets: l.tickets,
        Montant: l.amount,
      })),
      {
        Section: "Caisse",
        Poste: "Dépenses caisse (info, hors résultat)",
        Quantite: "",
        Tickets: "",
        Montant: payload.caisseDepenses,
      },
      {
        Section: "Caisse",
        Poste: "Autres recettes caisse (info)",
        Quantite: "",
        Tickets: "",
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

  const detail = payload?.detailProduits ?? [];
  const totalQty = detail.reduce((s, l) => s + l.qty, 0);
  const totalTickets = detail.reduce((s, l) => s + l.tickets, 0);

  return (
    <AppShell
      title="Compte de résultat"
      subtitle="Produits, charges et résultat d’exploitation — détail complet"
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
        <BrandLoader
          variant="ligne"
          label="Chargement du compte de résultat…"
        />
      ) : (
        <div className="pnl-layout">
          <section className="panel pnl-statement">
            <header className="pnl-header">
              <h2>{statement.title}</h2>
              <p className="muted">Montants en FCFA</p>
            </header>

            <div className="pnl-section-label">I — Produits d’exploitation</div>
            <PnlTable lines={statement.produits} />

            <div className="pnl-section-label">II — Charges d’exploitation</div>
            <PnlTable lines={statement.charges} />

            <div className="pnl-section-label">III — Résultat</div>
            <PnlTable lines={statement.resultat} />

            <div className="pnl-section-label">
              IV — Détail produit par produit ({detail.length} lignes ·{" "}
              {totalQty} unités · {totalTickets} tickets)
            </div>
            {detail.length === 0 ? (
              <p className="muted">Aucune vente sur cette période.</p>
            ) : (
              <table className="pnl-table pnl-detail-table">
                <thead>
                  <tr>
                    <th scope="col">Site</th>
                    <th scope="col">Type</th>
                    <th scope="col">Produit</th>
                    <th scope="col" className="col-money">
                      Qté
                    </th>
                    <th scope="col" className="col-money">
                      Tickets
                    </th>
                    <th scope="col" className="col-money">
                      CA
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {detail.map((l) => (
                    <tr
                      key={`${l.site}|${l.kind}|${l.productId}`}
                      className="pnl-row is-item"
                    >
                      <td>{l.site === "gbegamey" ? "Gbégamey" : "Zogbo"}</td>
                      <td>{KIND_LABELS[l.kind] ?? l.kind}</td>
                      <th scope="row">{l.name}</th>
                      <td className="mono col-money">{l.qty}</td>
                      <td className="mono col-money">{l.tickets}</td>
                      <td className="mono col-money">
                        {formatFcfa(l.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="pnl-row is-subtotal">
                    <th scope="row" colSpan={3}>
                      Total détail
                    </th>
                    <td className="mono col-money">{totalQty}</td>
                    <td className="mono col-money">{totalTickets}</td>
                    <td className="mono col-money">
                      {formatFcfa(
                        detail.reduce((s, l) => s + l.amount, 0),
                      )}
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}
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
                <div>
                  <dt>Unités vendues</dt>
                  <dd className="mono">{totalQty}</dd>
                </div>
                <div>
                  <dt>Tickets</dt>
                  <dd className="mono">{totalTickets}</dd>
                </div>
                <div>
                  <dt>Références</dt>
                  <dd className="mono">{detail.length}</dd>
                </div>
              </dl>
            </section>

            <section className="panel">
              <h3 className="panel-title">Volumes par type</h3>
              <table className="pnl-caisse-table">
                <thead>
                  <tr>
                    <th scope="col">Type</th>
                    <th scope="col" className="col-money">
                      Qté
                    </th>
                    <th scope="col" className="col-money">
                      Tickets
                    </th>
                    <th scope="col" className="col-money">
                      CA
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[...detailSummary.byKind.entries()].map(([kind, v]) => (
                    <tr key={kind}>
                      <th scope="row">{KIND_LABELS[kind] ?? kind}</th>
                      <td className="mono col-money">{v.qty}</td>
                      <td className="mono col-money">{v.tickets}</td>
                      <td className="mono col-money">
                        {formatFcfa(v.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="panel">
              <h3 className="panel-title">Volumes par site</h3>
              <table className="pnl-caisse-table">
                <thead>
                  <tr>
                    <th scope="col">Site</th>
                    <th scope="col" className="col-money">
                      Qté
                    </th>
                    <th scope="col" className="col-money">
                      Tickets
                    </th>
                    <th scope="col" className="col-money">
                      CA
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[...detailSummary.bySite.entries()].map(([site, v]) => (
                    <tr key={site}>
                      <th scope="row">
                        {site === "gbegamey" ? "Gbégamey" : "Zogbo"}
                      </th>
                      <td className="mono col-money">{v.qty}</td>
                      <td className="mono col-money">{v.tickets}</td>
                      <td className="mono col-money">
                        {formatFcfa(v.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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

              {payload.caisseParCaisse.length > 1 ? (
                <table className="pnl-caisse-table">
                  <thead>
                    <tr>
                      <th scope="col">Caisse</th>
                      <th scope="col" className="col-money">
                        Dépenses
                      </th>
                      <th scope="col" className="col-money">
                        Recettes
                      </th>
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
                    const achats =
                      f.key === "matieresPremieres"
                        ? (payload.matieresPurchasesToday ?? 0)
                        : 0;
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
                        {achats > 0 ? (
                          <span className="pnl-suggestion">
                            Achats du jour (Stock) : {formatFcfa(achats)} — déjà
                            comptés dans les charges, ne les ressaisissez pas
                            ici.
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
                          {formatFcfa(d.caTotal - d.chargesTotal)}
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
        {lines.map((line, i) => {
          const isCountInfo =
            line.kind === "info" &&
            (line.label.includes("Jours avec") ||
              line.label.includes("Mois avec"));
          return (
            <tr
              key={`${line.kind}-${line.label}-${i}`}
              className={`pnl-row is-${line.kind}`}
            >
              <th scope="row">{line.label}</th>
              <td className={`mono${line.amount < 0 ? " is-neg" : ""}`}>
                {isCountInfo ? String(line.amount) : formatFcfa(line.amount)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
