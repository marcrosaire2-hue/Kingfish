import { getDb } from "@/lib/mongodb";
import { sumAmortissementsByDate } from "@/lib/immobilisations-repo";
import { getParametres } from "@/lib/parametres-repo";
import { sumPertesCost } from "@/lib/pertes-repo";
import type {
  BoissonsDay,
  DayCharges,
  DayPoint,
  GbegameyDay,
  MatieresLine,
  MatieresMovement,
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
 * Postes de charges saisis à la main (loyer, salaires…), jour par jour, sans
 * les compléments calculés (achats, immobilisations, pertes) qui viennent
 * d'ailleurs — pour le journal comptable, qui les traite séparément à partir
 * de leur propre registre.
 */
export async function listChargesManuellesByDateRange(
  start: string,
  end: string,
): Promise<DayCharges[]> {
  const db = await getDb();
  const docs = await db
    .collection<ChargesDoc>("charges_jours")
    .find({ _id: { $gte: start, $lte: end } })
    .toArray();
  return docs.map((doc) => toCharges(doc, doc._id));
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

/**
 * Achats du registre : conservés pour l’affichage (stock), hors résultat.
 * Vue zone : non injectés (maison entière).
 */
async function withAchatsStock(
  charges: Map<string, DayCharges>,
  start: string,
  end: string,
  scopeSite?: VenteSite | null,
): Promise<Map<string, DayCharges>> {
  if (scopeSite) return charges;
  const db = await getDb();
  const docs = await db
    .collection<{ _id: string; movements?: MatieresMovement[] }>("matieres_jours")
    .find({ _id: { $gte: start, $lte: end } })
    .toArray();
  for (const doc of docs) {
    const total = (doc.movements ?? [])
      .filter((m) => !m.cancelledAt)
      .reduce(
        (s, m) => s + (Number(m.qty) || 0) * (Number(m.unitPrice) || 0),
        0,
      );
    if (total <= 0) continue;
    const existante = charges.get(doc._id) ?? emptyCharges(doc._id);
    charges.set(doc._id, { ...existante, achatsStock: total });
  }
  return charges;
}

async function withMatieresConsommees(
  charges: Map<string, DayCharges>,
  start: string,
  end: string,
  scopeSite?: VenteSite | null,
): Promise<Map<string, DayCharges>> {
  if (scopeSite) return charges;
  const parametres = await getParametres();
  const priceById = new Map(
    (parametres.rawMaterials ?? []).map((m) => [m.id, m.purchasePrice]),
  );
  const db = await getDb();
  const docs = await db
    .collection<{ _id: string; lines?: MatieresLine[] }>("matieres_jours")
    .find({ _id: { $gte: start, $lte: end } })
    .toArray();
  for (const doc of docs) {
    const total = (doc.lines ?? []).reduce((s, line) => {
      const price = priceById.get(line.productId) ?? 0;
      return s + Math.max(0, Number(line.consumed) || 0) * price;
    }, 0);
    if (total <= 0) continue;
    const existante = charges.get(doc._id) ?? emptyCharges(doc._id);
    charges.set(doc._id, {
      ...existante,
      matieresConsommees: Math.round(total),
    });
  }
  return charges;
}

async function withAmortissements(
  charges: Map<string, DayCharges>,
  start: string,
  end: string,
  scopeSite?: VenteSite | null,
): Promise<Map<string, DayCharges>> {
  const { parJour } = await sumAmortissementsByDate({
    from: start,
    to: end,
    site: scopeSite ?? "all",
  });
  for (const [date, cout] of Object.entries(parJour) as [string, number][]) {
    const existante = charges.get(date) ?? emptyCharges(date);
    charges.set(date, { ...existante, amortissements: cout });
  }
  return charges;
}

type Maps = {
  zogbo: Map<string, ZogboDay>;
  gbegamey: Map<string, GbegameyDay>;
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
    cancelledAt: null,
    caExcluded: { $ne: true },
    kind: extra.kind ?? { $ne: "combo" },
    ...Object.fromEntries(
      Object.entries(extra).filter(([key]) => key !== "kind"),
    ),
    ...(extra.kind !== undefined ? { kind: extra.kind } : {}),
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

    if ((kind as string) === "combo") continue;
    if (kind === "plat") {
      if (zogbo) totals.platsZogbo += row.amount;
      else totals.platsGbegamey += row.amount;
    } else if (kind === "local") {
      if (zogbo) totals.localZogbo += row.amount;
      else totals.localGbegamey += row.amount;
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

async function loadPosReductions(
  match: Record<string, unknown>,
): Promise<Map<string, { zogbo: number; gbegamey: number }>> {
  const db = await getDb();
  const rows = await db
    .collection("pos_tickets")
    .aggregate<{ _id: { date: string; site: VenteSite }; total: number }>([
      {
        $match: {
          ...match,
          statut: "valide",
          reduction: { $gt: 0 },
        },
      },
      {
        $group: {
          _id: { date: "$date", site: "$site" },
          total: { $sum: "$reduction" },
        },
      },
    ])
    .toArray();

  const out = new Map<string, { zogbo: number; gbegamey: number }>();
  for (const row of rows) {
    const date = row._id.date;
    const bucket = out.get(date) ?? { zogbo: 0, gbegamey: 0 };
    if (row._id.site === "zogbo") bucket.zogbo += row.total;
    else bucket.gbegamey += row.total;
    out.set(date, bucket);
  }
  return out;
}

function applyPosReductions(
  ventes: Map<string, VenteTotals>,
  reductions: Map<string, { zogbo: number; gbegamey: number }>,
): void {
  for (const [date, red] of reductions) {
    const totals = ventes.get(date) ?? emptyVenteTotals();
    totals.reductionsZogbo = red.zogbo;
    totals.reductionsGbegamey = red.gbegamey;
    ventes.set(date, totals);
  }
}

type ProductAgg = {
  _id: { productId: string; kind: string };
  name: string;
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

  const [productRows, siteRows, redRows, grossRows] = await Promise.all([
    db
      .collection("ventes_log")
      .aggregate<ProductAgg>([
        { $match: caActifMatch({ ...match, qty: { $gt: 0 } }) },
        {
          $group: {
            // Groupé par identité produit, pas par libellé : un même produit
            // enregistré sous deux orthographes (imports, renommage) sortait
            // deux fois du classement et doublait les clés React.
            _id: {
              productId: "$productId",
              kind: "$kind",
            },
            name: { $first: "$name" },
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
    db
      .collection("pos_tickets")
      .aggregate<{ total: number }>([
        {
          $match: {
            statut: "valide",
            reduction: { $gt: 0 },
            ...(match.date ? { date: match.date } : {}),
            ...(match.site ? { site: match.site } : {}),
          },
        },
        { $group: { _id: null, total: { $sum: "$reduction" } } },
      ])
      .toArray(),
    db
      .collection("ventes_log")
      .aggregate<{ ca: number }>([
        { $match: caActifMatch(match) },
        { $group: { _id: null, ca: { $sum: "$amount" } } },
      ])
      .toArray(),
  ]);

  const gross = Number(grossRows[0]?.ca) || 0;
  const red = Number(redRows[0]?.total) || 0;
  const ratio = gross > 0 ? Math.max(0, gross - red) / gross : 1;

  const all: ProductRank[] = productRows.map((r) => ({
    productId: String(r._id.productId ?? ""),
    name: String(r.name || "Sans nom"),
    kind: String(r._id.kind || "extra"),
    qty: Number(r.qty) || 0,
    ca: Math.round((Number(r.ca) || 0) * ratio),
  }));

  const sites: SiteRank[] = siteRows.map((r) => ({
    site: String(r._id || ""),
    label:
      r._id === "zogbo" ? "Zogbo" : r._id === "gbegamey" ? "Gbégamey" : String(r._id),
    qty: Number(r.qty) || 0,
    ca: Math.round((Number(r.ca) || 0) * ratio),
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
  const ticketMatch: Record<string, unknown> = {
    statut: "valide",
    reduction: { $gt: 0 },
  };
  if (match.date) ticketMatch.date = match.date;
  if (match.site) ticketMatch.site = match.site;
  const [actif, exclus, red] = await Promise.all([
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
    db
      .collection("pos_tickets")
      .aggregate<{ total: number }>([
        { $match: ticketMatch },
        { $group: { _id: null, total: { $sum: "$reduction" } } },
      ])
      .toArray(),
  ]);

  return {
    caActif: Math.max(0, (Number(actif[0]?.ca) || 0) - (Number(red[0]?.total) || 0)),
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
  const [jour, mois, total, redJour, redMois, redTotal] = await Promise.all([
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
    db
      .collection("pos_tickets")
      .aggregate<{ total: number }>([
        {
          $match: {
            date,
            statut: "valide",
            reduction: { $gt: 0 },
            ...siteFilter,
          },
        },
        { $group: { _id: null, total: { $sum: "$reduction" } } },
      ])
      .toArray(),
    db
      .collection("pos_tickets")
      .aggregate<{ total: number }>([
        {
          $match: {
            date: { $gte: `${monthPrefix}-01`, $lte: `${monthPrefix}-31` },
            statut: "valide",
            reduction: { $gt: 0 },
            ...siteFilter,
          },
        },
        { $group: { _id: null, total: { $sum: "$reduction" } } },
      ])
      .toArray(),
    db
      .collection("pos_tickets")
      .aggregate<{ total: number }>([
        {
          $match: {
            statut: "valide",
            reduction: { $gt: 0 },
            ...siteFilter,
          },
        },
        { $group: { _id: null, total: { $sum: "$reduction" } } },
      ])
      .toArray(),
  ]);
  return {
    jour: (Number(jour[0]?.ca) || 0) - (Number(redJour[0]?.total) || 0),
    mois: (Number(mois[0]?.ca) || 0) - (Number(redMois[0]?.total) || 0),
    total: (Number(total[0]?.ca) || 0) - (Number(redTotal[0]?.total) || 0),
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
      boissons: new Map(),
      charges: new Map(),
      ventes: new Map(),
    };
  }

  const db = await getDb();
  const filter = { _id: { $in: dates } };
  const venteMatch: Record<string, unknown> = { date: { $in: dates } };
  if (scopeSite) venteMatch.site = scopeSite;
  const redMatch: Record<string, unknown> = { date: { $in: dates } };
  if (scopeSite) redMatch.site = scopeSite;

  const [
    zogboDocs,
    gbegameyDocs,
    boissonsDocs,
    chargesDocs,
    ventes,
    reductions,
  ] = await Promise.all([
    scopeSite === "gbegamey"
      ? Promise.resolve([])
      : db.collection<ZogboDoc>("zogbo_jours").find(filter).toArray(),
    scopeSite === "zogbo"
      ? Promise.resolve([])
      : db.collection<GbegameyDoc>("gbegamey_jours").find(filter).toArray(),
    db.collection<BoissonsDoc>("boissons_jours").find(filter).toArray(),
    db.collection<ChargesDoc>("charges_jours").find(filter).toArray(),
    loadVenteTotals(venteMatch),
    loadPosReductions(redMatch),
  ]);
  applyPosReductions(ventes, reductions);

  return {
    zogbo: new Map(zogboDocs.map((d) => [d._id, toZogbo(d)])),
    gbegamey: new Map(gbegameyDocs.map((d) => [d._id, toGbegamey(d)])),
    boissons: new Map(boissonsDocs.map((d) => [d._id, toBoissons(d)])),
    charges: await withAmortissements(
      await withMatieresConsommees(
        await withAchatsStock(
          await withPertes(
            new Map(chargesDocs.map((d) => [d._id, toCharges(d, d._id)])),
            dates[0]!,
            dates[dates.length - 1]!,
            scopeSite,
          ),
          dates[0]!,
          dates[dates.length - 1]!,
          scopeSite,
        ),
        dates[0]!,
        dates[dates.length - 1]!,
        scopeSite,
      ),
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
  const redMatch: Record<string, unknown> = {
    date: { $gte: start, $lte: end },
  };
  if (scopeSite) redMatch.site = scopeSite;

  const [
    zogboDocs,
    gbegameyDocs,
    boissonsDocs,
    chargesDocs,
    ventes,
    reductions,
  ] = await Promise.all([
    scopeSite === "gbegamey"
      ? Promise.resolve([])
      : db.collection<ZogboDoc>("zogbo_jours").find(filter).toArray(),
    scopeSite === "zogbo"
      ? Promise.resolve([])
      : db.collection<GbegameyDoc>("gbegamey_jours").find(filter).toArray(),
    db.collection<BoissonsDoc>("boissons_jours").find(filter).toArray(),
    db.collection<ChargesDoc>("charges_jours").find(filter).toArray(),
    loadVenteTotals(venteMatch),
    loadPosReductions(redMatch),
  ]);
  applyPosReductions(ventes, reductions);

  return {
    zogbo: new Map(zogboDocs.map((d) => [d._id, toZogbo(d)])),
    gbegamey: new Map(gbegameyDocs.map((d) => [d._id, toGbegamey(d)])),
    boissons: new Map(boissonsDocs.map((d) => [d._id, toBoissons(d)])),
    charges: await withAmortissements(
      await withMatieresConsommees(
        await withAchatsStock(
          await withPertes(
            new Map(chargesDocs.map((d) => [d._id, toCharges(d, d._id)])),
            start,
            end,
            scopeSite,
          ),
          start,
          end,
          scopeSite,
        ),
        start,
        end,
        scopeSite,
      ),
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
  scopeSite?: VenteSite | null,
): DayPoint[] {
  return dates.map((date) => {
    const revenue = computeDayRevenue({
      baseDishes: parametres.baseDishes,
      localDishes: parametres.localDishes,
      drinksCatalog: parametres.drinks,
      zogbo: maps.zogbo.get(date) ?? null,
      gbegamey: maps.gbegamey.get(date) ?? null,
      boissons: maps.boissons.get(date) ?? null,
      ventes: maps.ventes.get(date) ?? emptyVenteTotals(),
      scopeSite,
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
  return pointsFromDates([date], parametres, maps, scopeSite)[0]!;
}

export async function getMonthPoint(
  year: number,
  month: number,
  scopeSite?: VenteSite | null,
): Promise<MonthPoint> {
  const dates = daysInMonth(year, month);
  const parametres = await getParametres();
  const maps = await loadMaps(dates, scopeSite);
  const days = pointsFromDates(dates, parametres, maps, scopeSite);
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
    const days = pointsFromDates(dates, parametres, maps, scopeSite);
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
