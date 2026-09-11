import type {
  BaseDish,
  BoissonsDay,
  ChargesBreakdown,
  DayCharges,
  DayPoint,
  Drink,
  GbegameyDay,
  LocalDish,
  MonthPoint,
  VenteSite,
  YearPoint,
  ZogboDay,
} from "@/lib/types";
import { netAfterProrate } from "@/lib/ca-allocation";
import { computeBoissonsDay } from "@/lib/boissons-calc";
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
    pertes: 0,
    achatsStock: 0,
    matieresConsommees: 0,
    cmvBoissons: 0,
    cmvEmballages: 0,
    amortissements: 0,
    immobilisations: 0,
    updatedAt: null,
  };
}

/**
 * CMV stock (matières consommées) est la source normative dès qu’il est
 * renseigné : la saisie manuelle « matières premières » ne s’y additionne
 * plus, pour éviter de compter deux fois la même consommation.
 */
export function chargesTotal(c: DayCharges): number {
  const cmvMatieres = Math.max(0, Number(c.matieresConsommees) || 0);
  const mpManuelle =
    cmvMatieres > 0 ? 0 : Math.max(0, Number(c.matieresPremieres) || 0);
  return (
    mpManuelle +
    c.loyer +
    c.salaires +
    c.electricite +
    c.carburant +
    c.reparations +
    Math.max(0, Number(c.pertes) || 0) +
    cmvMatieres +
    Math.max(0, Number(c.cmvBoissons) || 0) +
    Math.max(0, Number(c.cmvEmballages) || 0) +
    Math.max(0, Number(c.amortissements) || 0)
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
  /** Accompagnements locaux (frites, attiéké…) : vendus « sur place » */
  localZogbo: number;
  localGbegamey: number;
  boissonsZogbo: number;
  boissonsGbegamey: number;
  extraZogbo: number;
  extraGbegamey: number;
  /** Réductions commerciales POS (montant déduit du CA encaissé). */
  reductionsZogbo: number;
  reductionsGbegamey: number;
  margeBoissons: number;
  count: number;
};

export function emptyVenteTotals(): VenteTotals {
  return {
    platsZogbo: 0,
    platsGbegamey: 0,
    localZogbo: 0,
    localGbegamey: 0,
    boissonsZogbo: 0,
    boissonsGbegamey: 0,
    extraZogbo: 0,
    extraGbegamey: 0,
    reductionsZogbo: 0,
    reductionsGbegamey: 0,
    margeBoissons: 0,
    count: 0,
  };
}

export function computeDayRevenue(input: {
  baseDishes: BaseDish[];
  localDishes: LocalDish[];
  drinksCatalog: Drink[];
  zogbo: ZogboDay | null;
  gbegamey: GbegameyDay | null;
  boissons: BoissonsDay | null;
  /** Source unique du CA — le journal des ventes */
  ventes: VenteTotals;
  /**
   * Compte verrouillé sur une zone : la vue ne doit rien laisser passer de
   * l'autre zone. Plats et accompagnements vivent dans des documents séparés
   * par zone (zogbo_jours / gbegamey_jours), déjà exclus en amont — mais
   * boissons partagent un seul document pour les deux zones.
   */
  scopeSite?: VenteSite | null;
}) {
  const {
    baseDishes,
    localDishes,
    drinksCatalog,
    zogbo,
    gbegamey,
    boissons,
    ventes,
    scopeSite,
  } = input;

  const zogboTotals = zogbo
    ? computeZogboDay(zogbo, baseDishes).totals
    : null;
  const caZogboPlats = ventes.platsZogbo;
  const varianceZogbo = zogboTotals?.varianceCount ?? 0;
  const hasZogboData = !!zogbo?.updatedAt;

  const sent = new Map(
    (zogbo?.lines ?? []).map((l) => [l.productId, l.sentToGbegamey]),
  );
  const gbegameyTotals = gbegamey
    ? computeGbegameyDay(gbegamey, baseDishes, localDishes, sent).totals
    : null;
  const caGbegameyPlats = ventes.platsGbegamey;
  const caAccompagnementsZogbo = ventes.localZogbo;
  const caAccompagnementsGbegamey = ventes.localGbegamey;
  const varianceGbegamey = gbegameyTotals?.varianceCount ?? 0;
  const hasGbegameyData = !!gbegamey?.updatedAt;

  const boissonsTotals = boissons
    ? computeBoissonsDay(boissons, drinksCatalog).totals
    : null;
  const caBoissonsZogbo = ventes.boissonsZogbo;
  const caBoissonsGbegamey = ventes.boissonsGbegamey;
  const caExtraZogbo = ventes.extraZogbo;
  const caExtraGbegamey = ventes.extraGbegamey;
  const margeBoissons = ventes.margeBoissons;
  const hasBoissonsData = !!boissons?.updatedAt;

  let zPlats = caZogboPlats,
    zAcc = caAccompagnementsZogbo,
    zBoissons = caBoissonsZogbo,
    zExtra = caExtraZogbo,
    zReductions = ventes.reductionsZogbo,
    zVarianceBoissons = boissonsTotals?.varianceCountZogbo ?? 0;
  let gPlats = caGbegameyPlats,
    gAcc = caAccompagnementsGbegamey,
    gBoissons = caBoissonsGbegamey,
    gExtra = caExtraGbegamey,
    gReductions = ventes.reductionsGbegamey,
    gVarianceBoissons = boissonsTotals?.varianceCountGbegamey ?? 0;
  if (scopeSite === "gbegamey") {
    zPlats = zAcc = zBoissons = zExtra = zReductions = zVarianceBoissons = 0;
  } else if (scopeSite === "zogbo") {
    gPlats = gAcc = gBoissons = gExtra = gReductions = gVarianceBoissons = 0;
  }
  const varianceBoissons = zVarianceBoissons + gVarianceBoissons;

  const zRed = Math.max(0, zReductions);
  const gRed = Math.max(0, gReductions);
  const [nzPlats, nzAcc, nzBoissons, nzExtra] = netAfterProrate(
    [zPlats, zAcc, zBoissons, zExtra],
    zRed,
  );
  const [ngPlats, ngAcc, ngBoissons, ngExtra] = netAfterProrate(
    [gPlats, gAcc, gBoissons, gExtra],
    gRed,
  );

  const caBoissons = nzBoissons + ngBoissons;
  const caExtra = nzExtra + ngExtra;
  const caAccompagnements = nzAcc + ngAcc;
  const caZogbo = nzPlats + nzAcc + nzBoissons + nzExtra;
  const caGbegamey = ngPlats + ngAcc + ngBoissons + ngExtra;
  const caTotal = caZogbo + caGbegamey;

  return {
    caZogboPlats: nzPlats,
    caGbegameyPlats: ngPlats,
    caAccompagnementsZogbo: nzAcc,
    caAccompagnementsGbegamey: ngAcc,
    caBoissonsZogbo: nzBoissons,
    caBoissonsGbegamey: ngBoissons,
    caExtraZogbo: nzExtra,
    caExtraGbegamey: ngExtra,
    caZogbo,
    caGbegamey,
    caReductionsZogbo: zRed,
    caReductionsGbegamey: gRed,
    caAccompagnements,
    caBoissons,
    caExtra,
    caTotal,
    varianceZogbo,
    varianceGbegamey,
    varianceBoissons,
    margeBoissons,
    hasZogboData,
    hasGbegameyData,
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

export function emptyChargesBreakdown(): ChargesBreakdown {
  return {
    achatsStock: 0,
    matieresConsommees: 0,
    cmvBoissons: 0,
    cmvEmballages: 0,
    amortissements: 0,
    immobilisations: 0,
    matieresPremieres: 0,
    loyer: 0,
    salaires: 0,
    electricite: 0,
    carburant: 0,
    reparations: 0,
    pertes: 0,
  };
}

/** Somme des postes de charges sur une liste de jours. */
export function sumChargesBreakdown(days: DayPoint[]): ChargesBreakdown {
  return days.reduce(
    (acc, d) => {
      const c = d.charges;
      acc.achatsStock += Math.max(0, Number(c.achatsStock) || 0);
      acc.matieresConsommees += Math.max(0, Number(c.matieresConsommees) || 0);
      acc.cmvBoissons += Math.max(0, Number(c.cmvBoissons) || 0);
      acc.cmvEmballages += Math.max(0, Number(c.cmvEmballages) || 0);
      acc.amortissements += Math.max(0, Number(c.amortissements) || 0);
      acc.immobilisations += Math.max(0, Number(c.immobilisations) || 0);
      acc.matieresPremieres +=
        Math.max(0, Number(c.matieresConsommees) || 0) > 0
          ? 0
          : Math.max(0, Number(c.matieresPremieres) || 0);
      acc.loyer += Math.max(0, Number(c.loyer) || 0);
      acc.salaires += Math.max(0, Number(c.salaires) || 0);
      acc.electricite += Math.max(0, Number(c.electricite) || 0);
      acc.carburant += Math.max(0, Number(c.carburant) || 0);
      acc.reparations += Math.max(0, Number(c.reparations) || 0);
      acc.pertes += Math.max(0, Number(c.pertes) || 0);
      return acc;
    },
    emptyChargesBreakdown(),
  );
}

export function sumMonth(days: DayPoint[]): MonthPoint["totals"] {
  return days.reduce(
    (acc, d) => {
      acc.caPlatsZogbo += d.caZogboPlats;
      acc.caPlatsGbegamey += d.caGbegameyPlats;
      acc.caAccompagnementsZogbo += d.caAccompagnementsZogbo;
      acc.caAccompagnementsGbegamey += d.caAccompagnementsGbegamey;
      acc.caBoissonsZogbo += d.caBoissonsZogbo;
      acc.caBoissonsGbegamey += d.caBoissonsGbegamey;
      acc.caExtraZogbo += d.caExtraZogbo;
      acc.caExtraGbegamey += d.caExtraGbegamey;
      acc.caZogbo += d.caZogbo;
      acc.caGbegamey += d.caGbegamey;
      acc.caBoissons += d.caBoissons;
      acc.caTotal += d.caTotal;
      acc.chargesTotal += d.chargesTotal;
      acc.resultat += d.resultat;
      return acc;
    },
    {
      caPlatsZogbo: 0,
      caPlatsGbegamey: 0,
      caAccompagnementsZogbo: 0,
      caAccompagnementsGbegamey: 0,
      caBoissonsZogbo: 0,
      caBoissonsGbegamey: 0,
      caExtraZogbo: 0,
      caExtraGbegamey: 0,
      caZogbo: 0,
      caGbegamey: 0,
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
  const rows = months.map((m) => {
    const charges = sumChargesBreakdown(m.days);
    return {
      month: m.month,
      caTotal: m.totals.caTotal,
      caPlatsZogbo: m.totals.caPlatsZogbo,
      caPlatsGbegamey: m.totals.caPlatsGbegamey,
      caAccompagnementsZogbo: m.totals.caAccompagnementsZogbo,
      caAccompagnementsGbegamey: m.totals.caAccompagnementsGbegamey,
      caBoissonsZogbo: m.totals.caBoissonsZogbo,
      caBoissonsGbegamey: m.totals.caBoissonsGbegamey,
      caExtraZogbo: m.totals.caExtraZogbo,
      caExtraGbegamey: m.totals.caExtraGbegamey,
      charges,
      chargesTotal: m.totals.chargesTotal,
      resultat: m.totals.resultat,
      daysWithData: m.days.filter(
        (d) =>
          d.hasZogboData ||
          d.hasGbegameyData ||
          d.hasBoissonsData ||
          d.chargesTotal > 0,
      ).length,
    };
  });

  const totals = rows.reduce(
    (acc, r) => {
      acc.caPlatsZogbo += r.caPlatsZogbo;
      acc.caPlatsGbegamey += r.caPlatsGbegamey;
      acc.caAccompagnementsZogbo += r.caAccompagnementsZogbo;
      acc.caAccompagnementsGbegamey += r.caAccompagnementsGbegamey;
      acc.caBoissonsZogbo += r.caBoissonsZogbo;
      acc.caBoissonsGbegamey += r.caBoissonsGbegamey;
      acc.caExtraZogbo += r.caExtraZogbo;
      acc.caExtraGbegamey += r.caExtraGbegamey;
      acc.caTotal += r.caTotal;
      acc.charges.achatsStock += r.charges.achatsStock;
      acc.charges.matieresConsommees += r.charges.matieresConsommees;
      acc.charges.cmvBoissons += r.charges.cmvBoissons;
      acc.charges.cmvEmballages += r.charges.cmvEmballages;
      acc.charges.amortissements += r.charges.amortissements;
      acc.charges.immobilisations += r.charges.immobilisations;
      acc.charges.matieresPremieres += r.charges.matieresPremieres;
      acc.charges.loyer += r.charges.loyer;
      acc.charges.salaires += r.charges.salaires;
      acc.charges.electricite += r.charges.electricite;
      acc.charges.carburant += r.charges.carburant;
      acc.charges.reparations += r.charges.reparations;
      acc.charges.pertes += r.charges.pertes;
      acc.chargesTotal += r.chargesTotal;
      acc.resultat += r.resultat;
      return acc;
    },
    {
      caPlatsZogbo: 0,
      caPlatsGbegamey: 0,
      caAccompagnementsZogbo: 0,
      caAccompagnementsGbegamey: 0,
      caBoissonsZogbo: 0,
      caBoissonsGbegamey: 0,
      caExtraZogbo: 0,
      caExtraGbegamey: 0,
      caZogbo: 0,
      caGbegamey: 0,
      caBoissons: 0,
      caTotal: 0,
      charges: emptyChargesBreakdown(),
      chargesTotal: 0,
      resultat: 0,
    },
  );

  totals.caZogbo = months.reduce((s, m) => s + m.totals.caZogbo, 0);
  totals.caGbegamey = months.reduce((s, m) => s + m.totals.caGbegamey, 0);
  totals.caBoissons = months.reduce((s, m) => s + m.totals.caBoissons, 0);

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
    d.hasBoissonsData ||
    d.chargesTotal > 0
  );
}
