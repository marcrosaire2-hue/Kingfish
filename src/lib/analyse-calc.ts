import { shiftIsoDate } from "@/lib/zogbo-calc";
import type { UserShift, UserSite } from "@/lib/auth-types";
import type { VenteKind, VenteSite } from "@/lib/types";

export type AnalysePeriod = "day" | "week" | "month";
export type AnalyseKindFilter = VenteKind | "all";
export type AnalyseShiftFilter = UserShift | "all";

export type InsightKind = "fait" | "estimation" | "conseil" | "alerte";
export type InsightTone = "ok" | "attention" | "risque" | "info";
export type HealthTone = "ok" | "attention" | "risque" | "indetermine";
export type ProductAdvice =
  | "À surveiller"
  | "À développer"
  | "À maintenir"
  | "À optimiser"
  | "À revoir";
export type Confidence = "élevée" | "moyenne" | "faible";

export type AnalyseWindow = {
  from: string;
  to: string;
  previousFrom: string;
  previousTo: string;
  period: AnalysePeriod;
  date: string;
  label: string;
  previousLabel: string;
};

export type ProductSnapshot = {
  productId: string;
  name: string;
  kind: VenteKind;
  qty: number;
  caBrut: number;
  remises: number;
  caNet: number;
  costAmount: number;
  costKnown: boolean;
  marginAmount: number | null;
  marginPct: number | null;
};

export type RankedProduct = ProductSnapshot & {
  previousQty: number;
  previousCaNet: number;
  qtyChangePct: number | null;
  caChangePct: number | null;
  caSharePct: number;
  advice: ProductAdvice;
  confidence: Confidence;
};

export type Insight = {
  id: string;
  kind: InsightKind;
  tone: InsightTone;
  title: string;
  body: string;
  metric?: string;
  action?: string;
  confidence: Confidence;
  productId?: string;
  site?: string;
};

export type HealthCard = {
  key: "commercial" | "marge" | "stocks" | "depenses";
  label: string;
  tone: HealthTone;
  summary: string;
};

export type TotalsSnapshot = {
  caBrut: number;
  remises: number;
  caNet: number;
  cmv: number;
  margeBrute: number | null;
  chargesExploitation: number;
  resultat: number;
  pertes: number;
  achatsStock: number;
  amortissements: number;
  acquisitionsImmobilisations: number;
  caisseDepenses: number;
  caisseRecettes: number;
  epuises: number;
};

export type SliceRow = {
  key: string;
  label: string;
  caNet: number;
  sharePct: number;
};

export type AnalyseReport = {
  window: AnalyseWindow;
  current: TotalsSnapshot;
  previous: TotalsSnapshot;
  caChangePct: number | null;
  resultatChangePct: number | null;
  cmvChangePct: number | null;
  chargesChangePct: number | null;
  filteredCa: boolean;
  health: HealthCard[];
  positives: Insight[];
  watches: Insight[];
  conseils: Insight[];
  products: RankedProduct[];
  byKind: SliceRow[];
  bySite: SliceRow[];
  byShift: SliceRow[];
  limitations: string[];
};

export type HouseTotalsInput = {
  caNet: number;
  caBrut: number;
  remises: number;
  cmv: number;
  chargesExploitation: number;
  resultat: number;
  pertes: number;
  achatsStock: number;
  amortissements: number;
  acquisitionsImmobilisations: number;
  caisseDepenses: number;
  caisseRecettes: number;
  epuises: number;
};

export const KIND_LABELS: Record<VenteKind, string> = {
  plat: "Plats",
  boisson: "Boissons",
  local: "Accompagnements",
  combo: "Combos",
  extra: "Extra",
};

const SITE_LABELS: Record<VenteSite, string> = {
  zogbo: "Zogbo",
  gbegamey: "Gbégamey",
};

const SHIFT_LABELS: Record<UserShift, string> = {
  jour: "Équipe de jour",
  nuit: "Équipe de nuit",
  aucune: "Hors équipe",
};

export const PERIOD_LABELS: Record<AnalysePeriod, string> = {
  day: "jour",
  week: "semaine",
  month: "mois",
};

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind as VenteKind] ?? kind;
}

export function siteLabel(site: string): string {
  return SITE_LABELS[site as VenteSite] ?? site;
}

export function shiftLabel(shift: string): string {
  return SHIFT_LABELS[shift as UserShift] ?? shift;
}

export function lastDayOfMonth(yearMonth: string): string {
  const year = Number(yearMonth.slice(0, 4));
  const month = Number(yearMonth.slice(5, 7));
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${yearMonth}-${String(last).padStart(2, "0")}`;
}

export function listIsoDates(from: string, to: string): string[] {
  const out: string[] = [];
  let cursor: string | null = from;
  while (cursor && cursor <= to) {
    out.push(cursor);
    cursor = shiftIsoDate(cursor, 1);
  }
  return out;
}

function capDay(yearMonth: string, day: number): string {
  const last = lastDayOfMonth(yearMonth);
  const lastDay = Number(last.slice(8));
  const d = Math.min(day, lastDay);
  return `${yearMonth}-${String(d).padStart(2, "0")}`;
}

function previousYearMonth(yearMonth: string): string {
  const year = Number(yearMonth.slice(0, 4));
  const month = Number(yearMonth.slice(5, 7));
  if (month === 1) return `${year - 1}-12`;
  return `${year}-${String(month - 1).padStart(2, "0")}`;
}

export function analyseWindow(
  period: AnalysePeriod,
  date: string,
): AnalyseWindow {
  if (period === "day") {
    const previous = shiftIsoDate(date, -1) ?? date;
    return {
      from: date,
      to: date,
      previousFrom: previous,
      previousTo: previous,
      period,
      date,
      label: `Jour du ${date}`,
      previousLabel: `Jour du ${previous}`,
    };
  }
  if (period === "week") {
    const from = shiftIsoDate(date, -6) ?? date;
    const previousTo = shiftIsoDate(from, -1) ?? from;
    const previousFrom = shiftIsoDate(previousTo, -6) ?? previousTo;
    return {
      from,
      to: date,
      previousFrom,
      previousTo,
      period,
      date,
      label: `7 jours jusqu’au ${date}`,
      previousLabel: "7 jours précédents",
    };
  }
  const month = date.slice(0, 7);
  const from = `${month}-01`;
  const day = Number(date.slice(8));
  const prevMonth = previousYearMonth(month);
  return {
    from,
    to: date,
    previousFrom: `${prevMonth}-01`,
    previousTo: capDay(prevMonth, day),
    period,
    date,
    label: `Mois jusqu’au ${date}`,
    previousLabel: "Même durée le mois précédent",
  };
}

/** Variation relative. `null` si la base est nulle : pas d’alerte « parce que c’est grand ». */
export function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export function roundFcfa(n: number): number {
  return Math.max(0, Math.round(n));
}

/**
 * G6 / G7 : costPrice figé des boissons et extra = coût connu (y compris 0).
 * Plats / locaux : un montant 0 n’est pas un coût connu.
 */
export function costIsKnown(kind: string, costAmount: number): boolean {
  if (kind === "boisson" || kind === "extra") return true;
  return costAmount > 0;
}

export function productMargin(
  caNet: number,
  costAmount: number,
  known: boolean,
): { amount: number | null; pct: number | null } {
  if (!known) return { amount: null, pct: null };
  const amount = Math.round(caNet - costAmount);
  if (caNet <= 0) return { amount, pct: null };
  return { amount, pct: (amount / caNet) * 100 };
}

export function applyReductionsToProducts(
  products: Omit<
    ProductSnapshot,
    "remises" | "caNet" | "costKnown" | "marginAmount" | "marginPct"
  >[],
  remisesByKey: Map<string, number>,
): ProductSnapshot[] {
  return products.map((p) => {
    const key = `${p.kind}::${p.productId}`;
    const remises = roundFcfa(remisesByKey.get(key) ?? 0);
    const caNet = roundFcfa(Math.max(0, p.caBrut - remises));
    const known = costIsKnown(p.kind, p.costAmount);
    const margin = productMargin(caNet, p.costAmount, known);
    return {
      ...p,
      remises,
      caNet,
      costKnown: known,
      marginAmount: margin.amount,
      marginPct: margin.pct,
    };
  });
}

export function classifyProduct(
  current: ProductSnapshot,
  previous: ProductSnapshot | undefined,
  caSharePct: number,
  avgKnownMarginPct: number | null,
): { advice: ProductAdvice; confidence: Confidence } {
  const prevQty = previous?.qty ?? 0;
  const prevCa = previous?.caNet ?? 0;
  const qtyChange = pctChange(current.qty, prevQty);
  const hasHistory = prevQty >= 8 || prevCa > 0;
  const confidence: Confidence =
    prevQty >= 8 ? "élevée" : hasHistory ? "moyenne" : "faible";

  if (
    current.costKnown &&
    current.marginPct !== null &&
    caSharePct >= 8 &&
    current.marginPct < 20
  ) {
    return { advice: "À optimiser", confidence };
  }

  if (hasHistory && qtyChange !== null && qtyChange <= -25 && prevQty >= 8) {
    return { advice: "À surveiller", confidence };
  }

  if (
    hasHistory &&
    qtyChange !== null &&
    qtyChange >= 20 &&
    current.qty >= 8 &&
    (current.marginPct === null ||
      avgKnownMarginPct === null ||
      current.marginPct >= avgKnownMarginPct - 2)
  ) {
    return { advice: "À développer", confidence };
  }

  if (current.qty <= 2 && prevQty >= 10) {
    return { advice: "À surveiller", confidence };
  }

  if (current.qty < 3 && prevQty < 3 && hasHistory) {
    return { advice: "À revoir", confidence: "faible" };
  }

  return { advice: "À maintenir", confidence };
}

export function rankProducts(
  current: ProductSnapshot[],
  previous: ProductSnapshot[],
): RankedProduct[] {
  const prevMap = new Map(
    previous.map((p) => [`${p.kind}::${p.productId}`, p]),
  );
  const caTotal = current.reduce((s, p) => s + p.caNet, 0);
  const knownMargins = current
    .filter((p) => p.costKnown && p.marginPct !== null)
    .map((p) => p.marginPct as number);
  const avgKnown =
    knownMargins.length > 0
      ? knownMargins.reduce((s, n) => s + n, 0) / knownMargins.length
      : null;

  const ranked: RankedProduct[] = current.map((p) => {
    const prev = prevMap.get(`${p.kind}::${p.productId}`);
    const caSharePct = caTotal > 0 ? (p.caNet / caTotal) * 100 : 0;
    const { advice, confidence } = classifyProduct(
      p,
      prev,
      caSharePct,
      avgKnown,
    );
    return {
      ...p,
      previousQty: prev?.qty ?? 0,
      previousCaNet: prev?.caNet ?? 0,
      qtyChangePct: pctChange(p.qty, prev?.qty ?? 0),
      caChangePct: pctChange(p.caNet, prev?.caNet ?? 0),
      caSharePct,
      advice,
      confidence,
    };
  });

  ranked.sort((a, b) => b.caNet - a.caNet || b.qty - a.qty);
  return ranked;
}

export function slicesFromMap(
  values: Map<string, number>,
  labelOf: (key: string) => string,
): SliceRow[] {
  const total = [...values.values()].reduce((s, n) => s + n, 0);
  return [...values.entries()]
    .map(([key, caNet]) => ({
      key,
      label: labelOf(key),
      caNet,
      sharePct: total > 0 ? (caNet / total) * 100 : 0,
    }))
    .sort((a, b) => b.caNet - a.caNet);
}

export function emptyTotals(): TotalsSnapshot {
  return {
    caBrut: 0,
    remises: 0,
    caNet: 0,
    cmv: 0,
    margeBrute: null,
    chargesExploitation: 0,
    resultat: 0,
    pertes: 0,
    achatsStock: 0,
    amortissements: 0,
    acquisitionsImmobilisations: 0,
    caisseDepenses: 0,
    caisseRecettes: 0,
    epuises: 0,
  };
}

export function snapshotFromHouse(input: HouseTotalsInput): TotalsSnapshot {
  const margeBrute =
    input.caNet > 0 || input.cmv > 0
      ? Math.round(input.caNet - input.cmv)
      : null;
  return {
    caBrut: roundFcfa(input.caBrut),
    remises: roundFcfa(input.remises),
    caNet: roundFcfa(input.caNet),
    cmv: roundFcfa(input.cmv),
    margeBrute,
    chargesExploitation: roundFcfa(input.chargesExploitation),
    resultat: Math.round(input.resultat),
    pertes: roundFcfa(input.pertes),
    achatsStock: roundFcfa(input.achatsStock),
    amortissements: roundFcfa(input.amortissements),
    acquisitionsImmobilisations: roundFcfa(input.acquisitionsImmobilisations),
    caisseDepenses: roundFcfa(input.caisseDepenses),
    caisseRecettes: roundFcfa(input.caisseRecettes),
    epuises: Math.max(0, Math.round(input.epuises)),
  };
}

function fmtPct(n: number | null): string {
  if (n === null) return "n.d.";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(0)} %`;
}

function fmtFcfa(n: number): string {
  return `${new Intl.NumberFormat("fr-FR").format(Math.round(n))} FCFA`;
}

function pushLimited(target: Insight[], item: Insight, max: number) {
  if (target.length < max) target.push(item);
}

export function buildHealth(
  current: TotalsSnapshot,
  previous: TotalsSnapshot,
  filteredCa: boolean,
): HealthCard[] {
  const caPct = pctChange(current.caNet, previous.caNet);
  const commercial: HealthCard = {
    key: "commercial",
    label: "Santé commerciale",
    tone: "indetermine",
    summary: filteredCa
      ? "CA filtré (équipe ou nature) : comparer avec prudence."
      : "Pas assez d’historique pour juger la tendance.",
  };
  if (!filteredCa && caPct !== null) {
    if (caPct >= 10) {
      commercial.tone = "ok";
      commercial.summary = `CA net en hausse de ${fmtPct(caPct)} vs période précédente.`;
    } else if (caPct <= -10) {
      commercial.tone = "risque";
      commercial.summary = `CA net en baisse de ${fmtPct(caPct)} vs période précédente.`;
    } else {
      commercial.tone = "attention";
      commercial.summary = `CA net quasi stable (${fmtPct(caPct)}).`;
    }
  }

  const marge: HealthCard = {
    key: "marge",
    label: "Santé de la marge",
    tone: "indetermine",
    summary: "Marge non certifiée : CMV maison, pas un score d’expert.",
  };
  if (current.caNet > 0 && current.cmv > 0 && current.margeBrute !== null) {
    const pct = (current.margeBrute / current.caNet) * 100;
    const prevPct =
      previous.caNet > 0 && previous.margeBrute !== null
        ? (previous.margeBrute / previous.caNet) * 100
        : null;
    const delta = prevPct === null ? null : pct - prevPct;
    if (delta !== null && delta <= -8) {
      marge.tone = "risque";
      marge.summary = `Marge brute d’exploitation ${pct.toFixed(0)} %, en repli de ${Math.abs(delta).toFixed(0)} points.`;
    } else if (delta !== null && delta >= 5) {
      marge.tone = "ok";
      marge.summary = `Marge brute d’exploitation ${pct.toFixed(0)} %, en amélioration.`;
    } else if (pct < 25) {
      marge.tone = "attention";
      marge.summary = `Marge brute d’exploitation ${pct.toFixed(0)} % — à surveiller.`;
    } else {
      marge.tone = "ok";
      marge.summary = `Marge brute d’exploitation ${pct.toFixed(0)} %.`;
    }
  } else if (current.caNet > 0 && current.cmv === 0) {
    marge.summary = "CMV maison à 0 sur la période : marge non interprétable.";
  }

  const stocks: HealthCard = {
    key: "stocks",
    label: "Santé des stocks",
    tone: current.epuises > 0 ? "attention" : "ok",
    summary:
      current.epuises > 0
        ? `${current.epuises} produit(s) à rupture en fin de période.`
        : "Aucune rupture cuisine/salle signalée en fin de période.",
  };

  const depPct = pctChange(
    current.chargesExploitation,
    previous.chargesExploitation,
  );
  const depenses: HealthCard = {
    key: "depenses",
    label: "Niveau de dépenses",
    tone: "indetermine",
    summary: "Charges d’exploitation (hors achats stock et acquisitions d’immos).",
  };
  if (depPct !== null) {
    if (depPct >= 20 && (caPct === null || caPct <= 0)) {
      depenses.tone = "risque";
      depenses.summary = `Charges d’exploitation ${fmtPct(depPct)} alors que le CA ne progresse pas.`;
    } else if (depPct >= 20) {
      depenses.tone = "attention";
      depenses.summary = `Charges d’exploitation en hausse de ${fmtPct(depPct)}.`;
    } else if (depPct <= -10) {
      depenses.tone = "ok";
      depenses.summary = `Charges d’exploitation en baisse de ${fmtPct(depPct)}.`;
    } else {
      depenses.tone = "ok";
      depenses.summary = `Charges d’exploitation ${fmtPct(depPct)} vs période précédente.`;
    }
  }

  return [commercial, marge, stocks, depenses];
}

export function buildInsights(input: {
  current: TotalsSnapshot;
  previous: TotalsSnapshot;
  products: RankedProduct[];
  bySite: SliceRow[];
  byShift: SliceRow[];
  filteredCa: boolean;
}): { positives: Insight[]; watches: Insight[]; conseils: Insight[] } {
  const positives: Insight[] = [];
  const watches: Insight[] = [];
  const conseils: Insight[] = [];
  const { current, previous, products, bySite, byShift, filteredCa } = input;
  const caPct = pctChange(current.caNet, previous.caNet);
  const resPct = pctChange(current.resultat, previous.resultat);
  const pertesPct = pctChange(current.pertes, previous.pertes);
  const remiseRate = current.caBrut > 0 ? (current.remises / current.caBrut) * 100 : 0;
  const prevRemiseRate =
    previous.caBrut > 0 ? (previous.remises / previous.caBrut) * 100 : 0;

  if (!filteredCa && caPct !== null && caPct >= 15) {
    pushLimited(
      positives,
      {
        id: "ca-up",
        kind: "fait",
        tone: "ok",
        title: "CA net en nette hausse",
        body: `Le CA net passe de ${fmtFcfa(previous.caNet)} à ${fmtFcfa(current.caNet)} (${fmtPct(caPct)}).`,
        metric: fmtPct(caPct),
        confidence: "élevée",
      },
      5,
    );
  }

  if (!filteredCa && resPct !== null && resPct >= 15 && current.resultat > 0) {
    pushLimited(
      positives,
      {
        id: "resultat-up",
        kind: "fait",
        tone: "ok",
        title: "Résultat d’exploitation en amélioration",
        body: `Le résultat (CA net − charges d’exploitation, G1–G12) progresse de ${fmtPct(resPct)}.`,
        metric: fmtFcfa(current.resultat),
        confidence: "élevée",
      },
      5,
    );
  }

  if (pertesPct !== null && pertesPct <= -30 && previous.pertes >= 10_000) {
    pushLimited(
      positives,
      {
        id: "pertes-down",
        kind: "fait",
        tone: "ok",
        title: "Pertes en recul",
        body: `Le coût des pertes passe de ${fmtFcfa(previous.pertes)} à ${fmtFcfa(current.pertes)}.`,
        confidence: "élevée",
      },
      5,
    );
  }

  for (const p of products.filter((x) => x.advice === "À développer").slice(0, 3)) {
    pushLimited(
      positives,
      {
        id: `dev-${p.kind}-${p.productId}`,
        kind: "fait",
        tone: "ok",
        title: `${p.name} progresse`,
        body: `CA net ${fmtFcfa(p.caNet)}, volumes ${fmtPct(p.qtyChangePct)}.`,
        confidence: p.confidence,
        productId: p.productId,
      },
      5,
    );
  }

  if (!filteredCa && caPct !== null && caPct <= -15) {
    pushLimited(
      watches,
      {
        id: "ca-down",
        kind: "alerte",
        tone: "risque",
        title: "Baisse du CA net",
        body: `Le CA net recule de ${fmtPct(caPct)} par rapport à la période comparable.`,
        metric: fmtPct(caPct),
        action:
          "Vérifier fréquentation, ruptures, prix et visibilité POS avant de conclure à une baisse de demande.",
        confidence: "élevée",
      },
      8,
    );
  }

  if (remiseRate >= 8 && current.caBrut > 0) {
    pushLimited(
      watches,
      {
        id: "remises",
        kind: "alerte",
        tone: "attention",
        title: "Remises POS élevées",
        body: `Les remises représentent ${remiseRate.toFixed(1)} % du CA brut (précédent : ${prevRemiseRate.toFixed(1)} %).`,
        metric: fmtFcfa(current.remises),
        action: "Contrôler qui accorde les remises et sur quels tickets.",
        confidence: "élevée",
      },
      8,
    );
  }

  const withSales = products.filter((p) => p.caNet > 0);
  const top3 = withSales.slice(0, 3).reduce((s, p) => s + p.caNet, 0);
  if (withSales.length >= 5 && current.caNet > 0 && top3 / current.caNet >= 0.7) {
    pushLimited(
      watches,
      {
        id: "concentration",
        kind: "alerte",
        tone: "attention",
        title: "CA concentré sur peu de produits",
        body: `Les 3 premiers produits pèsent ${((top3 / current.caNet) * 100).toFixed(0)} % du CA net.`,
        action: "Surveiller la dépendance : une rupture sur un best-seller pèserait lourd.",
        confidence: "moyenne",
      },
      8,
    );
  }

  if (pertesPct !== null && pertesPct >= 50 && previous.pertes >= 10_000) {
    pushLimited(
      watches,
      {
        id: "pertes-up",
        kind: "alerte",
        tone: "risque",
        title: "Pertes en forte hausse",
        body: `Coût des pertes ${fmtFcfa(current.pertes)}, ${fmtPct(pertesPct)} vs période précédente (valorisation catalogue, M5 inchangée).`,
        action: "Relire le journal des pertes : casse, péremption, saisie.",
        confidence: "élevée",
      },
      8,
    );
  }

  if (current.epuises >= 3) {
    pushLimited(
      watches,
      {
        id: "ruptures",
        kind: "alerte",
        tone: "attention",
        title: "Plusieurs ruptures en fin de période",
        body: `${current.epuises} produits cuisine/salle à zéro. Les ventes manquées ne sont pas estimées.`,
        action: "Vérifier réassort et plafonds de vente.",
        confidence: "moyenne",
      },
      8,
    );
  }

  const caissePct = pctChange(current.caisseDepenses, previous.caisseDepenses);
  if (
    current.caisseDepenses > 0 &&
    previous.caisseDepenses > 50_000 &&
    caissePct !== null &&
    caissePct >= 80
  ) {
    pushLimited(
      watches,
      {
        id: "caisse-atypique",
        kind: "alerte",
        tone: "attention",
        title: "Dépenses de caisse atypiques",
        body: `Sorties de caisse ${fmtFcfa(current.caisseDepenses)} vs ${fmtFcfa(previous.caisseDepenses)}. Ce n’est pas une charge du CdR (M1).`,
        action: "Contrôler les sessions et les pièces, sans les ventiler en charges.",
        confidence: "moyenne",
      },
      8,
    );
  }

  if (bySite.length === 2 && bySite[0] && bySite[1] && bySite[1].caNet > 0) {
    const ratio = bySite[0].caNet / bySite[1].caNet;
    if (ratio >= 2.2) {
      pushLimited(
        watches,
        {
          id: "sites",
          kind: "fait",
          tone: "attention",
          title: "Écart important entre sites",
          body: `${bySite[0].label} (${fmtFcfa(bySite[0].caNet)}) pèse plus du double de ${bySite[1].label} (${fmtFcfa(bySite[1].caNet)}).`,
          action: "Comparer mix, horaires et ruptures — pas d’affectation des charges siège (G15).",
          confidence: "moyenne",
          site: bySite[1].key,
        },
        8,
      );
    }
  }

  const jour = byShift.find((s) => s.key === "jour");
  const nuit = byShift.find((s) => s.key === "nuit");
  if (jour && nuit && Math.min(jour.caNet, nuit.caNet) > 0) {
    const hi = jour.caNet >= nuit.caNet ? jour : nuit;
    const lo = hi === jour ? nuit : jour;
    if (hi.caNet / lo.caNet >= 2.2) {
      pushLimited(
        watches,
        {
          id: "equipes",
          kind: "fait",
          tone: "attention",
          title: "Écart important entre équipes",
          body: `${hi.label} ${fmtFcfa(hi.caNet)} vs ${lo.label} ${fmtFcfa(lo.caNet)}.`,
          action: "Vérifier effectifs, horaires et mix — pas une preuve de performance individuelle.",
          confidence: "moyenne",
        },
        8,
      );
    }
  }

  const declining = products.filter(
    (p) =>
      p.advice === "À surveiller" &&
      p.qtyChangePct !== null &&
      p.qtyChangePct <= -40,
  );
  for (const p of declining.slice(0, 2)) {
    pushLimited(
      watches,
      {
        id: `drop-${p.kind}-${p.productId}`,
        kind: "alerte",
        tone: "attention",
        title: `${p.name} : volumes en baisse`,
        body: `Quantité ${p.previousQty} → ${p.qty} (${fmtPct(p.qtyChangePct)}).`,
        action:
          "Vérifier stock, statut POS et disponibilité avant d’en déduire une baisse de demande.",
        confidence: p.confidence,
        productId: p.productId,
      },
      8,
    );
  }

  for (const p of products.filter((x) => x.advice === "À optimiser").slice(0, 2)) {
    pushLimited(
      conseils,
      {
        id: `opt-${p.kind}-${p.productId}`,
        kind: "conseil",
        tone: "attention",
        title: `À optimiser — ${p.name}`,
        body: `Fait : CA net ${fmtFcfa(p.caNet)} (${p.caSharePct.toFixed(0)} % du mix). Estimation : marge ${p.marginPct?.toFixed(0)} % sur coût figé.`,
        action: "Revoir portion, prix ou visibilité — sans changer un tarif historique déjà vendu (G4).",
        metric: p.marginPct !== null ? `${p.marginPct.toFixed(0)} %` : undefined,
        confidence: p.confidence,
        productId: p.productId,
      },
      6,
    );
  }

  for (const p of products.filter((x) => x.advice === "À développer").slice(0, 2)) {
    pushLimited(
      conseils,
      {
        id: `boost-${p.kind}-${p.productId}`,
        kind: "conseil",
        tone: "ok",
        title: `À développer — ${p.name}`,
        body: `Fait : CA ${fmtFcfa(p.caNet)}, volumes ${fmtPct(p.qtyChangePct)}.${
          p.costKnown && p.marginPct !== null
            ? ` Estimation : marge ${p.marginPct.toFixed(0)} %.`
            : " Marge produit non calculable (coût inconnu)."
        }`,
        action: "Maintenir la disponibilité et envisager de renforcer la visibilité POS.",
        confidence: p.confidence,
        productId: p.productId,
      },
      6,
    );
  }

  if (!filteredCa && caPct !== null && caPct <= -15) {
    pushLimited(
      conseils,
      {
        id: "conseil-ca",
        kind: "conseil",
        tone: "risque",
        title: "Investiguer la baisse de CA",
        body: `Le recul de ${fmtPct(caPct)} est un fait de période comparable, pas une projection.`,
        action: "Croiser ruptures, jours fériés et tickets avant d’ajuster l’offre.",
        confidence: "élevée",
      },
      6,
    );
  }

  if (current.achatsStock > 0) {
    pushLimited(
      conseils,
      {
        id: "g8",
        kind: "fait",
        tone: "info",
        title: "Achats stock hors résultat",
        body: `${fmtFcfa(current.achatsStock)} d’achats stock sur la période : ce n’est pas une charge d’exploitation (G8).`,
        confidence: "élevée",
      },
      6,
    );
  }

  watches.sort((a, b) => {
    const order: Record<InsightTone, number> = {
      risque: 0,
      attention: 1,
      info: 2,
      ok: 3,
    };
    return order[a.tone] - order[b.tone];
  });

  return { positives, watches, conseils };
}

export function buildLimitations(
  filteredCa: boolean,
  products: RankedProduct[],
): string[] {
  const out = [
    "Les recommandations ne déclenchent aucune écriture, commande, prix ou mouvement de stock.",
    "Ce n’est pas un score financier certifié ni un avis d’expert-comptable.",
    "M1 : les flux de caisse seuls ne sont pas des charges du compte de résultat.",
    "G8 / G9 : achats stock et acquisitions d’immobilisations restent hors charges d’exploitation.",
    "G15 : aucune clé d’affectation des charges siège n’est inventée.",
  ];
  if (filteredCa) {
    out.push(
      "Filtre équipe ou nature : le CA affiché est filtré ; CMV, charges et résultat restent au périmètre maison / site.",
    );
  }
  if (products.some((p) => !p.costKnown)) {
    out.push(
      "Marge produit : « coût inconnu » lorsque le costPrice historique n’est pas fiable (plats / locaux).",
    );
  }
  return out;
}

export function buildAnalyseReport(input: {
  window: AnalyseWindow;
  current: TotalsSnapshot;
  previous: TotalsSnapshot;
  products: RankedProduct[];
  byKind: SliceRow[];
  bySite: SliceRow[];
  byShift: SliceRow[];
  filteredCa: boolean;
}): AnalyseReport {
  const health = buildHealth(input.current, input.previous, input.filteredCa);
  const { positives, watches, conseils } = buildInsights(input);
  return {
    window: input.window,
    current: input.current,
    previous: input.previous,
    caChangePct: pctChange(input.current.caNet, input.previous.caNet),
    resultatChangePct: pctChange(input.current.resultat, input.previous.resultat),
    cmvChangePct: pctChange(input.current.cmv, input.previous.cmv),
    chargesChangePct: pctChange(
      input.current.chargesExploitation,
      input.previous.chargesExploitation,
    ),
    filteredCa: input.filteredCa,
    health,
    positives,
    watches,
    conseils,
    products: input.products,
    byKind: input.byKind,
    bySite: input.bySite,
    byShift: input.byShift,
    limitations: buildLimitations(input.filteredCa, input.products),
  };
}

export type AnalyseScopeResult =
  | { ok: true; site: VenteSite | null }
  | { ok: false; error: string; status: 400 | 403 };

export function resolveAnalyseSite(
  userSite: UserSite,
  requested: string | null,
): AnalyseScopeResult {
  const locked = userSite === "tous" ? null : userSite;
  const raw = (requested ?? "all").trim().toLowerCase();
  const wantAll = raw === "" || raw === "all" || raw === "tous";

  if (locked) {
    if (!wantAll && raw !== locked) {
      return { ok: false, error: "Site non autorisé.", status: 403 };
    }
    return { ok: true, site: locked };
  }

  if (wantAll) return { ok: true, site: "zogbo" };
  if (raw === "zogbo" || raw === "gbegamey") return { ok: true, site: raw };
  return { ok: false, error: "Site invalide.", status: 400 };
}

export function parseAnalysePeriod(raw: string | null): AnalysePeriod {
  if (raw === "day" || raw === "week" || raw === "month") return raw;
  return "month";
}

export function parseAnalyseShift(
  raw: string | null,
): AnalyseShiftFilter | null {
  if (!raw || raw === "all" || raw === "tous") return "all";
  if (raw === "jour" || raw === "nuit" || raw === "aucune") return raw;
  return null;
}

export function parseAnalyseKind(raw: string | null): AnalyseKindFilter | null {
  if (!raw || raw === "all" || raw === "tous") return "all";
  if (raw === "plat" || raw === "boisson" || raw === "local" || raw === "extra") {
    return raw;
  }
  return null;
}
