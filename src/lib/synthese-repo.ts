import { getDb } from "@/lib/mongodb";
import { getParametres } from "@/lib/parametres-repo";
import { sumPertesCost } from "@/lib/pertes-repo";
import type {
  BoissonsDay,
  CombosDay,
  DayCharges,
  DayPoint,
  GbegameyDay,
  MonthPoint,
  ProductRank,
  ProductRanking,
  RankPair,
  SiteRank,
  YearPoint,
  ZogboDay,
} from "@/lib/types";
import {
  buildDayPoint,
  buildYearPoint,
  computeDayRevenue,
  daysInMonth,
  emptyCharges,
  emptyVenteTotals,
  parseYearMonth,
  sumMonth,
  type VenteTotals,
} from "@/lib/synthese-calc";
import type { VenteKind, VenteSite } from "@/lib/types";

type ZogboDoc = Omit<ZogboDay, "date"> & { _id: string };
type GbegameyDoc = Omit<GbegameyDay, "date"> & { _id: string };
type CombosDoc = Omit<CombosDay, "date"> & { _id: string };
type BoissonsDoc = Omit<BoissonsDay, "date"> & { _id: string };
type ChargesDoc = Omit<DayCharges, "date"> & { _id: string };

function toZogbo(doc: ZogboDoc): ZogboDay {
  return {
    date: doc._id,
    status: doc.status ?? "ouverte",
    lines: doc.lines ?? [],
    movements: doc.movements ?? [],
    updatedAt: doc.updatedAt ?? null,
  };
}

function toGbegamey(doc: GbegameyDoc): GbegameyDay {
  return {
    date: doc._id,
    status: doc.status ?? "ouverte",
    transferLines: doc.transferLines ?? [],
    localLines: doc.localLines ?? [],
    updatedAt: doc.updatedAt ?? null,
  };
}

function toCombos(doc: CombosDoc): CombosDay {
  return {
    date: doc._id,
    status: doc.status ?? "ouverte",
    lines: doc.lines ?? [],
    movements: Array.isArray(doc.movements) ? doc.movements : [],
    updatedAt: doc.updatedAt ?? null,
  };
}

function toBoissons(doc: BoissonsDoc): BoissonsDay {
  return {
    date: doc._id,
    status: doc.status ?? "ouverte",
    lines: doc.lines ?? [],
    movements: Array.isArray(doc.movements) ? doc.movements : [],
    updatedAt: doc.updatedAt ?? null,
  };
}

function toCharges(doc: ChargesDoc | null, date: string): DayCharges {
  if (!doc) return emptyCharges(date);
  return {
    date,
    matieresPremieres: Number(doc.matieresPremieres) || 0,
    loyer: Number(doc.loyer) || 0,
    salaires: Number(doc.salaires) || 0,
    electricite: Number(doc.electricite) || 0,
    carburant: Number(doc.carburant) || 0,
    reparations: Number(doc.reparations) || 0,
    updatedAt: doc.updatedAt ?? null,
  };
}

/**
 * Injecte le coût des pertes dans les charges du jour. Il n'est jamais stocké
 * dans charges_jours : le journal des pertes fait foi, et une annulation doit
 * se répercuter immédiatement sur le résultat.
 */
async function withPertes(
  charges: Map<string, DayCharges>,
  start: string,
  end: string,
  scopeSite?: VenteSite | null,
): Promise<Map<string, DayCharges>> {
  const { parJour } = await sumPertesCost({
    from: start,
    to: end,
    site: scopeSite ?? "all",
  });
  for (const [date, cout] of Object.entries(parJour) as [string, number][]) {
    const existante = charges.get(date) ?? emptyCharges(date);
    charges.set(date, { ...existante, pertes: cout });
  }
  return charges;
}

type Maps = {
  zogbo: Map<string, ZogboDay>;
  gbegamey: Map<string, GbegameyDay>;
  combos: Map<string, CombosDay>;
  boissons: Map<string, BoissonsDay>;
  charges: Map<string, DayCharges>;
  ventes: Map<string, VenteTotals>;
};

type VenteGroup = {
  _id: { date: string; site: VenteSite; kind: VenteKind };
  amount: number;
  marge: number;
  count: number;
};

/** Lignes qui comptent dans le CA final (comme AquaPro Validé). */
function caActifMatch(extra: Record<string, unknown> = {}) {
  return {
    ...extra,
    cancelledAt: null,
    caExcluded: { $ne: true },
  };
}

/**
 * CA réellement encaissé, repris du journal des ventes (prix figés à la
 * vente) plutôt que recalculé depuis le catalogue courant.
 */
async function loadVenteTotals(
  match: Record<string, unknown>,
): Promise<Map<string, VenteTotals>> {
  const db = await getDb();
  const rows = await db
    .collection("ventes_log")
    .aggregate<VenteGroup>([
      { $match: caActifMatch(match) },
      {
        $group: {
          _id: { date: "$date", site: "$site", kind: "$kind" },
          amount: { $sum: "$amount" },
          marge: {
            $sum: {
              $multiply: [
                "$qty",
                { $subtract: ["$unitPrice", { $ifNull: ["$costPrice", 0] }] },
              ],
            },
          },
          count: { $sum: 1 },
        },
      },
    ])
    .toArray();

  const out = new Map<string, VenteTotals>();
  for (const row of rows) {
    const { date, site, kind } = row._id;
    const totals = out.get(date) ?? emptyVenteTotals();
    const zogbo = site === "zogbo";

    if (kind === "plat") {
      if (zogbo) totals.platsZogbo += row.amount;
      else totals.platsGbegamey += row.amount;
    } else if (kind === "local") {
      if (zogbo) totals.localZogbo += row.amount;
      else totals.localGbegamey += row.amount;
    } else if (kind === "combo") {
      if (zogbo) totals.combosZogbo += row.amount;
      else totals.combosGbegamey += row.amount;
    } else if (kind === "boisson") {
      if (zogbo) totals.boissonsZogbo += row.amount;
      else totals.boissonsGbegamey += row.amount;
      totals.margeBoissons += row.marge;
    } else if (kind === "extra") {
      if (zogbo) totals.extraZogbo += row.amount;
      else totals.extraGbegamey += row.amount;
    }

    totals.count += row.count;
    out.set(date, totals);
  }
  return out;
}

type ProductAgg = {
  _id: { productId: string; name: string; kind: string };
  qty: number;
  ca: number;
};

/** Top / bas produits par CA sur la période (ventes non annulées). */
export async function getProductRanking(
  match: Record<string, unknown>,
  limit = 5,
): Promise<ProductRanking> {
  const db = await getDb();
  const emptyPair = (): RankPair => ({ best: [], worst: [] });
  const empty: ProductRanking = {
    best: [],
    worst: [],
    sites: [],
    plats: emptyPair(),
    accompagnements: emptyPair(),
    boissons: emptyPair(),
  };

  const [productRows, siteRows] = await Promise.all([
    db
      .collection("ventes_log")
      .aggregate<ProductAgg>([
        { $match: caActifMatch({ ...match, qty: { $gt: 0 } }) },
        {
          $group: {
            _id: {
              productId: "$productId",
              name: "$name",
              kind: "$kind",
            },
            qty: { $sum: "$qty" },
            ca: { $sum: "$amount" },
          },
        },
        { $sort: { ca: -1, qty: -1 } },
      ])
      .toArray(),
    db
      .collection("ventes_log")
      .aggregate<{ _id: string; qty: number; ca: number }>([
        { $match: caActifMatch({ ...match, qty: { $gt: 0 } }) },
        {
          $group: {
            _id: "$site",
            qty: { $sum: "$qty" },
            ca: { $sum: "$amount" },
          },
        },
        { $sort: { ca: -1 } },
      ])
      .toArray(),
  ]);

  const all: ProductRank[] = productRows.map((r) => ({
    productId: String(r._id.productId ?? ""),
    name: String(r._id.name || "Sans nom"),
    kind: String(r._id.kind || "extra"),
    qty: Number(r.qty) || 0,
    ca: Number(r.ca) || 0,
  }));

  const sites: SiteRank[] = siteRows.map((r) => ({
    site: String(r._id || ""),
    label:
      r._id === "zogbo" ? "Zogbo" : r._id === "gbegamey" ? "Gbégamey" : String(r._id),
    qty: Number(r.qty) || 0,
    ca: Number(r.ca) || 0,
  }));

  if (all.length === 0) return { ...empty, sites };

  function pairFor(kinds: string[]): RankPair {
    const subset = all.filter((p) => kinds.includes(p.kind));
    if (subset.length === 0) return emptyPair();
    const best = subset.slice(0, Math.min(limit, subset.length));
    const bestKeys = new Set(best.map((p) => `${p.kind}:${p.productId}`));
    let worst = [...subset]
      .reverse()
      .filter((p) => !bestKeys.has(`${p.kind}:${p.productId}`))
      .slice(0, Math.min(limit, subset.length));
    if (worst.length === 0 && subset.length > 1) {
      worst = [...subset].reverse().slice(0, Math.min(limit, subset.length - 1));
    }
    return { best, worst };
  }

  const overallBest = all.slice(0, Math.min(limit, all.length));
  const bestKeys = new Set(overallBest.map((p) => `${p.kind}:${p.productId}`));
  let overallWorst = [...all]
    .reverse()
    .filter((p) => !bestKeys.has(`${p.kind}:${p.productId}`))
    .slice(0, Math.min(limit, all.length));
  if (overallWorst.length === 0 && all.length > 1) {
    overallWorst = [...all]
      .reverse()
      .slice(0, Math.min(limit, all.length - 1));
  }

  return {
    best: overallBest,
    worst: overallWorst,
    sites,
    plats: pairFor(["plat"]),
    accompagnements: pairFor(["local"]),
    boissons: pairFor(["boisson"]),
  };
}

/** CA période : actif (Validé) + exclus (annulées / en cours) pour notification UI. */
export async function getVenteCancelNotice(
  match: Record<string, unknown>,
): Promise<{
  caActif: number;
  caAnnule: number;
  nActif: number;
  nAnnule: number;
}> {
  const db = await getDb();
  const [actif, exclus] = await Promise.all([
    db
      .collection("ventes_log")
      .aggregate<{ ca: number; n: number }>([
        { $match: caActifMatch(match) },
        { $group: { _id: null, ca: { $sum: "$amount" }, n: { $sum: 1 } } },
      ])
      .toArray(),
    db
      .collection("ventes_log")
      .aggregate<{ ca: number; n: number }>([
        {
          $match: {
            ...match,
            $or: [{ cancelledAt: { $ne: null } }, { caExcluded: true }],
          },
        },
        { $group: { _id: null, ca: { $sum: "$amount" }, n: { $sum: 1 } } },
      ])
      .toArray(),
  ]);

  return {
    caActif: Number(actif[0]?.ca) || 0,
    caAnnule: Number(exclus[0]?.ca) || 0,
    nActif: Number(actif[0]?.n) || 0,
    nAnnule: Number(exclus[0]?.n) || 0,
  };
}

/** Cumuls CA final hors annulées / en cours (jour / mois / historique). */
export async function getCaCumuls(
  date: string,
  scopeSite?: VenteSite | null,
): Promise<{
  jour: number;
  mois: number;
  total: number;
}> {
  const db = await getDb();
  const monthPrefix = date.slice(0, 7);
  const siteFilter = scopeSite ? { site: scopeSite } : {};
  const [jour, mois, total] = await Promise.all([
    db
      .collection("ventes_log")
      .aggregate<{ ca: number }>([
        { $match: caActifMatch({ date, ...siteFilter }) },
        { $group: { _id: null, ca: { $sum: "$amount" } } },
      ])
      .toArray(),
    db
      .collection("ventes_log")
      .aggregate<{ ca: number }>([
        {
          $match: caActifMatch({
            date: { $gte: `${monthPrefix}-01`, $lte: `${monthPrefix}-31` },
            ...siteFilter,
          }),
        },
        { $group: { _id: null, ca: { $sum: "$amount" } } },
      ])
      .toArray(),
    db
      .collection("ventes_log")
      .aggregate<{ ca: number }>([
        { $match: caActifMatch(siteFilter) },
        { $group: { _id: null, ca: { $sum: "$amount" } } },
      ])
      .toArray(),
  ]);
  return {
    jour: Number(jour[0]?.ca) || 0,
    mois: Number(mois[0]?.ca) || 0,
    total: Number(total[0]?.ca) || 0,
  };
}

async function loadMaps(
  dates: string[],
  scopeSite?: VenteSite | null,
): Promise<Maps> {
  if (dates.length === 0) {
    return {
      zogbo: new Map(),
      gbegamey: new Map(),
      combos: new Map(),
      boissons: new Map(),
      charges: new Map(),
      ventes: new Map(),
    };
  }

  const db = await getDb();
  const filter = { _id: { $in: dates } };
  const venteMatch: Record<string, unknown> = { date: { $in: dates } };
  if (scopeSite) venteMatch.site = scopeSite;

  const [
    zogboDocs,
    gbegameyDocs,
    combosDocs,
    boissonsDocs,
    chargesDocs,
    ventes,
  ] = await Promise.all([
    scopeSite === "gbegamey"
      ? Promise.resolve([])
      : db.collection<ZogboDoc>("zogbo_jours").find(filter).toArray(),
    scopeSite === "zogbo"
      ? Promise.resolve([])
      : db.collection<GbegameyDoc>("gbegamey_jours").find(filter).toArray(),
    db.collection<CombosDoc>("combos_jours").find(filter).toArray(),
    db.collection<BoissonsDoc>("boissons_jours").find(filter).toArray(),
    db.collection<ChargesDoc>("charges_jours").find(filter).toArray(),
    loadVenteTotals(venteMatch),
  ]);

  return {
    zogbo: new Map(zogboDocs.map((d) => [d._id, toZogbo(d)])),
    gbegamey: new Map(gbegameyDocs.map((d) => [d._id, toGbegamey(d)])),
    combos: new Map(combosDocs.map((d) => [d._id, toCombos(d)])),
    boissons: new Map(boissonsDocs.map((d) => [d._id, toBoissons(d)])),
    charges: await withPertes(
      new Map(chargesDocs.map((d) => [d._id, toCharges(d, d._id)])),
      dates[0]!,
      dates[dates.length - 1]!,
      scopeSite,
    ),
    ventes,
  };
}

async function loadRange(
  start: string,
  end: string,
  scopeSite?: VenteSite | null,
): Promise<Maps> {
  const db = await getDb();
  const filter = { _id: { $gte: start, $lte: end } };
  const venteMatch: Record<string, unknown> = {
    date: { $gte: start, $lte: end },
  };
  if (scopeSite) venteMatch.site = scopeSite;

  const [
    zogboDocs,
    gbegameyDocs,
    combosDocs,
    boissonsDocs,
    chargesDocs,
    ventes,
  ] = await Promise.all([
    scopeSite === "gbegamey"
      ? Promise.resolve([])
      : db.collection<ZogboDoc>("zogbo_jours").find(filter).toArray(),
    scopeSite === "zogbo"
      ? Promise.resolve([])
      : db.collection<GbegameyDoc>("gbegamey_jours").find(filter).toArray(),
    db.collection<CombosDoc>("combos_jours").find(filter).toArray(),
    db.collection<BoissonsDoc>("boissons_jours").find(filter).toArray(),
    db.collection<ChargesDoc>("charges_jours").find(filter).toArray(),
    loadVenteTotals(venteMatch),
  ]);

  return {
    zogbo: new Map(zogboDocs.map((d) => [d._id, toZogbo(d)])),
    gbegamey: new Map(gbegameyDocs.map((d) => [d._id, toGbegamey(d)])),
    combos: new Map(combosDocs.map((d) => [d._id, toCombos(d)])),
    boissons: new Map(boissonsDocs.map((d) => [d._id, toBoissons(d)])),
    charges: await withPertes(
      new Map(chargesDocs.map((d) => [d._id, toCharges(d, d._id)])),
      start,
      end,
      scopeSite,
    ),
    ventes,
  };
}

function pointsFromDates(
  dates: string[],
  parametres: Awaited<ReturnType<typeof getParametres>>,
  maps: Maps,
): DayPoint[] {
  return dates.map((date) => {
    const revenue = computeDayRevenue({
      baseDishes: parametres.baseDishes,
      localDishes: parametres.localDishes,
      combosCatalog: parametres.combos,
      drinksCatalog: parametres.drinks,
      zogbo: maps.zogbo.get(date) ?? null,
      gbegamey: maps.gbegamey.get(date) ?? null,
      combos: maps.combos.get(date) ?? null,
      boissons: maps.boissons.get(date) ?? null,
      ventes: maps.ventes.get(date) ?? emptyVenteTotals(),
    });
    const charges = maps.charges.get(date) ?? emptyCharges(date);
    return buildDayPoint(date, revenue, charges);
  });
}

export async function getDayPoint(
  date: string,
  scopeSite?: VenteSite | null,
): Promise<DayPoint> {
  const parametres = await getParametres();
  const maps = await loadMaps([date], scopeSite);
  return pointsFromDates([date], parametres, maps)[0]!;
}

export async function getMonthPoint(
  year: number,
  month: number,
  scopeSite?: VenteSite | null,
): Promise<MonthPoint> {
  const dates = daysInMonth(year, month);
  const parametres = await getParametres();
  const maps = await loadMaps(dates, scopeSite);
  const days = pointsFromDates(dates, parametres, maps);
  return { year, month, days, totals: sumMonth(days) };
}

export async function getYearPoint(
  year: number,
  scopeSite?: VenteSite | null,
): Promise<YearPoint> {
  const parametres = await getParametres();
  const maps = await loadRange(
    `${year}-01-01`,
    `${year}-12-31`,
    scopeSite,
  );
  const months: MonthPoint[] = [];

  for (let month = 1; month <= 12; month++) {
    const dates = daysInMonth(year, month);
    const days = pointsFromDates(dates, parametres, maps);
    months.push({ year, month, days, totals: sumMonth(days) });
  }

  return buildYearPoint(year, months);
}

export async function saveDayCharges(
  input: Omit<DayCharges, "updatedAt">,
): Promise<DayCharges> {
  const updatedAt = new Date().toISOString();
  const payload: DayCharges = {
    date: input.date,
    matieresPremieres: Math.max(0, Number(input.matieresPremieres) || 0),
    loyer: Math.max(0, Number(input.loyer) || 0),
    salaires: Math.max(0, Number(input.salaires) || 0),
    electricite: Math.max(0, Number(input.electricite) || 0),
    carburant: Math.max(0, Number(input.carburant) || 0),
    reparations: Math.max(0, Number(input.reparations) || 0),
    updatedAt,
  };

  const db = await getDb();
  await db.collection<ChargesDoc>("charges_jours").updateOne(
    { _id: payload.date },
    {
      $set: {
        matieresPremieres: payload.matieresPremieres,
        loyer: payload.loyer,
        salaires: payload.salaires,
        electricite: payload.electricite,
        carburant: payload.carburant,
        reparations: payload.reparations,
        updatedAt,
      },
    },
    { upsert: true },
  );

  return payload;
}

export function resolvePeriod(
  params: {
    view: string | null;
    date: string | null;
    month: string | null;
    year: string | null;
  },
  today: string,
): {
  view: "day" | "month" | "year";
  date?: string;
  month?: string;
  year?: number;
} {
  const view = (params.view || "day") as "day" | "month" | "year";
  if (view === "day") {
    return { view, date: params.date || today };
  }
  if (view === "month") {
    const month = params.month || today.slice(0, 7);
    parseYearMonth(month);
    return { view, month };
  }
  const year = Number(params.year || today.slice(0, 4));
  if (!Number.isFinite(year) || year < 2000 || year > 2100) {
    throw new Error("Année invalide");
  }
  return { view, year };
}
