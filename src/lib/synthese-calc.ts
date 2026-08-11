import type {
  BaseDish,
  BoissonsDay,
  ComboDish,
  CombosDay,
  DayCharges,
  DayPoint,
  Drink,
  GbegameyDay,
  LocalDish,
  MonthPoint,
  YearPoint,
  ZogboDay,
} from "@/lib/types";
import { computeBoissonsDay } from "@/lib/boissons-calc";
import { computeCombosDay } from "@/lib/combos-calc";
import { computeGbegameyDay } from "@/lib/gbegamey-calc";
import { computeZogboDay } from "@/lib/zogbo-calc";

export function emptyCharges(date: string): DayCharges {
  return {
    date,
    matieresPremieres: 0,
    loyer: 0,
    salaires: 0,
    electricite: 0,
    carburant: 0,
    reparations: 0,
    updatedAt: null,
  };
}

export function chargesTotal(c: DayCharges): number {
  return (
    c.matieresPremieres +
    c.loyer +
    c.salaires +
    c.electricite +
    c.carburant +
    c.reparations
  );
}

/**
 * Montants encaissés, agrégés depuis le journal des ventes.
 * Les prix y sont figés au moment de la vente : changer un prix au
 * catalogue ne réécrit plus le chiffre d’affaires passé.
 */
export type VenteTotals = {
  platsZogbo: number;
  platsGbegamey: number;
  combosZogbo: number;
  combosGbegamey: number;
  boissonsZogbo: number;
  boissonsGbegamey: number;
  extraZogbo: number;
  extraGbegamey: number;
  margeBoissons: number;
  count: number;
};

export function emptyVenteTotals(): VenteTotals {
  return {
    platsZogbo: 0,
    platsGbegamey: 0,
    combosZogbo: 0,
    combosGbegamey: 0,
    boissonsZogbo: 0,
    boissonsGbegamey: 0,
    extraZogbo: 0,
    extraGbegamey: 0,
    margeBoissons: 0,
    count: 0,
  };
}

export function computeDayRevenue(input: {
  baseDishes: BaseDish[];
  localDishes: LocalDish[];
  combosCatalog: ComboDish[];
  drinksCatalog: Drink[];
  zogbo: ZogboDay | null;
  gbegamey: GbegameyDay | null;
  combos: CombosDay | null;
  boissons: BoissonsDay | null;
  /** Source unique du CA — le journal des ventes */
  ventes: VenteTotals;
}) {
  const {
    baseDishes,
    localDishes,
    combosCatalog,
    drinksCatalog,
    zogbo,
    gbegamey,
    combos,
    boissons,
    ventes,
  } = input;

  /*
   * Le CA vient du journal des ventes, qui porte les prix réellement
   * pratiqués. Repli pour les journées antérieures à l’écran Vente : leur
   * journal est vide, on recalcule alors depuis les compteurs du jour et le
   * catalogue courant (ancien comportement) plutôt que d’afficher 0.
   */
  const fromJournal = ventes.count > 0;

  const zogboTotals = zogbo
    ? computeZogboDay(zogbo, baseDishes).totals
    : null;
  const caZogboPlats = fromJournal
    ? ventes.platsZogbo
    : (zogboTotals?.soldAmount ?? 0);
  const varianceZogbo = zogboTotals?.varianceCount ?? 0;
  const hasZogboData = !!zogbo?.updatedAt;

  const sent = new Map(
    (zogbo?.lines ?? []).map((l) => [l.productId, l.sentToGbegamey]),
  );
  const gbegameyTotals = gbegamey
    ? computeGbegameyDay(gbegamey, baseDishes, localDishes, sent).totals
    : null;
  const caGbegameyPlats = fromJournal
    ? ventes.platsGbegamey
    : (gbegameyTotals?.soldAmount ?? 0);
  const varianceGbegamey = gbegameyTotals?.varianceCount ?? 0;
  const hasGbegameyData = !!gbegamey?.updatedAt;

  const combosTotals = combos
    ? computeCombosDay(combos, combosCatalog).totals
    : null;
  const caCombosZogbo = fromJournal
    ? ventes.combosZogbo
    : (combosTotals?.soldAmountZogbo ?? 0);
  const caCombosGbegamey = fromJournal
    ? ventes.combosGbegamey
    : (combosTotals?.soldAmountGbegamey ?? 0);
  const hasCombosData = !!combos?.updatedAt;

  const boissonsTotals = boissons
    ? computeBoissonsDay(boissons, drinksCatalog).totals
    : null;
  const caBoissonsZogbo = fromJournal
    ? ventes.boissonsZogbo
    : (boissonsTotals?.soldAmountZogbo ?? 0);
  const caBoissonsGbegamey = fromJournal
    ? ventes.boissonsGbegamey
    : (boissonsTotals?.soldAmountGbegamey ?? 0);
  const caExtraZogbo = fromJournal ? ventes.extraZogbo : 0;
  const caExtraGbegamey = fromJournal ? ventes.extraGbegamey : 0;
  const margeBoissons = fromJournal
    ? ventes.margeBoissons
    : (boissonsTotals?.margin ?? 0);
  const varianceBoissons = boissonsTotals?.varianceCount ?? 0;
  const hasBoissonsData = !!boissons?.updatedAt;

  const caCombos = caCombosZogbo + caCombosGbegamey;
  const caBoissons = caBoissonsZogbo + caBoissonsGbegamey;
  const caExtra = caExtraZogbo + caExtraGbegamey;
  const caZogbo =
    caZogboPlats + caCombosZogbo + caBoissonsZogbo + caExtraZogbo;
  const caGbegamey =
    caGbegameyPlats + caCombosGbegamey + caBoissonsGbegamey + caExtraGbegamey;
  const caTotal = caZogbo + caGbegamey;

  return {
    caZogboPlats,
    caGbegameyPlats,
    caCombosZogbo,
    caCombosGbegamey,
    caBoissonsZogbo,
    caBoissonsGbegamey,
    caExtraZogbo,
    caExtraGbegamey,
    caZogbo,
    caGbegamey,
    caCombos,
    caBoissons,
    caExtra,
    caTotal,
    varianceZogbo,
    varianceGbegamey,
    varianceBoissons,
    margeBoissons,
    hasZogboData,
    hasGbegameyData,
    hasCombosData,
    hasBoissonsData,
  };
}

export function buildDayPoint(
  date: string,
  revenue: ReturnType<typeof computeDayRevenue>,
  charges: DayCharges,
): DayPoint {
  const totalCharges = chargesTotal(charges);
  return {
    date,
    ...revenue,
    charges,
    chargesTotal: totalCharges,
    resultat: revenue.caTotal - totalCharges,
  };
}

export function daysInMonth(year: number, month: number): string[] {
  const count = new Date(year, month, 0).getDate();
  const out: string[] = [];
  for (let d = 1; d <= count; d++) {
    out.push(
      `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
    );
  }
  return out;
}

export function sumMonth(days: DayPoint[]): MonthPoint["totals"] {
  return days.reduce(
    (acc, d) => {
      acc.caZogbo += d.caZogbo;
      acc.caGbegamey += d.caGbegamey;
      acc.caCombos += d.caCombos;
      acc.caBoissons += d.caBoissons;
      acc.caTotal += d.caTotal;
      acc.chargesTotal += d.chargesTotal;
      acc.resultat += d.resultat;
      return acc;
    },
    {
      caZogbo: 0,
      caGbegamey: 0,
      caCombos: 0,
      caBoissons: 0,
      caTotal: 0,
      chargesTotal: 0,
      resultat: 0,
    },
  );
}

export function buildYearPoint(
  year: number,
  months: MonthPoint[],
): YearPoint {
  const rows = months.map((m) => ({
    month: m.month,
    caTotal: m.totals.caTotal,
    chargesTotal: m.totals.chargesTotal,
    resultat: m.totals.resultat,
    daysWithData: m.days.filter(
      (d) =>
        d.hasZogboData ||
        d.hasGbegameyData ||
        d.hasCombosData ||
        d.hasBoissonsData ||
        d.chargesTotal > 0,
    ).length,
  }));

  const totals = rows.reduce(
    (acc, r) => {
      acc.caTotal += r.caTotal;
      acc.chargesTotal += r.chargesTotal;
      acc.resultat += r.resultat;
      return acc;
    },
    { caTotal: 0, chargesTotal: 0, resultat: 0 },
  );

  return { year, months: rows, totals };
}

export function parseYearMonth(ym: string): { year: number; month: number } {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) throw new Error("Mois invalide (attendu YYYY-MM)");
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) throw new Error("Mois invalide");
  return { year, month };
}

export function dayHasActivity(d: DayPoint): boolean {
  return (
    d.hasZogboData ||
    d.hasGbegameyData ||
    d.hasCombosData ||
    d.hasBoissonsData ||
    d.chargesTotal > 0
  );
}
