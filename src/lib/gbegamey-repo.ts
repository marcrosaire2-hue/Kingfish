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
  leftoverMapHasStock,
  previousIsoDate,
  shiftIsoDate,
} from "@/lib/zogbo-calc";
import {
  loadAquaAlimentStocks,
  openingByProductName,
} from "@/lib/aquapro-opening-stock";

type GbegameyDoc = Omit<GbegameyDay, "date"> & {
  _id: string;
  rev?: number;
  source?: string;
};

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
 * Reste à reporter : saute les journées vides pour ne pas casser la chaîne
 * après un jour auto-créé à zéro (signé ou non).
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
    const docs = await db
      .collection<GbegameyDoc>("gbegamey_jours")
      .find({ _id: { $lte: prev, $gte: floor } })
      .sort({ _id: -1 })
      .toArray();

    for (const prevDoc of docs) {
      const useCounted = prevDoc.status === "cloturee";
      const prevSent = await loadSentMap(prevDoc._id);
      const receivedMap = new Map(Object.entries(prevSent));
      const transfer = leftoverFromTransferLines(
        (prevDoc.transferLines ?? []).map((l) => normalizeTransferLine(l)),
        receivedMap,
        undefined,
        { useCounted },
      );
      const local = leftoverFromLocalLines(
        (prevDoc.localLines ?? []).map((l) => normalizeLocalLine(l)),
        undefined,
        { useCounted },
      );
      if (leftoverMapHasStock(transfer) || leftoverMapHasStock(local)) {
        return { transfer, local };
      }
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

/**
 * Journée issue d'une projection AquaPro pure : le seed
 * (seed-opening-stock-from-aquapro) ne marque que les lignes qu'il remplit
 * (désignations qui matchent), les autres restent vides à tort — les produits
 * existants (brochette, chawarma…) apparaîtraient « épuisés » malgré le stock
 * réel de la veille. Une telle journée ne doit pas bloquer le report.
 */
function isPureAquaproProjection(doc: GbegameyDoc): boolean {
  if (doc.source !== "aquapro-opening") return false;
  const observations = [
    ...(doc.transferLines ?? []),
    ...(doc.localLines ?? []),
  ].map((l) => l.observations ?? "");
  return observations.every(
    (o) => o === "" || o.startsWith("Ouverture AquaPro"),
  );
}

function gbegameyDocNeedsStockHeal(doc: GbegameyDoc): boolean {
  // Sans received map on approxime via initialStock / counted / sold.
  const transferEmpty = !(doc.transferLines ?? []).some((l) => {
    const n = normalizeTransferLine(l);
    return (
      n.initialStock > 0 ||
      n.sold > 0 ||
      (n.counted !== null && n.counted > 0)
    );
  });
  const localEmpty = !leftoverMapHasStock(
    leftoverFromLocalLines(
      (doc.localLines ?? []).map((l) => normalizeLocalLine(l)),
    ),
  );
  // Journée déjà travaillée (ventes / réceptions vérifiées) : ne pas écraser.
  const worked = (doc.transferLines ?? []).some((l) => {
    const n = normalizeTransferLine(l);
    return n.sold > 0 || (n.received ?? 0) > 0;
  });
  const localWorked = (doc.localLines ?? []).some((l) => {
    const n = normalizeLocalLine(l);
    return n.sold > 0 || n.prepared > 0;
  });
  if (worked || localWorked || doc.status === "cloturee") return false;
  // Journée entièrement vide (auto-créée) : laisser la main au report du
  // dernier stock réel.
  if (transferEmpty && localEmpty) return true;
  // Projection AquaPro non travaillée : le report de la veille reprend la main
  // pour les produits que le seed n'a pas remplies.
  return isPureAquaproProjection(doc);
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

  const materializeFromLeftovers = async (source: string) => {
    const leftovers = await leftoversForDate(date, localDishes);
    const has =
      leftoverMapHasStock(leftovers.transfer) ||
      leftoverMapHasStock(leftovers.local);
    if (!has) return null;

    const day = createEmptyGbegameyDay(
      date,
      baseDishes,
      localDishes,
      leftovers.transfer,
      leftovers.local,
    );
    const updatedAt = new Date().toISOString();
    // Non signé : counted reste null pour que le théorique suive les ventes.
    const localLines = day.localLines.map((l) => ({
      ...l,
      counted: null,
      observations:
        l.initialStock > 0 ? "Report stock veille (non inventorié)" : "",
    }));
    const transferLines = day.transferLines.map((l) => ({
      ...l,
      counted: null,
      observations:
        l.initialStock > 0 ? "Report stock veille (non inventorié)" : "",
    }));
    await col.updateOne(
      { _id: date },
      {
        $set: {
          status: existing?.status ?? "ouverte",
          transferLines,
          localLines,
          updatedAt,
          source,
        },
        $setOnInsert: { _id: date },
      },
      { upsert: true },
    );
    return {
      day: {
        ...day,
        transferLines,
        localLines,
        status: (existing?.status ?? "ouverte") as GbegameyDay["status"],
        updatedAt,
      },
      baseDishes,
      localDishes,
      sentByProductId,
      openingEditable,
    };
  };

  if (!existing) {
    const created = await materializeFromLeftovers("stock-report");
    if (created) return created;
    return {
      day: createEmptyGbegameyDay(date, baseDishes, localDishes),
      baseDishes,
      localDishes,
      sentByProductId,
      openingEditable,
    };
  }

  if (gbegameyDocNeedsStockHeal(existing)) {
    const healed = await materializeFromLeftovers("stock-report");
    if (healed) return healed;
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
