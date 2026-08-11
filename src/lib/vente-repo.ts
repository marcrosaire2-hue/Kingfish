import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getParametres } from "@/lib/parametres-repo";
import { physicalBoissonsStock } from "@/lib/boissons-calc";
import { getBoissonsDayPayload, saveBoissonsDay } from "@/lib/boissons-repo";
import {
  physicalComboStockGbegamey,
  physicalComboStockZogbo,
} from "@/lib/combos-calc";
import { getCombosDayPayload, saveCombosDay } from "@/lib/combos-repo";
import { newId } from "@/lib/format";
import { computeTransferLine } from "@/lib/gbegamey-calc";
import { getGbegameyDayPayload, saveGbegameyDay } from "@/lib/gbegamey-repo";
import { physicalStock } from "@/lib/zogbo-calc";
import { getZogboDayPayload, saveZogboDay } from "@/lib/zogbo-repo";
import type {
  BaseDish,
  ComboDish,
  Parametres,
  VenteKind,
  VenteLogEntry,
  VenteProduct,
  VenteSite,
} from "@/lib/types";

export type { VenteKind, VenteLogEntry, VenteProduct, VenteSite };

export type VenteActor = {
  id: string;
  name: string;
  username: string;
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
  cancelledById?: string | null;
  cancelledByName?: string | null;
  cancelledByUsername?: string | null;
};

/** Ventes actives : les annulations restent en base mais ne comptent plus. */
const ACTIVE = { cancelledAt: null, caExcluded: { $ne: true } };

/** Document « jour » quelconque, adressé par date — lignes accédées dynamiquement. */
type DayCounterDoc = { _id: string; rev?: number; updatedAt?: string };

function isValidDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
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

function findComboBaseDish(
  combo: ComboDish,
  parametres: Parametres,
): BaseDish | null {
  if (!combo.baseDishName) return null;
  return (
    parametres.baseDishes.find((d) => d.name === combo.baseDishName) ?? null
  );
}

/** Stock restant vendable d’un plat de base (Zogbo ou reçu Gbégamey). */
async function getBaseDishStockLeft(
  date: string,
  site: VenteSite,
  productId: string,
): Promise<number> {
  if (site === "zogbo") {
    const { day } = await getZogboDayPayload(date);
    const line = day.lines.find((l) => l.productId === productId);
    return line ? physicalStock(line) : 0;
  }
  const { day, sentByProductId } = await getGbegameyDayPayload(date);
  const line = day.transferLines.find((l) => l.productId === productId);
  if (!line) return 0;
  return computeTransferLine(
    line,
    sentByProductId[productId] ?? 0,
    0,
  ).theoreticalRemaining;
}

async function getLocalDishStockLeft(
  date: string,
  productId: string,
): Promise<number> {
  const { day } = await getGbegameyDayPayload(date);
  const line = day.localLines.find((l) => l.productId === productId);
  if (!line) return 0;
  return Math.max(0, line.initialStock + line.prepared - line.sold);
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
  const [zogbo, gbegamey, combos, boissons, recent, caToday] =
    await Promise.all([
      getZogboDayPayload(date),
      getGbegameyDayPayload(date),
      getCombosDayPayload(date),
      getBoissonsDayPayload(date),
      listRecentVentes(date, site, recentLimit),
      sumCaForSite(date, site),
    ]);

  const products: VenteProduct[] = [];

  if (site === "zogbo") {
    const stockById = new Map(
      zogbo.day.lines.map((l) => [l.productId, physicalStock(l)]),
    );
    const soldById = new Map(
      zogbo.day.lines.map((l) => [l.productId, l.sold]),
    );
    for (const dish of parametres.baseDishes) {
      const stockLeft = stockById.get(dish.id) ?? 0;
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
  } else {
    for (const dish of parametres.baseDishes) {
      const line = gbegamey.day.transferLines.find(
        (l) => l.productId === dish.id,
      );
      const sent = gbegamey.sentByProductId[dish.id] ?? 0;
      const computed = line
        ? computeTransferLine(line, sent, dish.unitPrice)
        : null;
      const stockLeft = computed?.theoreticalRemaining ?? 0;
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
    for (const dish of parametres.localDishes) {
      const line = gbegamey.day.localLines.find((l) => l.productId === dish.id);
      const stockLeft = line
        ? Math.max(0, line.initialStock + line.prepared - line.sold)
        : 0;
      products.push({
        kind: "local",
        productId: dish.id,
        name: dish.name,
        unitPrice: dish.unitPrice,
        soldToday: line?.sold ?? 0,
        stockLeft,
        lowStock: isLowStock(stockLeft, dish.alertThreshold),
        hint: `Sur place · reste ${stockLeft}`,
      });
    }
  }

  const comboSold = new Map(
    combos.day.lines.map((l) => [
      l.productId,
      site === "zogbo" ? l.soldZogbo : l.soldGbegamey,
    ]),
  );
  for (const combo of parametres.combos) {
    const line = combos.day.lines.find((l) => l.productId === combo.id);
    const stockLeft = line
      ? site === "zogbo"
        ? physicalComboStockZogbo(line)
        : physicalComboStockGbegamey(line)
      : 0;
    products.push({
      kind: "combo",
      productId: combo.id,
      name: combo.name,
      unitPrice: combo.unitPrice,
      soldToday: comboSold.get(combo.id) ?? 0,
      stockLeft,
      lowStock: isLowStock(stockLeft, combo.alertThreshold),
      hint:
        site === "zogbo"
          ? `Préparé Zogbo · reste ${stockLeft}`
          : `Reçu de Zogbo · reste ${stockLeft}`,
    });
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
    const casiersLeft = Math.round((stockLeft / upc) * 100) / 100;
    products.push({
      kind: "boisson",
      productId: drink.id,
      name: drink.name,
      unitPrice: drink.salePrice ?? 0,
      soldToday: drinkSold.get(drink.id) ?? 0,
      stockLeft: drink.salePrice === null ? null : stockLeft,
      lowStock:
        drink.salePrice !== null &&
        isLowStock(stockLeft, drink.alertThreshold),
      hint:
        drink.salePrice === null
          ? "PV manquant"
          : `Reste ${stockLeft} bt (${casiersLeft} cas.) · ${upc} bt/cas.`,
    });
  }

  return { date, site, products, recent, caToday };
}

async function sumCaForSite(date: string, site: VenteSite): Promise<number> {
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

  return docs.map((d) => ({
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
  }));
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

  return docs.map((d) => ({
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
  }));
}

type SoldTarget = {
  collection: string;
  arrayField: "lines" | "transferLines" | "localLines";
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
    if (site !== "gbegamey") {
      throw new Error("Les plats locaux ne sont vendus qu’à Gbégamey");
    }
    const dish = parametres.localDishes.find((d) => d.id === productId);
    if (!dish) throw new Error("Plat local introuvable");
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
 * s’écraser l’une l’autre.
 */
async function applySoldDelta(input: {
  date: string;
  site: VenteSite;
  kind: VenteKind;
  productId: string;
  delta: number;
}): Promise<{
  name: string;
  unitPrice: number;
  costPrice: number;
  soldToday: number;
}> {
  const target = await resolveSoldTarget(input);
  await ensureLinePresent(target, input);

  const { arrayField, soldField } = target;
  const db = await getDb();
  const updated = await db
    .collection<DayCounterDoc>(target.collection)
    .findOneAndUpdate(
    {
      _id: input.date,
      [arrayField]: {
        $elemMatch: {
          productId: input.productId,
          [soldField]: { $gte: -input.delta },
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
      `Impossible d’enregistrer « ${target.name} » : quantité vendue insuffisante pour annuler.`,
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
  actor?: VenteActor | null;
}): Promise<{
  entry: VenteLogEntry;
  soldToday: number;
  board: Awaited<ReturnType<typeof getVenteBoard>>;
}> {
  const qty = input.qty ?? 1;
  if (!Number.isFinite(qty) || qty === 0) {
    throw new Error("Quantité invalide");
  }
  if (!isValidDate(input.date)) throw new Error("Date invalide");

  // Contrôle stock
  if (qty > 0) {
    if (input.kind === "plat") {
      const left = await getBaseDishStockLeft(
        input.date,
        input.site,
        input.productId,
      );
      if (left < qty) {
        throw new Error(`Stock insuffisant (reste ${left})`);
      }
    } else if (input.kind === "local") {
      const left = await getLocalDishStockLeft(input.date, input.productId);
      if (left < qty) {
        throw new Error(`Stock insuffisant (reste ${left})`);
      }
    } else if (input.kind === "combo") {
      const { day } = await getCombosDayPayload(input.date);
      const line = day.lines.find((l) => l.productId === input.productId);
      const left = line
        ? input.site === "zogbo"
          ? physicalComboStockZogbo(line)
          : physicalComboStockGbegamey(line)
        : 0;
      if (left < qty) {
        throw new Error(`Stock insuffisant (reste ${left})`);
      }
    } else if (input.kind === "boisson") {
      const { day, drinks } = await getBoissonsDayPayload(input.date);
      const line = day.lines.find((l) => l.productId === input.productId);
      const drink = drinks.find((d) => d.id === input.productId);
      const left = line
        ? physicalBoissonsStock(line, drink?.unitsPerCasier)
        : 0;
      if (left < qty) {
        throw new Error(`Stock insuffisant (reste ${left} bt)`);
      }
    }
  }

  const result = await applySoldDelta({
    date: input.date,
    site: input.site,
    kind: input.kind,
    productId: input.productId,
    delta: qty,
  });

  const at = new Date().toISOString();
  const amount = Math.abs(qty) * result.unitPrice;
  const db = await getDb();
  const insert = await db.collection<VenteLogDoc>("ventes_log").insertOne({
    _id: new ObjectId(),
    date: input.date,
    site: input.site,
    kind: input.kind,
    productId: input.productId,
    name: result.name,
    qty,
    unitPrice: result.unitPrice,
    costPrice: result.costPrice,
    amount: qty > 0 ? amount : -amount,
    at,
    cancelledAt: null,
    baseProductId: null,
    actorId: input.actor?.id ?? null,
    actorName: input.actor?.name ?? null,
    actorUsername: input.actor?.username ?? null,
  });

  const entry: VenteLogEntry = {
    id: insert.insertedId.toHexString(),
    date: input.date,
    site: input.site,
    kind: input.kind,
    productId: input.productId,
    name: result.name,
    qty,
    unitPrice: result.unitPrice,
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
    qty: 1,
    unitPrice,
    costPrice: 0,
    amount: unitPrice,
    at,
    cancelledAt: null,
    baseProductId: null,
    actorId: input.actor?.id ?? null,
    actorName: input.actor?.name ?? null,
    actorUsername: input.actor?.username ?? null,
  });

  const entry: VenteLogEntry = {
    id: insert.insertedId.toHexString(),
    date: input.date,
    site: input.site,
    kind: "extra",
    productId,
    name: description,
    qty: 1,
    unitPrice,
    amount: unitPrice,
    at,
  };

  const board = await getVenteBoard(input.date, input.site);
  return { entry, board };
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

  let baseProductId = doc.baseProductId ?? null;
  if (doc.kind === "combo" && !baseProductId) {
    const parametres = await getParametres();
    const combo = parametres.combos.find((c) => c.id === doc.productId);
    if (combo) {
      baseProductId = findComboBaseDish(combo, parametres)?.id ?? null;
    }
  }

  try {
    if (baseProductId) {
      await applySoldDelta({
        date: doc.date,
        site: doc.site,
        kind: "plat",
        productId: baseProductId,
        delta: -doc.qty,
      });
    }
    await applySoldDelta({
      date: doc.date,
      site: doc.site,
      kind: doc.kind,
      productId: doc.productId,
      delta: -doc.qty,
    });
  } catch (error) {
    if (baseProductId) {
      try {
        await applySoldDelta({
          date: doc.date,
          site: doc.site,
          kind: "plat",
          productId: baseProductId,
          delta: doc.qty,
        });
      } catch {
        /* best effort */
      }
    }
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
