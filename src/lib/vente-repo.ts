import { ObjectId } from "mongodb";
import { effectiveShift, type UserShift } from "@/lib/auth-types";
import { getDb } from "@/lib/mongodb";
import { getParametres } from "@/lib/parametres-repo";
import { physicalBoissonsStock, DEFAULT_UNITS_PER_CASIER } from "@/lib/boissons-calc";
import { getBoissonsDayPayload, saveBoissonsDay } from "@/lib/boissons-repo";
import {
  physicalComboStockGbegamey,
  physicalComboStockZogbo,
} from "@/lib/combos-calc";
import { getCombosDayPayload, saveCombosDay } from "@/lib/combos-repo";
import { newId } from "@/lib/format";
import { computeTransferLine } from "@/lib/gbegamey-calc";
import { getGbegameyDayPayload, saveGbegameyDay } from "@/lib/gbegamey-repo";
import { computeZogboLine, shiftIsoDate } from "@/lib/zogbo-calc";
import { isLegalAccompanimentPrice } from "@/lib/catalog-zogbo";
import { getZogboDayPayload, saveZogboDay } from "@/lib/zogbo-repo";
import type {
  GbegameyLocalLine,
  VenteKind,
  VenteLogEntry,
  VenteProduct,
  VenteSite,
  VentesDaySummary,
} from "@/lib/types";

export type { VenteKind, VenteLogEntry, VenteProduct, VenteSite, VentesDaySummary };

export type VenteActor = {
  id: string;
  name: string;
  username: string;
  /** Équipe du vendeur, figée sur la vente : changer d'équipe plus tard ne
   *  doit pas réattribuer les ventes déjà encaissées. */
  shift?: UserShift;
};

type VenteLogDoc = {
  _id: ObjectId;
  date: string;
  site: VenteSite;
  kind: VenteKind;
  productId: string;
  name: string;
  qty: number;
  /** Prix de vente figé au moment de la vente */
  unitPrice: number;
  /** Prix d’achat figé au moment de la vente (marge boissons) */
  costPrice: number;
  amount: number;
  at: string;
  /** Annulation : la ligne reste au journal, elle sort des totaux */
  cancelledAt: string | null;
  /** Plat de base déduit lors d’une vente combo (pour annulation fiable) */
  baseProductId?: string | null;
  actorId?: string | null;
  actorName?: string | null;
  actorUsername?: string | null;
  /** Équipe créditée de cette vente */
  shift?: UserShift | null;
  cancelledById?: string | null;
  cancelledByName?: string | null;
  cancelledByUsername?: string | null;
  /** Provenance (caisse, carnet-zogbo, aquapro, reprise…) */
  source?: string | null;
};

function mapVenteLogDoc(d: VenteLogDoc): VenteLogEntry {
  return {
    id: d._id.toHexString(),
    date: d.date,
    site: d.site,
    kind: d.kind,
    productId: d.productId,
    name: d.name,
    qty: d.qty,
    unitPrice: d.unitPrice,
    amount: d.amount,
    at: d.at,
    source: d.source ?? null,
  };
}

/** Ventes actives : les annulations restent en base mais ne comptent plus. */
const ACTIVE = { cancelledAt: null, caExcluded: { $ne: true } };

/** Document « jour » quelconque, adressé par date — lignes accédées dynamiquement. */
type DayCounterDoc = { _id: string; rev?: number; updatedAt?: string };

function isValidDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

/**
 * Refuse vente et annulation sur un jour clôturé (reprise) : les écritures
 * post-clôture contrediraient l'inventaire et le contrôle de caisse déjà
 * arrêtés. Les ventes « extra », sans jour de stock, restent possibles.
 */
async function assertDayNotClosed(
  date: string,
  site: VenteSite,
  kind: VenteKind,
): Promise<void> {
  if (kind === "extra") return;
  let status: string | null = null;
  try {
    if (kind === "plat" || kind === "local") {
      const payload =
        site === "zogbo"
          ? await getZogboDayPayload(date)
          : await getGbegameyDayPayload(date);
      status = payload.day.status;
    } else if (kind === "combo") {
      const payload = await getCombosDayPayload(date);
      status = payload.day.status;
    } else if (kind === "boisson") {
      const payload = await getBoissonsDayPayload(date);
      status = payload.day.status;
    }
  } catch {
    return;
  }
  if (status === "cloturee") {
    throw new Error("Journée clôturée : vente ou annulation impossible.");
  }
}

/**
 * Stock encore vendable mais entamé au point d’alerter. On exclut la rupture
 * (0) : elle a déjà son propre traitement visuel, et mélanger les deux
 * empêcherait de distinguer « il faut recommander » de « il est trop tard ».
 */
function isLowStock(
  stockLeft: number | null | undefined,
  threshold: number | undefined,
): boolean {
  if (stockLeft === null || stockLeft === undefined) return false;
  const seuil = Math.max(0, Number(threshold) || 0);
  if (seuil <= 0) return false;
  return stockLeft > 0 && stockLeft <= seuil;
}

/**
 * Stock restant vendable d’un plat de base (Zogbo ou reçu Gbégamey).
 * `left` sert d’avertissement au client ; `maxSold` borne la vente de façon
 * atomique (stock − pertes), quelle que soit la valeur de `left` affichée.
 */
async function getBaseDishStockLeft(
  date: string,
  site: VenteSite,
  productId: string,
): Promise<{ left: number; maxSold: number }> {
  if (site === "zogbo") {
    const { day } = await getZogboDayPayload(date);
    const line = day.lines.find((l) => l.productId === productId);
    if (!line) return { left: 0, maxSold: 0 };
    const computed = computeZogboLine(line, 0);
    return {
      left: computed.prevalentRemaining,
      maxSold: computed.prevalentMaxSold,
    };
  }
  const { day, sentByProductId } = await getGbegameyDayPayload(date);
  const line = day.transferLines.find((l) => l.productId === productId);
  if (!line) return { left: 0, maxSold: 0 };
  const computed = computeTransferLine(
    line,
    sentByProductId[productId] ?? 0,
    0,
  );
  return {
    left: computed.prevalentRemaining,
    maxSold: computed.prevalentMaxSold,
  };
}

/** Un accompagnement est suivi (stock contrôlé) dès qu'il a une activité. */
export function accompanimentTracked(line: GbegameyLocalLine): boolean {
  return (
    line.initialStock > 0 ||
    line.prepared > 0 ||
    line.counted !== null ||
    line.pertes > 0
  );
}

/**
 * Disponibilité d'un accompagnement, identique à Zogbo et à Gbégamey :
 * le stock est une indication pour le caissier, jamais un blocage — les
 * accompagnements restent vendables même à stock nul.
 */
export function accompanimentAvailability(
  line: GbegameyLocalLine | null | undefined,
): { tracked: boolean; stockLeft: number | null; maxSold: number | null } {
  if (!line || !accompanimentTracked(line)) {
    return { tracked: false, stockLeft: null, maxSold: null };
  }
  // Comptage saisi : le stock physique prévaut sur le théorique.
  if (line.counted !== null && line.counted !== undefined) {
    const prevalent = Math.max(0, Number(line.counted) || 0);
    return {
      tracked: true,
      stockLeft: Math.max(0, prevalent - line.sold),
      maxSold: null,
    };
  }
  const stock = Math.max(
    0,
    line.initialStock + line.prepared - Math.max(0, Number(line.pertes) || 0),
  );
  return {
    tracked: true,
    stockLeft: Math.max(0, stock - line.sold),
    maxSold: null,
  };
}

export async function getVenteBoard(
  date: string,
  site: VenteSite,
  options?: { recentLimit?: number },
): Promise<{
  date: string;
  site: VenteSite;
  products: VenteProduct[];
  recent: VenteLogEntry[];
  caToday: number;
  /** Répartition du CA du jour entre les équipes */
  caParEquipe: Record<UserShift, number>;
}> {
  if (!isValidDate(date)) throw new Error("Date invalide");
  if (site !== "zogbo" && site !== "gbegamey") {
    throw new Error("Site invalide");
  }

  const recentLimit = Math.min(
    1000,
    Math.max(1, options?.recentLimit ?? 40),
  );

  const parametres = await getParametres();
  const [zogbo, gbegamey, boissons, recent, caToday] =
    await Promise.all([
      getZogboDayPayload(date),
      getGbegameyDayPayload(date),
      getBoissonsDayPayload(date),
      listRecentVentes(date, site, recentLimit),
      sumCaForSite(date, site),
    ]);

  const caParEquipe = await sumCaByShift(date, site);

  const products: VenteProduct[] = [];

  if (site === "zogbo") {
    // Grille construite depuis les paramètres (comme Gbégamey) : le catalogue
    // statique n'était pas maître de la base produits réelle — les articles
    // en stock (brochette, chawarma, choukouya…) n'apparaissaient pas.
    const soldById = new Map(
      zogbo.day.lines.map((l) => [l.productId, l.sold]),
    );
    for (const dish of parametres.baseDishes) {
      const line = zogbo.day.lines.find((l) => l.productId === dish.id);
      const stockLeft = line ? computeZogboLine(line, 0).prevalentRemaining : 0;
      products.push({
        kind: "plat",
        productId: dish.id,
        name: dish.name,
        unitPrice: dish.unitPrice,
        soldToday: soldById.get(dish.id) ?? 0,
        stockLeft,
        lowStock: isLowStock(stockLeft, dish.alertThreshold),
        hint: `Reste ${stockLeft}`,
      });
    }
    const accById = new Map(
      (zogbo.day.accompanimentLines ?? []).map((l) => [l.productId, l]),
    );
    for (const dish of parametres.localDishes) {
      const line = accById.get(dish.id);
      const { tracked, stockLeft } = accompanimentAvailability(line);
      products.push({
        kind: "local",
        productId: dish.id,
        name: dish.name,
        unitPrice: dish.unitPrice,
        soldToday: line?.sold ?? 0,
        stockLeft,
        lowStock: isLowStock(stockLeft, dish?.alertThreshold),
        hint: tracked
          ? `Accompagnement · reste ${stockLeft ?? 0}`
          : "Accompagnement · stock non inventorié",
      });
    }
  } else {
    for (const dish of parametres.baseDishes) {
      const line = gbegamey.day.transferLines.find(
        (l) => l.productId === dish.id,
      );
      const sent = gbegamey.sentByProductId[dish.id] ?? 0;
      const computed = line
        ? computeTransferLine(line, sent, dish.unitPrice)
        : null;
      const stockLeft = computed?.prevalentRemaining ?? 0;
      products.push({
        kind: "plat",
        productId: dish.id,
        name: dish.name,
        unitPrice: dish.unitPrice,
        soldToday: line?.sold ?? 0,
        stockLeft,
        lowStock: isLowStock(stockLeft, dish.alertThreshold),
        hint: `Reçu ${sent} · reste ${stockLeft}`,
      });
    }
    // Même règle qu'à Zogbo : un accompagnement jamais préparé ni compté
    // n'est pas bloqué à zéro — le stock réel n'est pas encore maîtrisé.
    for (const dish of parametres.localDishes) {
      const line = gbegamey.day.localLines.find((l) => l.productId === dish.id);
      const { tracked, stockLeft } = accompanimentAvailability(line);
      products.push({
        kind: "local",
        productId: dish.id,
        name: dish.name,
        unitPrice: dish.unitPrice,
        soldToday: line?.sold ?? 0,
        stockLeft,
        lowStock: isLowStock(stockLeft, dish?.alertThreshold),
        hint: tracked
          ? `Accompagnement · reste ${stockLeft ?? 0}`
          : "Accompagnement · stock non inventorié",
      });
    }
  }

  const drinkSold = new Map(
    boissons.day.lines.map((l) => [
      l.productId,
      site === "zogbo" ? l.soldZogbo : l.soldGbegamey,
    ]),
  );
  const drinkById = new Map(parametres.drinks.map((d) => [d.id, d]));
  const drinkStock = new Map(
    boissons.day.lines.map((l) => {
      const drink = drinkById.get(l.productId);
      return [
        l.productId,
        physicalBoissonsStock(l, drink?.unitsPerCasier),
      ];
    }),
  );
  for (const drink of parametres.drinks) {
    const stockLeft = drinkStock.get(drink.id) ?? 0;
    const upc = Math.max(1, drink.unitsPerCasier || 12);
    const line = boissons.day.lines.find((l) => l.productId === drink.id);
    // Boisson jamais inventoriée (aucun comptage, stock 0) : vendable sans
    // stock, comme un accompagnement non suivi — sinon elle resterait grisée.
    const untracked =
      line?.counted === null &&
      stockLeft <= 0 &&
      (drink.salePrice ?? 0) > 0;
    products.push({
      kind: "boisson",
      productId: drink.id,
      name: drink.name,
      unitPrice: drink.salePrice ?? 0,
      soldToday: drinkSold.get(drink.id) ?? 0,
      stockLeft: drink.salePrice === null || untracked ? null : stockLeft,
      lowStock:
        drink.salePrice !== null &&
        !untracked &&
        isLowStock(stockLeft, drink.alertThreshold),
      hint:
        drink.salePrice === null
          ? "PV manquant"
          : untracked
            ? "Stock non inventorié"
            : `Reste ${stockLeft} bt`,
    });
  }

  return { date, site, products, recent, caToday, caParEquipe };
}

/** CA du jour réparti par équipe — répond à « quelle équipe a vendu ». */
export async function sumCaByShift(
  date: string,
  site: VenteSite | "all",
): Promise<Record<UserShift, number>> {
  const db = await getDb();
  const match: Record<string, unknown> = { date, ...ACTIVE };
  if (site !== "all") match.site = site;

  const rows = await db
    .collection<VenteLogDoc>("ventes_log")
    .aggregate<{ _id: UserShift | null; total: number }>([
      { $match: match },
      { $group: { _id: "$shift", total: { $sum: "$amount" } } },
    ])
    .toArray();

  const parEquipe: Record<UserShift, number> = { jour: 0, nuit: 0, aucune: 0 };
  for (const row of rows) {
    // Les ventes antérieures aux équipes n'en portent aucune : elles vont
    // dans « hors équipe » plutôt que d'être attribuées arbitrairement.
    parEquipe[effectiveShift(row._id)] += row.total;
  }
  return parEquipe;
}

export type ShiftDayRow = {
  date: string;
  jour: number;
  nuit: number;
  aucune: number;
  total: number;
};

export type ShiftRangeSummary = {
  days: ShiftDayRow[];
  totals: Record<UserShift, number> & { total: number };
};

/** CA réparti par équipe sur une période — une ligne par jour ouvert. */
export async function sumCaByShiftRange(
  from: string,
  to: string,
  site: VenteSite | "all",
): Promise<ShiftRangeSummary> {
  const db = await getDb();
  const match: Record<string, unknown> = {
    date: { $gte: from, $lte: to },
    ...ACTIVE,
  };
  if (site !== "all") match.site = site;

  const rows = await db
    .collection<VenteLogDoc>("ventes_log")
    .aggregate<{
      _id: { date: string; shift: UserShift | null };
      total: number;
    }>([
      { $match: match },
      {
        $group: {
          _id: { date: "$date", shift: "$shift" },
          total: { $sum: "$amount" },
        },
      },
      { $sort: { "_id.date": 1 } },
    ])
    .toArray();

  const byDate = new Map<string, Record<UserShift, number>>();
  for (const row of rows) {
    const date = row._id.date;
    const shift = effectiveShift(row._id.shift);
    const bucket = byDate.get(date) ?? { jour: 0, nuit: 0, aucune: 0 };
    bucket[shift] += row.total;
    byDate.set(date, bucket);
  }

  const days: ShiftDayRow[] = [];
  const totals: Record<UserShift, number> = { jour: 0, nuit: 0, aucune: 0 };
  let cursor: string | null = from;
  while (cursor && cursor <= to) {
    const par = byDate.get(cursor) ?? { jour: 0, nuit: 0, aucune: 0 };
    const total = par.jour + par.nuit + par.aucune;
    days.push({ date: cursor, ...par, total });
    totals.jour += par.jour;
    totals.nuit += par.nuit;
    totals.aucune += par.aucune;
    cursor = shiftIsoDate(cursor, 1);
  }

  return {
    days,
    totals: {
      ...totals,
      total: totals.jour + totals.nuit + totals.aucune,
    },
  };
}

/** CA actif du jour pour un site — même source que l’écran Vente. */
export async function sumCaForSite(
  date: string,
  site: VenteSite,
): Promise<number> {
  const db = await getDb();
  const rows = await db
    .collection<VenteLogDoc>("ventes_log")
    .aggregate<{ total: number }>([
      { $match: { date, site, ...ACTIVE } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ])
    .toArray();
  return rows[0]?.total ?? 0;
}

/** CA journal figé pour un type de produit (combos, boissons…). */
export async function sumCaByKindForSite(
  date: string,
  site: VenteSite,
  kind: VenteKind,
): Promise<number> {
  const db = await getDb();
  const rows = await db
    .collection<VenteLogDoc>("ventes_log")
    .aggregate<{ total: number }>([
      { $match: { date, site, kind, ...ACTIVE } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ])
    .toArray();
  return rows[0]?.total ?? 0;
}

/** Dernière journée avec au moins une vente active sur le site. */
export async function getLastSaleDate(
  site: VenteSite,
): Promise<string | null> {
  const db = await getDb();
  const doc = await db.collection<VenteLogDoc>("ventes_log").findOne(
    { site, ...ACTIVE },
    { sort: { date: -1, at: -1 }, projection: { date: 1 } },
  );
  return doc?.date ?? null;
}

async function listRecentVentes(
  date: string,
  site: VenteSite,
  limit: number,
): Promise<VenteLogEntry[]> {
  const db = await getDb();
  const docs = await db
    .collection<VenteLogDoc>("ventes_log")
    .find({ date, site, ...ACTIVE })
    .sort({ at: -1 })
    .limit(limit)
    .toArray();

  return docs.map(mapVenteLogDoc);
}

/** Sorties (ventes) du jour pour un type de produit — registre combos / boissons */
export async function listVentesByKind(input: {
  date: string;
  kind: VenteKind;
  site?: VenteSite | "all";
  limit?: number;
}): Promise<VenteLogEntry[]> {
  if (!isValidDate(input.date)) throw new Error("Date invalide");
  const db = await getDb();
  const filter: Record<string, unknown> = {
    date: input.date,
    kind: input.kind,
    ...ACTIVE,
  };
  if (input.site && input.site !== "all") filter.site = input.site;

  const docs = await db
    .collection<VenteLogDoc>("ventes_log")
    .find(filter)
    .sort({ at: -1 })
    .limit(input.limit ?? 80)
    .toArray();

  return docs.map(mapVenteLogDoc);
}

/** Toutes les ventes actives du jour pour un site — journal complet. */
export async function listVentesForSite(input: {
  date: string;
  site: VenteSite;
  limit?: number;
}): Promise<VenteLogEntry[]> {
  if (!isValidDate(input.date)) throw new Error("Date invalide");
  const db = await getDb();
  const docs = await db
    .collection<VenteLogDoc>("ventes_log")
    .find({ date: input.date, site: input.site, ...ACTIVE })
    .sort({ at: 1 })
    .limit(input.limit ?? 500)
    .toArray();
  return docs.map(mapVenteLogDoc);
}

/** Synthèse du journal de ventes pour un site et une date. */
export async function summarizeVentesForSite(
  date: string,
  site: VenteSite,
): Promise<VentesDaySummary> {
  if (!isValidDate(date)) throw new Error("Date invalide");
  const db = await getDb();
  const docs = await db
    .collection<VenteLogDoc>("ventes_log")
    .find({ date, site, ...ACTIVE })
    .toArray();

  const byKind: VentesDaySummary["byKind"] = {};
  const bySource: VentesDaySummary["bySource"] = {};
  let articles = 0;
  let montant = 0;

  for (const d of docs) {
    articles += d.qty;
    montant += d.amount;
    const kind = d.kind;
    const kindBucket = byKind[kind] ?? { lignes: 0, qty: 0, montant: 0 };
    kindBucket.lignes += 1;
    kindBucket.qty += d.qty;
    kindBucket.montant += d.amount;
    byKind[kind] = kindBucket;

    const src = d.source ?? "caisse";
    const srcBucket = bySource[src] ?? { lignes: 0, montant: 0 };
    srcBucket.lignes += 1;
    srcBucket.montant += d.amount;
    bySource[src] = srcBucket;
  }

  return {
    lignes: docs.length,
    articles,
    montant,
    byKind,
    bySource,
  };
}

type SoldTarget = {
  collection: string;
  arrayField: "lines" | "transferLines" | "localLines" | "accompanimentLines";
  soldField: "sold" | "soldZogbo" | "soldGbegamey";
  name: string;
  unitPrice: number;
  /** Prix d’achat figé au moment de la vente (boissons) */
  costPrice: number;
  ensure: () => Promise<void>;
};

/**
 * Résout la cible d’un mouvement de vente **et vérifie le prix avant toute
 * écriture** : si le prix manque, rien ne doit être décrémenté.
 */
async function resolveSoldTarget(input: {
  date: string;
  site: VenteSite;
  kind: VenteKind;
  productId: string;
}): Promise<SoldTarget> {
  const { date, site, kind, productId } = input;
  const parametres = await getParametres();

  if (kind === "plat") {
    const dish = parametres.baseDishes.find((d) => d.id === productId);
    if (!dish) throw new Error("Plat introuvable");
    return site === "zogbo"
      ? {
          collection: "zogbo_jours",
          arrayField: "lines",
          soldField: "sold",
          name: dish.name,
          unitPrice: dish.unitPrice,
          costPrice: 0,
          ensure: () => ensureZogboDay(date),
        }
      : {
          collection: "gbegamey_jours",
          arrayField: "transferLines",
          soldField: "sold",
          name: dish.name,
          unitPrice: dish.unitPrice,
          costPrice: 0,
          ensure: () => ensureGbegameyDay(date),
        };
  }

  if (kind === "local") {
    const dish = parametres.localDishes.find((d) => d.id === productId);
    if (!dish) throw new Error("Accompagnement introuvable");
    if (site === "zogbo") {
      return {
        collection: "zogbo_jours",
        arrayField: "accompanimentLines",
        soldField: "sold",
        name: dish.name,
        unitPrice: dish.unitPrice,
        costPrice: 0,
        ensure: () => ensureZogboAccompanimentDay(date),
      };
    }
    return {
      collection: "gbegamey_jours",
      arrayField: "localLines",
      soldField: "sold",
      name: dish.name,
      unitPrice: dish.unitPrice,
      costPrice: 0,
      ensure: () => ensureGbegameyDay(date),
    };
  }

  if (kind === "combo") {
    const combo = parametres.combos.find((c) => c.id === productId);
    if (!combo) throw new Error("Combo introuvable");
    return {
      collection: "combos_jours",
      arrayField: "lines",
      soldField: site === "zogbo" ? "soldZogbo" : "soldGbegamey",
      name: combo.name,
      unitPrice: combo.unitPrice,
      costPrice: 0,
      ensure: () => ensureCombosDay(date),
    };
  }

  const drink = parametres.drinks.find((d) => d.id === productId);
  if (!drink) throw new Error("Boisson introuvable");
  if (drink.salePrice === null || drink.salePrice === undefined) {
    throw new Error(`Prix de vente manquant pour « ${drink.name} » (Paramètres)`);
  }
  return {
    collection: "boissons_jours",
    arrayField: "lines",
    soldField: site === "zogbo" ? "soldZogbo" : "soldGbegamey",
    name: drink.name,
    unitPrice: drink.salePrice,
    costPrice: drink.purchasePrice,
    ensure: () => ensureBoissonsDay(date),
  };
}

/**
 * Crée le document du jour s’il manque, ou si le produit n’y figure pas
 * encore (catalogue modifié en cours de journée).
 */
async function ensureLinePresent(target: SoldTarget, input: {
  date: string;
  productId: string;
}): Promise<void> {
  const db = await getDb();
  const doc = await db
    .collection<DayCounterDoc>(target.collection)
    .findOne(
      { _id: input.date },
      { projection: { [target.arrayField]: 1 } },
    );
  const lines = ((doc as Record<string, unknown> | null)?.[
    target.arrayField
  ] ?? []) as { productId: string }[];
  if (doc && lines.some((l) => l.productId === input.productId)) return;
  await target.ensure();
}

async function ensureZogboDay(date: string): Promise<void> {
  const { day } = await getZogboDayPayload(date);
  await saveZogboDay({ date, status: day.status, lines: day.lines });
}

async function ensureZogboAccompanimentDay(date: string): Promise<void> {
  const parametres = await getParametres();
  const { day } = await getZogboDayPayload(date);
  const db = await getDb();
  const lines =
    day.accompanimentLines ??
    parametres.localDishes.map((d) => ({
      productId: d.id,
      name: d.name,
      initialStock: 0,
      prepared: 0,
      sold: 0,
      pertes: 0,
      counted: null,
      observations: "",
    }));
  await db.collection("zogbo_jours").updateOne(
    { _id: date as never },
    {
      $set: {
        accompanimentLines: lines,
        updatedAt: new Date().toISOString(),
      },
      $setOnInsert: {
        status: "ouverte",
        lines: [],
        movements: [],
      },
    },
    { upsert: true },
  );
}

async function ensureGbegameyDay(date: string): Promise<void> {
  const { day } = await getGbegameyDayPayload(date);
  await saveGbegameyDay({
    date,
    status: day.status,
    transferLines: day.transferLines,
    localLines: day.localLines,
  });
}

async function ensureCombosDay(date: string): Promise<void> {
  const { day } = await getCombosDayPayload(date);
  await saveCombosDay({ date, status: day.status, lines: day.lines });
}

async function ensureBoissonsDay(date: string): Promise<void> {
  const { day } = await getBoissonsDayPayload(date);
  await saveBoissonsDay({ date, status: day.status, lines: day.lines });
}

/**
 * Incrément atomique du compteur vendu : une seule écriture MongoDB, sans
 * relire-modifier-réécrire. Deux ventes simultanées ne peuvent plus
 * s’écraser l’une l’autre. `maxSold`, s’il est fourni, borne la vente dans
 * la même écriture (stock − pertes) : le contrôle et l’incrément sont
 * inséparables — pas de course possible sur la dernière portion.
 */
async function applySoldDelta(input: {
  date: string;
  site: VenteSite;
  kind: VenteKind;
  productId: string;
  delta: number;
  /** Plafond absolu du vendu (stock − pertes) ; null = non borné. */
  maxSold?: number | null;
}): Promise<{
  name: string;
  unitPrice: number;
  costPrice: number;
  soldToday: number;
}> {
  const target = await resolveSoldTarget(input);
  await ensureLinePresent(target, input);

  const { arrayField, soldField } = target;
  const upper =
    input.maxSold === null || input.maxSold === undefined
      ? null
      : Math.max(0, input.maxSold) - input.delta;
  const db = await getDb();
  const updated = await db
    .collection<DayCounterDoc>(target.collection)
    .findOneAndUpdate(
    {
      _id: input.date,
      [arrayField]: {
        $elemMatch: {
          productId: input.productId,
          [soldField]: {
            $gte: -input.delta,
            ...(upper !== null ? { $lte: upper } : {}),
          },
        },
      },
    },
    {
      $inc: {
        [`${arrayField}.$[el].${soldField}`]: input.delta,
        rev: 1,
      },
      $set: { updatedAt: new Date().toISOString() },
    },
    {
      arrayFilters: [{ "el.productId": input.productId }],
      returnDocument: "after",
      projection: { [arrayField]: 1 },
    },
  );

  if (!updated) {
    throw new Error(
      `Impossible d’enregistrer « ${target.name} » : stock insuffisant ou annulation invalide.`,
    );
  }

  const lines = ((updated as Record<string, unknown>)[arrayField] ??
    []) as Record<string, unknown>[];
  const line = lines.find((l) => l.productId === input.productId);
  const soldToday = Math.max(0, Number(line?.[soldField]) || 0);

  return {
    name: target.name,
    unitPrice: target.unitPrice,
    costPrice: target.costPrice,
    soldToday,
  };
}

export async function recordVente(input: {
  date: string;
  site: VenteSite;
  kind: VenteKind;
  productId: string;
  qty?: number;
  /** Prix unitaire figé (ex. accompagnement à 500 ou 1 000 selon le plat). */
  unitPrice?: number;
  actor?: VenteActor | null;
}): Promise<{
  entry: VenteLogEntry;
  soldToday: number;
  board: Awaited<ReturnType<typeof getVenteBoard>>;
}> {
  const qty = input.qty ?? 1;
  // Une quantité négative est une correction de saisie (bouton « − » du mode
  // rapide) : elle reprend le stock via applySoldDelta, dont le filtre
  // interdit de faire descendre le vendu sous zéro.
  if (!Number.isFinite(qty) || qty === 0) {
    throw new Error("Quantité invalide");
  }
  if (!isValidDate(input.date)) throw new Error("Date invalide");

  await assertDayNotClosed(input.date, input.site, input.kind);

  // Contrôle stock + plafond atomique. « maxSold » est le vendu maximal
  // (stock − pertes) : transmis à applySoldDelta, il borne l'écriture.
  let maxSold: number | null = null;
  if (qty > 0) {
    if (input.kind === "plat") {
      const { left, maxSold: max } = await getBaseDishStockLeft(
        input.date,
        input.site,
        input.productId,
      );
      maxSold = max;
      if (left < qty) {
        throw new Error(`Stock insuffisant (reste ${left})`);
      }
    } else if (input.kind === "local") {
      // Accompagnements toujours vendables, même à stock nul : le stock est
      // une indication, jamais un blocage.
      maxSold = null;
    } else if (input.kind === "combo") {
      const { day } = await getCombosDayPayload(input.date);
      const line = day.lines.find((l) => l.productId === input.productId);
      const left = line
        ? input.site === "zogbo"
          ? physicalComboStockZogbo(line)
          : physicalComboStockGbegamey(line)
        : 0;
      maxSold = line
        ? input.site === "zogbo"
          ? Math.max(0, line.stockZogbo - line.pertesZogbo)
          : Math.max(
              0,
              line.initialGbegamey +
                line.sentToGbegamey -
                line.pertesGbegamey,
            )
        : 0;
      if (left < qty) {
        throw new Error(`Stock insuffisant (reste ${left})`);
      }
    } else if (input.kind === "boisson") {
      const { day, drinks } = await getBoissonsDayPayload(input.date);
      const line = day.lines.find((l) => l.productId === input.productId);
      const drink = drinks.find((d) => d.id === input.productId);
      const upc = drink?.unitsPerCasier;
      // Boisson jamais inventoriée (pas de comptage) : vente libre, comme un
      // accompagnement non suivi — sinon elle resterait « épuisée » à tort.
      const untracked = !line || line.counted === null;
      if (untracked) {
        maxSold = null;
      } else {
        const left = physicalBoissonsStock(line, upc);
        const upcResolved = Math.max(
          1,
          Math.round(Number(upc) || DEFAULT_UNITS_PER_CASIER),
        );
        // Comptage saisi en bouteilles : le stock physique prévaut.
        const stockBottles =
          line.counted !== null && line.counted !== undefined
            ? Math.max(0, Number(line.counted) || 0)
            : (line.initialStock + line.purchases) * upcResolved;
        const bottles = stockBottles - Math.max(0, Number(line.pertes) || 0);
        maxSold =
          Math.max(0, bottles) -
          (input.site === "zogbo"
            ? line.soldGbegamey
            : line.soldZogbo);
        if (left < qty) {
          throw new Error(`Stock insuffisant (reste ${left} bt)`);
        }
      }
    }
  }

  // Prix du serveur : le client ne fixe jamais le tarif d'un produit du
  // catalogue. Un plat ou une boisson ne s'accepte qu'au prix du catalogue ;
  // les accompagnements n'acceptent qu'un prix légal (catalogue ou
  // plat + accompagnement). Vérifié AVANT toute écriture de stock.
  const target = await resolveSoldTarget({
    date: input.date,
    site: input.site,
    kind: input.kind,
    productId: input.productId,
  });
  const unitPriceOverride = Math.round(Number(input.unitPrice) || 0);
  let unitPrice = target.unitPrice;
  if (unitPriceOverride > 0) {
    if (input.kind === "local") {
      // Prix légal : celui du catalogue (paramètres) ou les grilles
      // « plat + accompagnement » (500 / 1 000) du catalogue statique.
      const legal =
        unitPriceOverride === target.unitPrice ||
        isLegalAccompanimentPrice(input.productId, unitPriceOverride);
      if (!legal) {
        throw new Error(
          `Prix non autorisé pour cet accompagnement : ${unitPriceOverride} F.`,
        );
      }
      unitPrice = unitPriceOverride;
    } else if (input.kind !== "extra" && unitPriceOverride !== target.unitPrice) {
      throw new Error(
        `Prix non autorisé pour « ${target.name} » : ${unitPriceOverride} F.`,
      );
    }
  }

  const result = await applySoldDelta({
    date: input.date,
    site: input.site,
    kind: input.kind,
    productId: input.productId,
    delta: qty,
    maxSold,
  });

  const at = new Date().toISOString();
  const amount = Math.abs(qty) * unitPrice;
  const db = await getDb();
  const insert = await db.collection<VenteLogDoc>("ventes_log").insertOne({
    _id: new ObjectId(),
    date: input.date,
    site: input.site,
    kind: input.kind,
    productId: input.productId,
    name: result.name,
    qty,
    unitPrice,
    costPrice: result.costPrice,
    amount: qty > 0 ? amount : -amount,
    at,
    cancelledAt: null,
    baseProductId: null,
    actorId: input.actor?.id ?? null,
    actorName: input.actor?.name ?? null,
    actorUsername: input.actor?.username ?? null,
    shift: effectiveShift(input.actor?.shift),
  });

  const entry: VenteLogEntry = {
    id: insert.insertedId.toHexString(),
    date: input.date,
    site: input.site,
    kind: input.kind,
    productId: input.productId,
    name: result.name,
    qty,
    unitPrice,
    amount: qty > 0 ? amount : -amount,
    at,
  };

  const board = await getVenteBoard(input.date, input.site);
  return { entry, soldToday: result.soldToday, board };
}

/** Vente libre : description + prix, comptée dans le CA du point (sans stock). */
export async function recordExtraVente(input: {
  date: string;
  site: VenteSite;
  description: string;
  unitPrice: number;
  /** Unités facturées — une ligne de panier POS peut en porter plusieurs. */
  qty?: number;
  actor?: VenteActor | null;
}): Promise<{
  entry: VenteLogEntry;
  board: Awaited<ReturnType<typeof getVenteBoard>>;
}> {
  if (!isValidDate(input.date)) throw new Error("Date invalide");
  const description = input.description.trim().replace(/\s+/g, " ");
  if (description.length < 2) {
    throw new Error("Décrivez la vente (au moins 2 caractères).");
  }
  if (description.length > 200) {
    throw new Error("Description trop longue (200 caractères max).");
  }
  const unitPrice = Math.round(Number(input.unitPrice) || 0);
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
    throw new Error("Prix invalide (montant en FCFA requis).");
  }
  const qty = Math.round(Number(input.qty ?? 1));
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new Error("Quantité invalide");
  }

  const at = new Date().toISOString();
  const productId = newId("extra");
  const db = await getDb();
  const insert = await db.collection<VenteLogDoc>("ventes_log").insertOne({
    _id: new ObjectId(),
    date: input.date,
    site: input.site,
    kind: "extra",
    productId,
    name: description,
    qty,
    unitPrice,
    costPrice: 0,
    amount: qty * unitPrice,
    at,
    cancelledAt: null,
    baseProductId: null,
    actorId: input.actor?.id ?? null,
    actorName: input.actor?.name ?? null,
    actorUsername: input.actor?.username ?? null,
    shift: effectiveShift(input.actor?.shift),
  });

  const entry: VenteLogEntry = {
    id: insert.insertedId.toHexString(),
    date: input.date,
    site: input.site,
    kind: "extra",
    productId,
    name: description,
    qty,
    unitPrice,
    amount: qty * unitPrice,
    at,
  };

  const board = await getVenteBoard(input.date, input.site);
  return { entry, board };
}

/**
 * Une équipe ne peut pas annuler une vente encaissée par l'autre équipe :
 * l'équipe de nuit ne touche pas aux ventes de l'équipe de jour, et
 * réciproquement. Hors équipe (encadrement) et ventes sans équipe restent
 * annulables par tous.
 */
export function assertSameTeamCancellation(input: {
  saleShift: UserShift | string | null | undefined;
  cancellerShift: UserShift | string | null | undefined;
}): void {
  const sale = effectiveShift(input.saleShift);
  const canceller = effectiveShift(input.cancellerShift);
  if (sale === "aucune" || canceller === "aucune") return;
  if (sale === canceller) return;
  const teamLabel = (s: UserShift) =>
    s === "jour" ? "Équipe de jour" : "Équipe de nuit";
  throw new Error(
    `Annulation refusée : une vente de l’${teamLabel(sale)} ne peut pas être annulée par l’${teamLabel(canceller)}.`,
  );
}

export async function undoVente(input: {
  id: string;
  date: string;
  site: VenteSite;
  actor?: VenteActor | null;
}): Promise<{
  board: Awaited<ReturnType<typeof getVenteBoard>>;
  entry: { id: string; name: string; amount: number };
}> {
  const db = await getDb();
  const doc = await db.collection<VenteLogDoc>("ventes_log").findOne({
    _id: new ObjectId(input.id),
    date: input.date,
    site: input.site,
    ...ACTIVE,
  });
  if (!doc) throw new Error("Vente introuvable ou déjà annulée");

  assertSameTeamCancellation({
    saleShift: doc.shift,
    cancellerShift: input.actor?.shift,
  });

  const marked = await db.collection<VenteLogDoc>("ventes_log").updateOne(
    { _id: doc._id, ...ACTIVE },
    {
      $set: {
        cancelledAt: new Date().toISOString(),
        cancelledById: input.actor?.id ?? null,
        cancelledByName: input.actor?.name ?? null,
        cancelledByUsername: input.actor?.username ?? null,
      },
    },
  );
  if (marked.matchedCount === 0) {
    throw new Error("Vente introuvable ou déjà annulée");
  }

  const entry = {
    id: doc._id.toHexString(),
    name: doc.name,
    amount: doc.amount,
  };

  // Vente extra : pas de stock à reprendre
  if (doc.kind === "extra") {
    const board = await getVenteBoard(input.date, input.site);
    return { board, entry };
  }

  await assertDayNotClosed(doc.date, doc.site, doc.kind);

  try {
    // Le ticket est marqué annulé avant la reprise de stock : si une écriture
    // échoue (stock déjà annulé, jour clôturé…), l'annulation est défaite et
    // la vente reste active.
    await applySoldDelta({
      date: doc.date,
      site: doc.site,
      kind: doc.kind,
      productId: doc.productId,
      delta: -doc.qty,
    });
  } catch (error) {
    await db.collection<VenteLogDoc>("ventes_log").updateOne(
      { _id: doc._id },
      {
        $set: {
          cancelledAt: null,
          cancelledById: null,
          cancelledByName: null,
          cancelledByUsername: null,
        },
      },
    );
    throw error;
  }

  const board = await getVenteBoard(input.date, input.site);
  return { board, entry };
}
