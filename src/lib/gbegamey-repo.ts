import { updateDayDocument } from "@/lib/day-doc";
import { getDb } from "@/lib/mongodb";
import { getParametres } from "@/lib/parametres-repo";
import type {
  BaseDish,
  GbegameyDay,
  GbegameyLocalLine,
  GbegameyTransferLine,
  LocalDish,
} from "@/lib/types";
import {
  createEmptyGbegameyDay,
  leftoverFromLocalLines,
  leftoverFromTransferLines,
  normalizeLocalLine,
  normalizeTransferLine,
  syncLocalLines,
  syncTransferLines,
} from "@/lib/gbegamey-calc";
import { getZogboDayPayload } from "@/lib/zogbo-repo";
import {
  LEFTOVER_LOOKBACK_DAYS,
  previousIsoDate,
  shiftIsoDate,
} from "@/lib/zogbo-calc";
import {
  loadAquaAlimentStocks,
  openingByProductName,
} from "@/lib/aquapro-opening-stock";

type GbegameyDoc = Omit<GbegameyDay, "date"> & { _id: string; rev?: number };

function isValidDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

function toDay(doc: GbegameyDoc): GbegameyDay {
  return {
    date: doc._id,
    status: doc.status ?? "ouverte",
    transferLines: (doc.transferLines ?? []).map((l) =>
      normalizeTransferLine(l),
    ),
    localLines: (doc.localLines ?? []).map((l) => normalizeLocalLine(l)),
    updatedAt: doc.updatedAt ?? null,
  };
}

export type GbegameyDayPayload = {
  day: GbegameyDay;
  baseDishes: BaseDish[];
  localDishes: LocalDish[];
  /** Qté envoyée par Zogbo le même jour, par productId */
  sentByProductId: Record<string, number>;
  /**
   * Première mise en service : aucune journée antérieure en base, il n’y a donc
   * rien à reporter. Gbégamey saisit lui-même son stock de départ. Dès qu’une
   * journée précède celle-ci, le report reprend la main et le champ se verrouille.
   */
  openingEditable: boolean;
};

/** Vrai tant qu’aucune journée Gbégamey n’a été enregistrée avant cette date. */
async function isOpeningDay(date: string): Promise<boolean> {
  const db = await getDb();
  const previous = await db
    .collection<GbegameyDoc>("gbegamey_jours")
    .findOne({ _id: { $lt: date } }, { projection: { _id: 1 } });
  return !previous;
}

async function loadSentMap(date: string): Promise<Record<string, number>> {
  const { day: zogbo } = await getZogboDayPayload(date);
  const map: Record<string, number> = {};
  for (const line of zogbo.lines) {
    map[line.productId] = line.sentToGbegamey;
  }
  return map;
}

/**
 * Reste à reporter : on remonte au dernier jour réellement travaillé dans la
 * fenêtre de report — une journée de fermeture ne doit pas remettre les
 * stocks à zéro, mais un plat ne se reporte pas indéfiniment.
 */
async function leftoversForDate(
  date: string,
  localDishes: LocalDish[],
): Promise<{
  transfer: Map<string, number>;
  local: Map<string, number>;
}> {
  const prev = previousIsoDate(date);
  const floor = shiftIsoDate(date, -LEFTOVER_LOOKBACK_DAYS);
  if (prev && floor) {
    const db = await getDb();
    const prevDoc = await db
      .collection<GbegameyDoc>("gbegamey_jours")
      .find({ _id: { $lte: prev, $gte: floor } })
      .sort({ _id: -1 })
      .limit(1)
      .next();
    if (prevDoc) {
      const prevSent = await loadSentMap(prevDoc._id);
      const receivedMap = new Map(Object.entries(prevSent));
      return {
        transfer: leftoverFromTransferLines(
          (prevDoc.transferLines ?? []).map((l) => normalizeTransferLine(l)),
          receivedMap,
        ),
        local: leftoverFromLocalLines(
          (prevDoc.localLines ?? []).map((l) => normalizeLocalLine(l)),
        ),
      };
    }
  }
  try {
    const { byName } = await loadAquaAlimentStocks();
    return {
      transfer: new Map(),
      local: openingByProductName(localDishes, byName),
    };
  } catch {
    return { transfer: new Map(), local: new Map() };
  }
}

export async function getGbegameyDayPayload(
  date: string,
): Promise<GbegameyDayPayload> {
  if (!isValidDate(date)) {
    throw new Error("Date invalide (attendu YYYY-MM-DD)");
  }

  const { baseDishes, localDishes } = await getParametres();
  const sentByProductId = await loadSentMap(date);
  const openingEditable = await isOpeningDay(date);
  const db = await getDb();
  const col = db.collection<GbegameyDoc>("gbegamey_jours");
  const existing = await col.findOne({ _id: date });

  if (!existing) {
    const leftovers = await leftoversForDate(date, localDishes);
    const day = createEmptyGbegameyDay(
      date,
      baseDishes,
      localDishes,
      leftovers.transfer,
      leftovers.local,
    );
    if (leftovers.local.size > 0 || leftovers.transfer.size > 0) {
      const updatedAt = new Date().toISOString();
      const localLines = day.localLines.map((l) => ({
        ...l,
        counted: leftovers.local.has(l.productId) ? l.initialStock : null,
        observations: leftovers.local.has(l.productId)
          ? "Ouverture AquaPro (stock final)"
          : "",
      }));
      await col.updateOne(
        { _id: date },
        {
          $set: {
            status: "ouverte",
            transferLines: day.transferLines,
            localLines,
            updatedAt,
            source: "aquapro-opening",
          },
          $setOnInsert: { _id: date },
        },
        { upsert: true },
      );
      return {
        day: { ...day, localLines, updatedAt },
        baseDishes,
        localDishes,
        sentByProductId,
        openingEditable,
      };
    }
    return {
      day,
      baseDishes,
      localDishes,
      sentByProductId,
      openingEditable,
    };
  }

  const day = toDay(existing);
  return {
    day: {
      ...day,
      transferLines: syncTransferLines(day.transferLines, baseDishes),
      localLines: syncLocalLines(day.localLines, localDishes),
    },
    baseDishes,
    localDishes,
    sentByProductId,
    openingEditable,
  };
}

export async function saveGbegameyDay(
  input: {
    date: string;
    status?: GbegameyDay["status"];
    transferLines: GbegameyTransferLine[];
    localLines: GbegameyLocalLine[];
  },
  options?: { lockSold?: boolean; directWrite?: boolean },
): Promise<GbegameyDayPayload> {
  if (!isValidDate(input.date)) {
    throw new Error("Date invalide (attendu YYYY-MM-DD)");
  }

  const lockSold = options?.lockSold !== false;
  const directWrite = options?.directWrite === true;
  const { baseDishes, localDishes } = await getParametres();
  const openingEditable = await isOpeningDay(input.date);

  return updateDayDocument<GbegameyDoc, GbegameyDayPayload>(
    "gbegamey_jours",
    input.date,
    async (existing) => {
      const leftovers = await leftoversForDate(input.date, localDishes);

      // Compteurs conservés depuis la base : la grille ne pilote que la
      // réception constatée, le comptage et les notes.
      const heldTransfer = new Map(
        (existing?.transferLines ?? []).map((l) => [
          l.productId,
          normalizeTransferLine(l),
        ]),
      );
      const heldLocal = new Map(
        (existing?.localLines ?? []).map((l) => [
          l.productId,
          normalizeLocalLine(l),
        ]),
      );

      const transferLines = syncTransferLines(
        input.transferLines,
        baseDishes,
      ).map((l) => {
        const normalized = normalizeTransferLine(l);
        if (directWrite) {
          return { ...normalized, pertes: 0 };
        }
        const held = heldTransfer.get(l.productId);
        const initialStock = openingEditable
          ? normalized.initialStock
          : existing
            ? (held?.initialStock ??
              leftovers.transfer.get(l.productId) ??
              0)
            : (leftovers.transfer.get(l.productId) ?? 0);
        const sold = lockSold ? (held?.sold ?? 0) : normalized.sold;
        const pertes = held?.pertes ?? 0;
        return { ...normalized, initialStock, sold, pertes };
      });

      const localLines = syncLocalLines(input.localLines, localDishes).map(
        (l) => {
          const normalized = normalizeLocalLine(l);
          if (directWrite) {
            return { ...normalized, pertes: 0 };
          }
          const held = heldLocal.get(l.productId);
          const initialStock = openingEditable
            ? normalized.initialStock
            : existing
              ? (held?.initialStock ?? leftovers.local.get(l.productId) ?? 0)
              : (leftovers.local.get(l.productId) ?? 0);
          const sold = lockSold ? (held?.sold ?? 0) : normalized.sold;
          const pertes = held?.pertes ?? 0;
          return { ...normalized, initialStock, sold, pertes };
        },
      );

      const updatedAt = new Date().toISOString();
      const status = input.status ?? "ouverte";
      const sentByProductId = await loadSentMap(input.date);

      return {
        set: { status, transferLines, localLines, updatedAt },
        result: {
          day: {
            date: input.date,
            status,
            transferLines,
            localLines,
            updatedAt,
          },
          baseDishes,
          localDishes,
          sentByProductId,
          openingEditable,
        },
      };
    },
  );
}
