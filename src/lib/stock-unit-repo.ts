import { ObjectId } from "mongodb";
import { randomUUID } from "crypto";
import { getDb } from "@/lib/mongodb";
import { isValidDate } from "@/lib/day-doc";
import { applyZogboMovement } from "@/lib/zogbo-repo";
import { getZogboDayPayload, saveZogboDay } from "@/lib/zogbo-repo";
import type { GbegameyLocalLine, VenteSite } from "@/lib/types";
import {
  canTransitionUnitStatus,
  type PlatUnitStats,
  type StockUnit,
  type StockUnitScanResult,
  type StockUnitStatus,
  type StockZogboPayload,
} from "@/lib/stock-unit-types";

type StockUnitDoc = {
  _id: ObjectId;
  qrId: string;
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

export function createQrId(): string {
  return `KF-${randomUUID()}`;
}

function toUnit(doc: StockUnitDoc): StockUnit {
  return {
    id: doc._id.toHexString(),
    qrId: doc.qrId,
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

async function countUnitsByProduct(
  date: string,
): Promise<Map<string, Record<StockUnitStatus, number>>> {
  await ensureStockUnitIndexes();
  const db = await getDb();
  const rows = await db
    .collection<StockUnitDoc>("stock_units")
    .aggregate<{ _id: { productId: string; status: StockUnitStatus }; n: number }>(
      [
        { $match: { date } },
        {
          $group: {
            _id: { productId: "$productId", status: "$status" },
            n: { $sum: 1 },
          },
        },
      ],
    )
    .toArray();

  const map = new Map<string, Record<StockUnitStatus, number>>();
  for (const row of rows) {
    const pid = row._id.productId;
    const cur =
      map.get(pid) ??
      ({ prepare: 0, envoye: 0, vendu: 0, perdu: 0 } as Record<
        StockUnitStatus,
        number
      >);
    cur[row._id.status] = row.n;
    map.set(pid, cur);
  }
  return map;
}

export async function getStockZogboPayload(
  date: string,
): Promise<StockZogboPayload> {
  if (!isValidDate(date)) throw new Error("Date invalide (attendu YYYY-MM-DD)");

  const [zogbo, unitCounts] = await Promise.all([
    getZogboDayPayload(date),
    countUnitsByProduct(date),
  ]);

  const plats: PlatUnitStats[] = zogbo.baseDishes.map((dish) => {
    const line = zogbo.day.lines.find((l) => l.productId === dish.id);
    const counts = unitCounts.get(dish.id) ?? {
      prepare: 0,
      envoye: 0,
      vendu: 0,
      perdu: 0,
    };
    const qrGenerated =
      counts.prepare + counts.envoye + counts.vendu + counts.perdu;
    const qrSent = counts.envoye + counts.vendu;
    const prepared = line?.prepared ?? 0;

    return {
      productId: dish.id,
      productName: dish.name,
      prepared,
      sentAggregate: line?.sentToGbegamey ?? 0,
      soldAggregate: line?.sold ?? 0,
      pertesAggregate: line?.pertes ?? 0,
      stockAggregate: line?.stock ?? 0,
      qrGenerated,
      qrSent,
      qrRemainingZogbo: counts.prepare,
      qrVendu: counts.vendu,
      qrPerdu: counts.perdu,
      qrToGenerate: Math.max(0, prepared - qrGenerated),
    };
  });

  return {
    date,
    plats,
    accompanimentLines: zogbo.day.accompanimentLines ?? [],
    localDishes: zogbo.localDishes,
    baseDishes: zogbo.baseDishes,
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
 * Génère N QR unitaires uniques. Refuse les doublons implicites : N ne peut
 * pas dépasser `prepared − déjà générés`.
 */
export async function generatePlatQrUnits(input: {
  date: string;
  productId: string;
  qty: number;
}): Promise<{ units: StockUnit[]; payload: StockZogboPayload }> {
  const qty = Math.round(Number(input.qty));
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new Error("Nombre de QR invalide.");
  }
  if (!isValidDate(input.date)) throw new Error("Date invalide.");

  await ensureStockUnitIndexes();

  const zogbo = await getZogboDayPayload(input.date);
  const line = zogbo.day.lines.find((l) => l.productId === input.productId);
  if (!line) throw new Error("Plat introuvable dans le catalogue.");

  const existing = await countUnitsByProduct(input.date);
  const counts = existing.get(input.productId) ?? {
    prepare: 0,
    envoye: 0,
    vendu: 0,
    perdu: 0,
  };
  const qrGenerated =
    counts.prepare + counts.envoye + counts.vendu + counts.perdu;
  const remaining = line.prepared - qrGenerated;

  if (qty > remaining) {
    throw new Error(
      `Impossible de générer ${qty} QR : seulement ${remaining} unité(s) préparée(s) sans QR (${line.prepared} préparés, ${qrGenerated} QR déjà créés).`,
    );
  }

  const now = new Date().toISOString();
  const batchId = `${input.date}:${input.productId}:${Date.now()}`;
  const docs: StockUnitDoc[] = Array.from({ length: qty }, () => ({
    _id: new ObjectId(),
    qrId: createQrId(),
    productId: input.productId,
    productName: line.name,
    batchId,
    date: input.date,
    site: "zogbo",
    status: "prepare",
    movementId: null,
    preparedAt: now,
    sentAt: null,
    soldAt: null,
    lostAt: null,
    createdAt: now,
    updatedAt: now,
  }));

  const db = await getDb();
  await db.collection<StockUnitDoc>("stock_units").insertMany(docs);

  const payload = await getStockZogboPayload(input.date);
  return { units: docs.map(toUnit), payload };
}

export async function lookupStockUnit(qrId: string): Promise<StockUnit | null> {
  await ensureStockUnitIndexes();
  const normalized = String(qrId ?? "").trim();
  if (!normalized) return null;

  const db = await getDb();
  const doc = await db
    .collection<StockUnitDoc>("stock_units")
    .findOne({ qrId: normalized });
  return doc ? toUnit(doc) : null;
}

export function scanStockUnit(
  unit: StockUnit,
  context: {
    date: string;
    site?: VenteSite;
    workflow: "zogbo-send" | "vente";
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
          ? `Plat prêt à vendre${dateHint}.`
          : "Plat prêt à vendre.",
      };
    }

    if (unit.site !== "gbegamey" || unit.status !== "envoye") {
      if (unit.site === "zogbo" && unit.status === "prepare") {
        return {
          unit,
          allowedActions: [],
          message: "Ce plat n'a pas encore été envoyé à Gbégamey.",
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
        ? `Plat prêt à vendre${dateHint}.`
        : "Plat prêt à vendre.",
    };
  }

  if (context.workflow === "zogbo-send") {
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
    const doc = await col.findOneAndUpdate(
      {
        qrId,
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
      const existing = await col.findOne({ qrId });
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

  if (!sent.length) {
    return {
      sent: [],
      skipped,
      payload: await getStockZogboPayload(input.date),
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

  const payload = await getStockZogboPayload(input.date);
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
}): Promise<StockZogboPayload> {
  const zogbo = await getZogboDayPayload(input.date);
  await saveZogboDay({
    date: input.date,
    lines: zogbo.day.lines,
    accompanimentLines: input.accompanimentLines,
    stockSaisie: true,
  });
  return getStockZogboPayload(input.date);
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

  const filter =
    input.site === "zogbo"
      ? { qrId, site: "zogbo" as const, status: "prepare" as const }
      : { qrId, site: "gbegamey" as const, status: "envoye" as const };

  const now = new Date().toISOString();
  const db = await getDb();
  const doc = await db.collection<StockUnitDoc>("stock_units").findOneAndUpdate(
    filter,
    { $set: { status: "vendu", soldAt: now, updatedAt: now } },
    { returnDocument: "after" },
  );

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

  const prevStatus = input.site === "zogbo" ? "prepare" : "envoye";
  const now = new Date().toISOString();
  const db = await getDb();
  await db.collection<StockUnitDoc>("stock_units").updateOne(
    { qrId, status: "vendu" },
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
