import type {
  BaseDish,
  BoissonsDay,
  ChargesBreakdown,
  ComboDish,
  CombosDay,
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
    pertes: 0,
    achatsStock: 0,
    immobilisations: 0,
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
    c.reparations +
    // Un produit gâté est une charge réelle, au même titre qu'un achat.
    Math.max(0, Number(c.pertes) || 0) +
    // Ce qui est acheté sur la page Achats est une charge : sans cette ligne,
    // un achat saisi ne pesait sur le résultat que si le gérant le retapait
    // à la main dans « matières premières ».
    Math.max(0, Number(c.achatsStock) || 0) +
    // Acquisitions Immobilisations (actifs + emballages) à la date d’entrée.
    Math.max(0, Number(c.immobilisations) || 0)
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
    localZogbo: 0,
    localGbegamey: 0,
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
  /**
   * Compte verrouillé sur une zone : la vue ne doit rien laisser passer de
   * l'autre zone. Plats et accompagnements vivent dans des documents séparés
   * par zone (zogbo_jours / gbegamey_jours), déjà exclus en amont — mais
   * boissons et combos partagent un seul document pour les deux zones, avec
   * les deux totaux dedans. Sans ce filtre final, un compte Gbégamey voyait
   * le CA boissons de Zogbo (chiffre réel, mais qui n'a rien à faire sur son
   * tableau de bord) alors que ses plats Zogbo étaient déjà correctement à
   * zéro — un mélange incohérent selon la catégorie de produit.
   */
  scopeSite?: VenteSite | null;
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
    scopeSite,
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
    : (gbegameyTotals?.transferSoldAmount ?? 0);
  const caAccompagnementsZogbo = fromJournal
    ? ventes.localZogbo
    : // Avant l'écran Vente, les accompagnements Zogbo n'étaient pas tracés.
      0;
  const caAccompagnementsGbegamey = fromJournal
    ? ventes.localGbegamey
    : (gbegameyTotals?.localSoldAmount ?? 0);
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

  // Compte verrouillé sur une zone : rien de l'autre zone ne doit transpirer,
  // catégorie par catégorie. Plats/accompagnements le sont déjà de fait (leur
  // document source est exclu en amont), mais boissons et combos vivent dans
  // un document partagé aux deux zones — sans ce filtre, leur moitié
  // « autre zone » restait visible alors que le reste du jour était à zéro.
  let zPlats = caZogboPlats,
    zAcc = caAccompagnementsZogbo,
    zCombos = caCombosZogbo,
    zBoissons = caBoissonsZogbo,
    zExtra = caExtraZogbo;
  let gPlats = caGbegameyPlats,
    gAcc = caAccompagnementsGbegamey,
    gCombos = caCombosGbegamey,
    gBoissons = caBoissonsGbegamey,
    gExtra = caExtraGbegamey;
  if (scopeSite === "gbegamey") {
    zPlats = zAcc = zCombos = zBoissons = zExtra = 0;
  } else if (scopeSite === "zogbo") {
    gPlats = gAcc = gCombos = gBoissons = gExtra = 0;
  }

  const caCombos = zCombos + gCombos;
  const caBoissons = zBoissons + gBoissons;
  const caExtra = zExtra + gExtra;
  const caAccompagnements = zAcc + gAcc;
  const caZogbo = zPlats + zAcc + zCombos + zBoissons + zExtra;
  const caGbegamey = gPlats + gAcc + gCombos + gBoissons + gExtra;
  const caTotal = caZogbo + caGbegamey;

  return {
    caZogboPlats: zPlats,
    caGbegameyPlats: gPlats,
    caAccompagnementsZogbo: zAcc,
    caAccompagnementsGbegamey: gAcc,
    caCombosZogbo: zCombos,
    caCombosGbegamey: gCombos,
    caBoissonsZogbo: zBoissons,
    caBoissonsGbegamey: gBoissons,
    caExtraZogbo: zExtra,
    caExtraGbegamey: gExtra,
    caZogbo,
    caGbegamey,
    caAccompagnements,
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

export function emptyChargesBreakdown(): ChargesBreakdown {
  return {
    achatsStock: 0,
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
      acc.immobilisations += Math.max(0, Number(c.immobilisations) || 0);
      acc.matieresPremieres += Math.max(0, Number(c.matieresPremieres) || 0);
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
      acc.caCombos += d.caCombos;
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
  const rows = months.map((m) => {
    const charges = sumChargesBreakdown(m.days);
    return {
      month: m.month,
      caTotal: m.totals.caTotal,
      caCombos: m.totals.caCombos,
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
          d.hasCombosData ||
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
      acc.caCombos += r.caCombos;
      acc.caTotal += r.caTotal;
      acc.charges.achatsStock += r.charges.achatsStock;
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
      caCombos: 0,
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
    d.hasCombosData ||
    d.hasBoissonsData ||
    d.chargesTotal > 0
  );
}
