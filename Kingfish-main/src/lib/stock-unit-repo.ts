import { ObjectId } from "mongodb";
import { randomBytes } from "crypto";
import { getDb } from "@/lib/mongodb";
import { isValidDate } from "@/lib/day-doc";
import { applyZogboMovement } from "@/lib/zogbo-repo";
import { getZogboDayPayload, saveZogboDay } from "@/lib/zogbo-repo";
import { getGbegameyDayPayload, saveGbegameyDay } from "@/lib/gbegamey-repo";
import { computeLocalLine, computeTransferLine } from "@/lib/gbegamey-calc";
import { getParametres } from "@/lib/parametres-repo";
import { normalizeStickerCode, STICKER_ALPHABET } from "@/lib/parse-qr-id";
import type { GbegameyLocalLine, VenteSite } from "@/lib/types";
import { computeZogboLine } from "@/lib/zogbo-calc";
import {
  canTransitionUnitStatus,
  type PlatUnitStats,
  type StockUnit,
  type StockUnitKind,
  type StockUnitScanResult,
  type StockUnitStatus,
  type StockZogboPayload,
} from "@/lib/stock-unit-types";

type StockUnitDoc = {
  _id: ObjectId;
  qrId: string;
  stickerCode?: string;
  kind?: StockUnitKind;
  productId: string;
  productName: string;
  batchId: string;
  date: string;
  site: "zogbo" | "gbegamey";
  status: StockUnitStatus;
  movementId: string | null;
  preparedAt: string;
  sentAt: string | null;
  soldAt: string | null;
  lostAt: string | null;
  createdAt: string;
  updatedAt: string;
};

let indexesReady: Promise<void> | null = null;

const EMPTY_COUNTS: Record<StockUnitStatus, number> = {
  prepare: 0,
  envoye: 0,
  vendu: 0,
  perdu: 0,
};

export function createStickerCode(): string {
  const bytes = randomBytes(6);
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += STICKER_ALPHABET[bytes[i]! % STICKER_ALPHABET.length];
  }
  return code;
}

export function createQrId(stickerCode = createStickerCode()): string {
  return `KF-${stickerCode}`;
}

function unitKind(doc: Pick<StockUnitDoc, "kind">): StockUnitKind {
  return doc.kind === "local" || doc.kind === "boisson" ? doc.kind : "plat";
}

function toUnit(doc: StockUnitDoc): StockUnit {
  const sticker =
    doc.stickerCode ||
    normalizeStickerCode(doc.qrId) ||
    doc.qrId;
  return {
    id: doc._id.toHexString(),
    qrId: doc.qrId,
    stickerCode: sticker,
    kind: unitKind(doc),
    productId: doc.productId,
    productName: doc.productName,
    batchId: doc.batchId,
    date: doc.date,
    site: doc.site,
    status: doc.status,
    movementId: doc.movementId,
    preparedAt: doc.preparedAt,
    sentAt: doc.sentAt,
    soldAt: doc.soldAt,
    lostAt: doc.lostAt,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export async function ensureStockUnitIndexes(): Promise<void> {
  if (!indexesReady) {
    indexesReady = (async () => {
      const db = await getDb();
      const col = db.collection("stock_units");
      await col.createIndex({ qrId: 1 }, { unique: true, name: "qrId_unique" });
      await col.createIndex(
        { stickerCode: 1 },
        { unique: true, sparse: true, name: "sticker_unique" },
      );
      await col.createIndex(
        { date: 1, productId: 1, status: 1 },
        { name: "jour_produit_statut" },
      );
      await col.createIndex(
        { site: 1, status: 1 },
        { name: "site_statut" },
      );
      await col.createIndex({ batchId: 1 }, { name: "batch" });
    })();
  }
  await indexesReady;
}

type UnitCountMaps = {
  plat: Map<string, Record<StockUnitStatus, number>>;
  local: Map<string, Record<StockUnitStatus, number>>;
  boisson: Map<string, Record<StockUnitStatus, number>>;
};

async function countUnitsByProduct(
  date: string,
  site?: VenteSite,
): Promise<UnitCountMaps> {
  await ensureStockUnitIndexes();
  const db = await getDb();
  const match: Record<string, unknown> = { date };
  if (site) match.site = site;
  const rows = await db
    .collection<StockUnitDoc>("stock_units")
    .aggregate<{
      _id: {
        productId: string;
        status: StockUnitStatus;
        kind: StockUnitKind;
      };
      n: number;
    }>(
      [
        { $match: match },
        {
          $group: {
            _id: {
              productId: "$productId",
              status: "$status",
              kind: { $ifNull: ["$kind", "plat"] },
            },
            n: { $sum: 1 },
          },
        },
      ],
    )
    .toArray();

  const maps: UnitCountMaps = {
    plat: new Map(),
    local: new Map(),
    boisson: new Map(),
  };
  for (const row of rows) {
    const kind: StockUnitKind =
      row._id.kind === "local" || row._id.kind === "boisson"
        ? row._id.kind
        : "plat";
    const pid = row._id.productId;
    const cur = maps[kind].get(pid) ?? { ...EMPTY_COUNTS };
    cur[row._id.status] = row.n;
    maps[kind].set(pid, cur);
  }
  return maps;
}

export async function countQrGeneratedByProduct(
  date: string,
  site: VenteSite,
  kind: StockUnitKind,
): Promise<Record<string, number>> {
  const maps = await countUnitsByProduct(date, site);
  const out: Record<string, number> = {};
  for (const [id, c] of maps[kind]) {
    out[id] = c.prepare + c.envoye + c.vendu;
  }
  return out;
}

/** Articles pour lesquels un QR est encore vendable sur ce site (stock QR > 0). */
export async function listSellableQrProductIds(
  site: VenteSite,
): Promise<Set<string>> {
  await ensureStockUnitIndexes();
  const db = await getDb();
  const filter =
    site === "gbegamey"
      ? {
          site: "gbegamey" as const,
          status: { $in: ["prepare", "envoye"] as StockUnitStatus[] },
        }
      : { site: "zogbo" as const, status: "prepare" as const };
  const ids = await db
    .collection<StockUnitDoc>("stock_units")
    .distinct("productId", filter);
  return new Set(
    ids.map((id) => String(id ?? "").trim()).filter(Boolean),
  );
}

function statsFromCounts(
  productId: string,
  productName: string,
  prepared: number,
  counts: Record<StockUnitStatus, number> | undefined,
  extra: Partial<PlatUnitStats> = {},
): PlatUnitStats {
  const c = counts ?? EMPTY_COUNTS;
  const qrGenerated = c.prepare + c.envoye + c.vendu + c.perdu;
  const qrSent = c.envoye + c.vendu;
  const soldAggregate = extra.soldAggregate ?? c.vendu;
  const pertesAggregate = extra.pertesAggregate ?? 0;
  const stockRemaining =
    extra.stockRemaining ??
    Math.max(0, prepared - soldAggregate - pertesAggregate);
  return {
    productId,
    productName,
    prepared,
    sentAggregate: extra.sentAggregate ?? qrSent,
    soldAggregate,
    pertesAggregate,
    stockAggregate: extra.stockAggregate ?? c.prepare,
    qrGenerated,
    qrSent,
    qrRemainingZogbo: extra.qrRemainingZogbo ?? c.prepare,
    qrVendu: c.vendu,
    qrPerdu: c.perdu,
    qrToGenerate:
      extra.qrToGenerate ?? Math.max(0, prepared - qrGenerated),
    stockRemaining,
  };
}

export async function getStockZogboPayload(
  date: string,
): Promise<StockZogboPayload> {
  return getStockSitePayload(date, "zogbo");
}

export async function getStockSitePayload(
  date: string,
  site: VenteSite = "zogbo",
): Promise<StockZogboPayload> {
  if (!isValidDate(date)) throw new Error("Date invalide (attendu YYYY-MM-DD)");

  const [{ drinks }, unitCounts] = await Promise.all([
    getParametres(),
    countUnitsByProduct(date, site),
  ]);

  if (site === "gbegamey") {
    const gbegamey = await getGbegameyDayPayload(date);
    const plats: PlatUnitStats[] = gbegamey.baseDishes.map((dish) => {
      const line = gbegamey.day.transferLines.find(
        (l) => l.productId === dish.id,
      );
      const counts = unitCounts.plat.get(dish.id);
      const qrGenerated =
        (counts?.prepare ?? 0) +
        (counts?.envoye ?? 0) +
        (counts?.vendu ?? 0) +
        (counts?.perdu ?? 0);
      const remaining = (counts?.prepare ?? 0) + (counts?.envoye ?? 0);
      const sent = gbegamey.sentByProductId[dish.id] ?? 0;
      const stockRemaining = line
        ? computeTransferLine(line, sent, dish.unitPrice).prevalentRemaining
        : 0;
      return statsFromCounts(dish.id, dish.name, qrGenerated, counts, {
        sentAggregate: line?.received ?? (counts?.envoye ?? 0) + (counts?.vendu ?? 0),
        soldAggregate: line?.sold ?? counts?.vendu ?? 0,
        pertesAggregate: line?.pertes ?? 0,
        stockAggregate: remaining,
        qrRemainingZogbo: remaining,
        qrToGenerate: 0,
        stockRemaining,
      });
    });
    const accLines = gbegamey.day.localLines ?? [];
    const accStats = gbegamey.localDishes.map((dish) => {
      const line = accLines.find((l) => l.productId === dish.id);
      const stockRemaining = line
        ? computeLocalLine(line, dish.unitPrice).prevalentRemaining
        : 0;
      return statsFromCounts(
        dish.id,
        dish.name,
        line?.prepared ?? 0,
        unitCounts.local.get(dish.id),
        {
          soldAggregate: line?.sold ?? 0,
          pertesAggregate: line?.pertes ?? 0,
          stockRemaining,
        },
      );
    });
    const drinkStats = drinks.map((d) => {
      const counts = unitCounts.boisson.get(d.id);
      const generated =
        (counts?.prepare ?? 0) +
        (counts?.envoye ?? 0) +
        (counts?.vendu ?? 0) +
        (counts?.perdu ?? 0);
      const qrLeft = (counts?.prepare ?? 0) + (counts?.envoye ?? 0);
      return statsFromCounts(d.id, d.name, generated, counts, {
        qrToGenerate: 0,
        prepared: generated,
        stockRemaining: qrLeft,
      });
    });

    return {
      date,
      plats,
      accStats,
      drinkStats,
      accompanimentLines: accLines,
      localDishes: gbegamey.localDishes,
      baseDishes: gbegamey.baseDishes,
      drinks,
    };
  }

  const [zogbo, platCounts] = await Promise.all([
    getZogboDayPayload(date),
    countUnitsByProduct(date),
  ]);
  const plats: PlatUnitStats[] = zogbo.baseDishes.map((dish) => {
    const line = zogbo.day.lines.find((l) => l.productId === dish.id);
    const prepared = line?.prepared ?? 0;
    const stockRemaining = line
      ? computeZogboLine(line, 0).prevalentRemaining
      : 0;
    return statsFromCounts(
      dish.id,
      dish.name,
      prepared,
      platCounts.plat.get(dish.id),
      {
        sentAggregate: line?.sentToGbegamey ?? 0,
        soldAggregate: line?.sold ?? 0,
        pertesAggregate: line?.pertes ?? 0,
        stockAggregate: line?.stock ?? 0,
        stockRemaining,
      },
    );
  });
  const accLines = zogbo.day.accompanimentLines ?? [];
  const accStats = zogbo.localDishes.map((dish) => {
    const line = accLines.find((l) => l.productId === dish.id);
    const stockRemaining = line
      ? computeLocalLine(line, dish.unitPrice).prevalentRemaining
      : 0;
    return statsFromCounts(
      dish.id,
      dish.name,
      line?.prepared ?? 0,
      unitCounts.local.get(dish.id),
      {
        soldAggregate: line?.sold ?? 0,
        pertesAggregate: line?.pertes ?? 0,
        stockRemaining,
      },
    );
  });
  const drinkStats = drinks.map((d) => {
    const counts = unitCounts.boisson.get(d.id);
    const generated =
      (counts?.prepare ?? 0) +
      (counts?.envoye ?? 0) +
      (counts?.vendu ?? 0) +
      (counts?.perdu ?? 0);
    const qrLeft = (counts?.prepare ?? 0) + (counts?.envoye ?? 0);
    return statsFromCounts(d.id, d.name, generated, counts, {
      qrToGenerate: 0,
      stockRemaining: qrLeft,
    });
  });

  return {
    date,
    plats,
    accStats,
    drinkStats,
    accompanimentLines: accLines,
    localDishes: zogbo.localDishes,
    baseDishes: zogbo.baseDishes,
    drinks,
  };
}

/**
 * Préparer des plats : incrémente le compteur agrégé via le mouvement
 * `prepare` existant (zogbo_jours).
 */
export async function preparePlatUnits(input: {
  date: string;
  productId: string;
  qty: number;
}): Promise<StockZogboPayload> {
  const qty = Math.round(Number(input.qty));
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new Error("Quantité préparée invalide.");
  }
  if (!isValidDate(input.date)) throw new Error("Date invalide.");

  await applyZogboMovement({
    date: input.date,
    productId: input.productId,
    type: "prepare",
    qty,
  });

  return getStockZogboPayload(input.date);
}

/**
 * Génère N QR unitaires uniques (plat, accompagnement ou boisson).
 */
export async function generatePlatQrUnits(input: {
  date: string;
  productId: string;
  qty: number;
  site?: VenteSite;
  kind?: StockUnitKind;
  movementId?: string | null;
  skipPayload?: boolean;
}): Promise<{ units: StockUnit[]; payload?: StockZogboPayload }> {
  const qty = Math.round(Number(input.qty));
  const site: VenteSite = input.site === "gbegamey" ? "gbegamey" : "zogbo";
  const kind: StockUnitKind =
    input.kind === "local" || input.kind === "boisson" ? input.kind : "plat";
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new Error("Nombre de QR invalide.");
  }
  if (!isValidDate(input.date)) throw new Error("Date invalide.");

  await ensureStockUnitIndexes();
  const parametres = await getParametres();
  let productName: string;

  if (kind === "local") {
    const dish = parametres.localDishes.find((d) => d.id === input.productId);
    if (!dish) throw new Error("Accompagnement introuvable dans le catalogue.");
    productName = dish.name;
    await ensureAccPreparedForQr({
      date: input.date,
      site,
      productId: input.productId,
      productName,
      qty,
    });
  } else if (kind === "boisson") {
    const drink = parametres.drinks.find((d) => d.id === input.productId);
    if (!drink) throw new Error("Boisson introuvable dans le catalogue.");
    productName = drink.name;
  } else if (site === "gbegamey") {
    const dish = parametres.baseDishes.find((d) => d.id === input.productId);
    if (!dish) throw new Error("Plat introuvable dans le catalogue.");
    productName = dish.name;
  } else {
    const zogbo = await getZogboDayPayload(input.date);
    const line = zogbo.day.lines.find((l) => l.productId === input.productId);
    if (!line) throw new Error("Plat introuvable dans le catalogue.");
    productName = line.name;

    const existing = await countUnitsByProduct(input.date);
    const counts = existing.plat.get(input.productId) ?? EMPTY_COUNTS;
    const qrGenerated =
      counts.prepare + counts.envoye + counts.vendu + counts.perdu;
    let remaining = line.prepared - qrGenerated;

    if (qty > remaining) {
      const deficit = qty - remaining;
      await applyZogboMovement({
        date: input.date,
        productId: input.productId,
        type: "prepare",
        qty: deficit,
      });
      const refreshed = await getZogboDayPayload(input.date);
      const refreshedLine = refreshed.day.lines.find(
        (l) => l.productId === input.productId,
      );
      if (!refreshedLine) throw new Error("Plat introuvable dans le catalogue.");
      remaining = refreshedLine.prepared - qrGenerated;
      if (qty > remaining) {
        throw new Error("Préparation automatique insuffisante pour générer les QR.");
      }
    }
  }

  const now = new Date().toISOString();
  const batchId = `${input.date}:${input.productId}:${Date.now()}`;
  const docs: StockUnitDoc[] = [];
  const used = new Set<string>();
  for (let i = 0; i < qty; i++) {
    let sticker = createStickerCode();
    let guard = 0;
    while (used.has(sticker) && guard < 20) {
      sticker = createStickerCode();
      guard += 1;
    }
    used.add(sticker);
    docs.push({
      _id: new ObjectId(),
      qrId: createQrId(sticker),
      stickerCode: sticker,
      kind,
      productId: input.productId,
      productName,
      batchId,
      date: input.date,
      site,
      status: "prepare",
      movementId: input.movementId ?? null,
      preparedAt: now,
      sentAt: null,
      soldAt: null,
      lostAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  const db = await getDb();
  await db.collection<StockUnitDoc>("stock_units").insertMany(docs);

  // Générer des QR = activer le suivi pour ce produit sur ce site.
  if (kind === "plat") {
    if (site === "zogbo") {
      const zogbo = await getZogboDayPayload(input.date);
      await saveZogboDay({
        date: input.date,
        lines: zogbo.day.lines.map((l) =>
          l.productId === input.productId ? { ...l, stockTracked: true } : l,
        ),
        accompanimentLines: zogbo.day.accompanimentLines,
      });
    } else {
      const gbegamey = await getGbegameyDayPayload(input.date);
      await saveGbegameyDay({
        date: input.date,
        transferLines: gbegamey.day.transferLines.map((l) =>
          l.productId === input.productId ? { ...l, stockTracked: true } : l,
        ),
        localLines: gbegamey.day.localLines,
        status: gbegamey.day.status,
      });
    }
  }

  const payload = input.skipPayload
    ? undefined
    : await getStockSitePayload(input.date, site);
  return { units: docs.map(toUnit), payload };
}

/** Annule les QR encore invendus d’un achat boissons — n’altère pas les unités déjà vendues. */
export async function voidPrepareUnitsByMovement(
  movementId: string,
): Promise<number> {
  const id = String(movementId ?? "").trim();
  if (!id) return 0;
  await ensureStockUnitIndexes();
  const now = new Date().toISOString();
  const db = await getDb();
  const result = await db.collection<StockUnitDoc>("stock_units").updateMany(
    { movementId: id, status: "prepare" },
    { $set: { status: "perdu", lostAt: now, updatedAt: now } },
  );
  return result.modifiedCount;
}

function withAccPrepared(
  lines: GbegameyLocalLine[],
  input: { productId: string; productName: string; needed: number },
): GbegameyLocalLine[] {
  const line = lines.find((l) => l.productId === input.productId);
  if (line) {
    return lines.map((l) =>
      l.productId === input.productId
        ? { ...l, prepared: input.needed, stockTracked: true }
        : l,
    );
  }
  return [
    ...lines,
    {
      productId: input.productId,
      name: input.productName,
      initialStock: 0,
      prepared: input.needed,
      sold: 0,
      pertes: 0,
      counted: null,
      observations: "",
      stockTracked: true,
    },
  ];
}

async function ensureAccPreparedForQr(input: {
  date: string;
  site: VenteSite;
  productId: string;
  productName: string;
  qty: number;
}): Promise<void> {
  const counts = await countUnitsByProduct(input.date, input.site);
  const c = counts.local.get(input.productId) ?? EMPTY_COUNTS;
  const qrGenerated = c.prepare + c.envoye + c.vendu + c.perdu;
  const needed = qrGenerated + input.qty;

  if (input.site === "gbegamey") {
    const gbegamey = await getGbegameyDayPayload(input.date);
    const lines = gbegamey.day.localLines ?? [];
    const prepared = lines.find((l) => l.productId === input.productId)?.prepared ?? 0;
    if (needed <= prepared) return;
    await saveGbegameyDay({
      date: input.date,
      transferLines: gbegamey.day.transferLines,
      localLines: withAccPrepared(lines, {
        productId: input.productId,
        productName: input.productName,
        needed,
      }),
      stockSaisie: true,
      status: gbegamey.day.status,
    });
    return;
  }

  const zogbo = await getZogboDayPayload(input.date);
  const lines = zogbo.day.accompanimentLines ?? [];
  const prepared = lines.find((l) => l.productId === input.productId)?.prepared ?? 0;
  if (needed <= prepared) return;
  await saveZogboDay({
    date: input.date,
    lines: zogbo.day.lines,
    accompanimentLines: withAccPrepared(lines, {
      productId: input.productId,
      productName: input.productName,
      needed,
    }),
    stockSaisie: true,
  });
}

export async function lookupStockUnit(qrId: string): Promise<StockUnit | null> {
  await ensureStockUnitIndexes();
  const raw = String(qrId ?? "").trim();
  if (!raw) return null;
  const sticker = normalizeStickerCode(raw);
  const candidates = [
    ...new Set(
      [raw, raw.toUpperCase(), raw.toLowerCase(), `KF-${sticker}`, sticker].filter(
        Boolean,
      ),
    ),
  ];

  const db = await getDb();
  const doc = await db.collection<StockUnitDoc>("stock_units").findOne({
    $or: [
      { qrId: { $in: candidates } },
      ...(sticker ? [{ stickerCode: sticker }] : []),
    ],
  });
  return doc ? toUnit(doc) : null;
}

export function scanStockUnit(
  unit: StockUnit,
  context: {
    date: string;
    site?: VenteSite;
    workflow: "zogbo-send" | "gbegamey-receive" | "vente";
  },
): StockUnitScanResult {
  const allowedActions: StockUnitScanResult["allowedActions"] = [];

  if (context.workflow === "vente") {
    const site = context.site;
    if (!site || (site !== "zogbo" && site !== "gbegamey")) {
      return { unit, allowedActions: [], message: "Site de vente invalide." };
    }

    if (unit.status === "vendu") {
      return {
        unit,
        allowedActions: [],
        message: "Ce QR a déjà été vendu.",
      };
    }
    if (unit.status === "perdu") {
      return {
        unit,
        allowedActions: [],
        message: "Cette unité est déclarée perdue.",
      };
    }

    if (site === "zogbo") {
      if (unit.site !== "zogbo" || unit.status !== "prepare") {
        if (unit.site === "gbegamey") {
          return {
            unit,
            allowedActions: [],
            message: "Ce plat est à Gbégamey — vendez-le depuis Gbégamey.",
          };
        }
        if (unit.status === "envoye") {
          return {
            unit,
            allowedActions: [],
            message: "Ce QR est en transit ou déjà envoyé à Gbégamey.",
          };
        }
        return {
          unit,
          allowedActions: [],
          message: `Statut incompatible pour la vente à Zogbo : ${unit.status}.`,
        };
      }
      allowedActions.push("sell");
      const dateHint =
        unit.date !== context.date
          ? ` (préparé le ${unit.date})`
          : null;
      return {
        unit,
        allowedActions,
        message: dateHint
          ? `Article prêt à vendre${dateHint}.`
          : "Article prêt à vendre.",
      };
    }

    if (unit.site !== "gbegamey" || (unit.status !== "envoye" && unit.status !== "prepare")) {
      if (unit.site === "zogbo" && unit.status === "prepare") {
        return {
          unit,
          allowedActions: [],
          message: "Cet article n'a pas encore été envoyé à Gbégamey.",
        };
      }
      return {
        unit,
        allowedActions: [],
        message: `Statut incompatible pour la vente à Gbégamey : ${unit.status}.`,
      };
    }
    allowedActions.push("sell");
    const dateHint =
      unit.date !== context.date ? ` (préparé le ${unit.date})` : null;
    return {
      unit,
      allowedActions,
      message: dateHint
        ? `Article prêt à vendre${dateHint}.`
        : "Article prêt à vendre.",
    };
  }

  if (context.workflow === "zogbo-send" || context.workflow === "gbegamey-receive") {
    if (unit.kind !== "plat") {
      return {
        unit,
        allowedActions: [],
        message: "Seuls les plats s’envoient vers Gbégamey.",
      };
    }
    if (unit.date !== context.date) {
      return {
        unit,
        allowedActions: [],
        message: `Ce QR appartient au ${unit.date}, pas au jour sélectionné (${context.date}).`,
      };
    }
    if (unit.site !== "zogbo" || unit.status !== "prepare") {
      if (unit.status === "envoye" || unit.status === "vendu") {
        return {
          unit,
          allowedActions: [],
          message: "Ce QR a déjà été transféré ou vendu.",
        };
      }
      if (unit.site === "gbegamey") {
        return {
          unit,
          allowedActions: [],
          message: "Ce QR est déjà à Gbégamey — transfert refusé depuis Zogbo.",
        };
      }
      return {
        unit,
        allowedActions: [],
        message: `Statut incompatible : ${unit.status}.`,
      };
    }
    allowedActions.push("send");
    return { unit, allowedActions, message: null };
  }

  return { unit, allowedActions, message: "Workflow inconnu." };
}

/**
 * Transfère des unités QR vers Gbégamey. Chaque unité est mise à jour
 * atomiquement ; le mouvement agrégé `send` n'est écrit qu'après succès unitaire.
 */
export async function sendPlatQrUnits(input: {
  date: string;
  qrIds: string[];
  payloadSite?: VenteSite;
}): Promise<{
  sent: StockUnit[];
  skipped: Array<{ qrId: string; reason: string }>;
  payload: StockZogboPayload;
}> {
  if (!isValidDate(input.date)) throw new Error("Date invalide.");
  const ids = [...new Set(input.qrIds.map((id) => String(id).trim()).filter(Boolean))];
  if (!ids.length) throw new Error("Aucun QR à envoyer.");

  await ensureStockUnitIndexes();
  const db = await getDb();
  const col = db.collection<StockUnitDoc>("stock_units");
  const now = new Date().toISOString();

  const sent: StockUnit[] = [];
  const skipped: Array<{ qrId: string; reason: string }> = [];
  const byProduct = new Map<string, string[]>();

  for (const qrId of ids) {
    const resolved = await lookupStockUnit(qrId);
    const canonical = resolved?.qrId ?? qrId;
    if (resolved && resolved.kind !== "plat") {
      skipped.push({ qrId, reason: "Seuls les plats s’envoient vers Gbégamey." });
      continue;
    }
    const doc = await col.findOneAndUpdate(
      {
        qrId: canonical,
        date: input.date,
        site: "zogbo",
        status: "prepare",
      },
      {
        $set: {
          status: "envoye",
          site: "gbegamey",
          sentAt: now,
          updatedAt: now,
        },
      },
      { returnDocument: "after" },
    );

    if (!doc) {
      const existing = await col.findOne({ qrId: canonical });
      if (!existing) {
        skipped.push({ qrId, reason: "QR introuvable." });
      } else if (existing.status === "envoye" || existing.status === "vendu") {
        skipped.push({ qrId, reason: "Déjà transféré." });
      } else if (existing.site === "gbegamey") {
        skipped.push({ qrId, reason: "Déjà à Gbégamey." });
      } else if (existing.date !== input.date) {
        skipped.push({ qrId, reason: `Jour ${existing.date}, pas ${input.date}.` });
      } else {
        skipped.push({ qrId, reason: "Transfert impossible (statut ou site)." });
      }
      continue;
    }

    const unit = toUnit(doc);
    sent.push(unit);
    const list = byProduct.get(unit.productId) ?? [];
    list.push(unit.qrId);
    byProduct.set(unit.productId, list);
  }

  const payloadSite: VenteSite =
    input.payloadSite === "gbegamey" ? "gbegamey" : "zogbo";

  if (!sent.length) {
    return {
      sent: [],
      skipped,
      payload: await getStockSitePayload(input.date, payloadSite),
    };
  }

  const rollback: StockUnit[] = [];

  try {
    for (const [productId, qrList] of byProduct) {
      const movementResult = await applyZogboMovement({
        date: input.date,
        productId,
        type: "send",
        qty: qrList.length,
      });

      await col.updateMany(
        { qrId: { $in: qrList } },
        { $set: { movementId: movementResult.movement.id, updatedAt: now } },
      );
    }
  } catch (error) {
    for (const unit of sent) {
      await col.updateOne(
        { qrId: unit.qrId, status: "envoye" },
        {
          $set: {
            status: "prepare",
            site: "zogbo",
            sentAt: null,
            movementId: null,
            updatedAt: now,
          },
        },
      );
      rollback.push(unit);
    }
    throw error instanceof Error
      ? error
      : new Error("Échec du mouvement d'envoi — unités QR restaurées.");
  }

  const payload = await getStockSitePayload(input.date, payloadSite);
  return { sent, skipped, payload };
}

export async function listPlatUnits(input: {
  date: string;
  productId: string;
  status?: StockUnitStatus;
  site?: "zogbo" | "gbegamey";
  limit?: number;
}): Promise<StockUnit[]> {
  await ensureStockUnitIndexes();
  const db = await getDb();
  const filter: Record<string, unknown> = {
    date: input.date,
    productId: input.productId,
  };
  if (input.status) filter.status = input.status;
  if (input.site) filter.site = input.site;

  const docs = await db
    .collection<StockUnitDoc>("stock_units")
    .find(filter)
    .sort({ createdAt: 1 })
    .limit(Math.min(500, input.limit ?? 200))
    .toArray();

  return docs.map(toUnit);
}

export async function saveAccompanimentStock(input: {
  date: string;
  accompanimentLines: GbegameyLocalLine[];
  site?: VenteSite;
}): Promise<StockZogboPayload> {
  const site: VenteSite = input.site === "gbegamey" ? "gbegamey" : "zogbo";
  if (site === "gbegamey") {
    const gbegamey = await getGbegameyDayPayload(input.date);
    await saveGbegameyDay({
      date: input.date,
      transferLines: gbegamey.day.transferLines,
      localLines: input.accompanimentLines,
      stockSaisie: true,
      status: gbegamey.day.status,
    });
    return getStockSitePayload(input.date, "gbegamey");
  }
  const zogbo = await getZogboDayPayload(input.date);
  await saveZogboDay({
    date: input.date,
    lines: zogbo.day.lines,
    accompanimentLines: input.accompanimentLines,
    stockSaisie: true,
  });
  return getStockSitePayload(input.date, "zogbo");
}

/**
 * Saisie stock d’un produit (site courant) + option QR.
 * Active le suivi pour CE produit seulement — l’autre site n’est pas touché.
 */
export async function registerProductStock(input: {
  date: string;
  site: VenteSite;
  productId: string;
  qty: number;
  kind?: StockUnitKind;
  generateQr: boolean;
}): Promise<{ units: StockUnit[]; payload?: StockZogboPayload }> {
  const qty = Math.round(Number(input.qty));
  const site: VenteSite = input.site === "gbegamey" ? "gbegamey" : "zogbo";
  const kind: StockUnitKind =
    input.kind === "local" || input.kind === "boisson" ? input.kind : "plat";
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new Error("Quantité invalide.");
  }
  if (!isValidDate(input.date)) throw new Error("Date invalide.");
  if (kind === "boisson") {
    throw new Error("Les boissons s’enregistrent via l’achat (+).");
  }

  const parametres = await getParametres();

  if (kind === "local") {
    const dish = parametres.localDishes.find((d) => d.id === input.productId);
    if (!dish) throw new Error("Accompagnement introuvable dans le catalogue.");
    if (site === "gbegamey") {
      const gbegamey = await getGbegameyDayPayload(input.date);
      const lines = gbegamey.day.localLines ?? [];
      const existing = lines.find((l) => l.productId === input.productId);
      const prepared = (existing?.prepared ?? 0) + qty;
      await saveGbegameyDay({
        date: input.date,
        transferLines: gbegamey.day.transferLines,
        localLines: withAccPrepared(lines, {
          productId: input.productId,
          productName: dish.name,
          needed: prepared,
        }),
        status: gbegamey.day.status,
      });
    } else {
      const zogbo = await getZogboDayPayload(input.date);
      const lines = zogbo.day.accompanimentLines ?? [];
      const existing = lines.find((l) => l.productId === input.productId);
      const prepared = (existing?.prepared ?? 0) + qty;
      await saveZogboDay({
        date: input.date,
        lines: zogbo.day.lines,
        accompanimentLines: withAccPrepared(lines, {
          productId: input.productId,
          productName: dish.name,
          needed: prepared,
        }),
      });
    }
  } else if (site === "zogbo") {
    await applyZogboMovement({
      date: input.date,
      productId: input.productId,
      type: "prepare",
      qty,
    });
    const zogbo = await getZogboDayPayload(input.date);
    await saveZogboDay({
      date: input.date,
      lines: zogbo.day.lines.map((l) =>
        l.productId === input.productId ? { ...l, stockTracked: true } : l,
      ),
      accompanimentLines: zogbo.day.accompanimentLines,
    });
  } else {
    const dish = parametres.baseDishes.find((d) => d.id === input.productId);
    if (!dish) throw new Error("Plat introuvable dans le catalogue.");
    const gbegamey = await getGbegameyDayPayload(input.date);
    const lines = gbegamey.day.transferLines.map((l) => {
      if (l.productId !== input.productId) return l;
      const counted =
        l.counted !== null && l.counted !== undefined
          ? Math.max(0, Number(l.counted) || 0) + qty
          : qty;
      return { ...l, counted, stockTracked: true };
    });
    const hasLine = gbegamey.day.transferLines.some(
      (l) => l.productId === input.productId,
    );
    const nextLines = hasLine
      ? lines
      : [
          ...lines,
          {
            productId: dish.id,
            name: dish.name,
            initialStock: 0,
            received: null,
            sold: 0,
            pertes: 0,
            counted: qty,
            observations: "",
            stockTracked: true,
          },
        ];
    await saveGbegameyDay({
      date: input.date,
      transferLines: nextLines,
      localLines: gbegamey.day.localLines,
      status: gbegamey.day.status,
    });
  }

  if (!input.generateQr) {
    return {
      units: [],
      payload: await getStockSitePayload(input.date, site),
    };
  }

  return generatePlatQrUnits({
    date: input.date,
    productId: input.productId,
    qty,
    site,
    kind,
  });
}

/** Vérifie la cohérence agrégés ↔ unités (tests / diagnostic). */
export function assertPlatStatsConsistent(stats: PlatUnitStats): string[] {
  const issues: string[] = [];
  if (stats.qrGenerated > stats.prepared) {
    issues.push("Plus de QR générés que de préparés.");
  }
  if (stats.qrSent > stats.sentAggregate) {
    issues.push("Plus d'unités QR envoyées que le compteur agrégé sent.");
  }
  if (stats.qrRemainingZogbo < 0) {
    issues.push("Reste Zogbo négatif.");
  }
  const expectedRemain = stats.prepared - stats.qrSent - stats.qrPerdu;
  if (
    stats.qrRemainingZogbo !==
    stats.qrGenerated - stats.qrSent - stats.qrVendu - stats.qrPerdu
  ) {
    issues.push("Décalage sur le reste Zogbo unitaire.");
  }
  if (expectedRemain < stats.qrRemainingZogbo - stats.qrVendu) {
    /* vendu à zogbo avant envoi — toléré */
  }
  return issues;
}

/** Réserve atomiquement une unité QR pour la vente (prepare@zogbo ou envoye@gbegamey). */
export async function claimPlatUnitForSale(input: {
  qrId: string;
  site: VenteSite;
}): Promise<StockUnit> {
  await ensureStockUnitIndexes();
  const qrId = String(input.qrId ?? "").trim();
  if (!qrId) throw new Error("QR invalide.");

  const resolved = await lookupStockUnit(qrId);
  const canonical = resolved?.qrId ?? qrId;

  const now = new Date().toISOString();
  const db = await getDb();
  const col = db.collection<StockUnitDoc>("stock_units");

  const filterZogbo = {
    qrId: canonical,
    site: "zogbo" as const,
    status: "prepare" as const,
  };
  const filterGbegameyEnvoye = {
    qrId: canonical,
    site: "gbegamey" as const,
    status: "envoye" as const,
  };
  const filterGbegameyPrepare = {
    qrId: canonical,
    site: "gbegamey" as const,
    status: "prepare" as const,
  };

  const filters =
    input.site === "zogbo"
      ? [filterZogbo]
      : [filterGbegameyEnvoye, filterGbegameyPrepare];

  let doc = null;
  for (const filter of filters) {
    doc = await col.findOneAndUpdate(
      filter,
      { $set: { status: "vendu", soldAt: now, updatedAt: now } },
      { returnDocument: "after" },
    );
    if (doc) break;
  }

  if (!doc) {
    const existing = await lookupStockUnit(qrId);
    if (!existing) throw new Error("QR introuvable.");
    const scan = scanStockUnit(existing, {
      date: existing.date,
      site: input.site,
      workflow: "vente",
    });
    throw new Error(scan.message ?? "QR non vendable.");
  }

  return toUnit(doc);
}

/** Annule la vente d'une unité QR (ticket annulé ou rollback POS). */
export async function restorePlatUnitAfterSaleCancel(input: {
  qrId: string;
  site: VenteSite;
}): Promise<void> {
  await ensureStockUnitIndexes();
  const qrId = String(input.qrId ?? "").trim();
  if (!qrId) return;

  const resolved = await lookupStockUnit(qrId);
  const canonical = resolved?.qrId ?? qrId;

  const now = new Date().toISOString();
  const db = await getDb();
  const col = db.collection<StockUnitDoc>("stock_units");
  const current = await col.findOne({ qrId: canonical, status: "vendu" });
  if (!current) return;

  const prevStatus = current.sentAt ? "envoye" : "prepare";
  await col.updateOne(
    { qrId: canonical, status: "vendu" },
    { $set: { status: prevStatus, soldAt: null, updatedAt: now } },
  );
}

export async function markUnitLost(input: {
  qrId: string;
  date: string;
}): Promise<StockUnit> {
  await ensureStockUnitIndexes();
  const now = new Date().toISOString();
  const db = await getDb();
  const doc = await db.collection<StockUnitDoc>("stock_units").findOne({
    qrId: input.qrId,
    date: input.date,
  });
  if (!doc) throw new Error("QR introuvable.");
  if (!canTransitionUnitStatus(doc.status, "perdu")) {
    throw new Error(`Impossible de déclarer perdu depuis le statut ${doc.status}.`);
  }

  const updated = await db.collection<StockUnitDoc>("stock_units").findOneAndUpdate(
    { qrId: input.qrId, status: doc.status },
    { $set: { status: "perdu", lostAt: now, updatedAt: now } },
    { returnDocument: "after" },
  );
  if (!updated) throw new Error("Mise à jour perdue impossible (conflit).");
  return toUnit(updated);
}
