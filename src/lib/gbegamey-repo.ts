import { ObjectId } from "mongodb";
import { assertDayOpen, isValidDate, updateDayDocument } from "@/lib/day-doc";
import { mergeVentesSansStockOnSave, dayVentesSansStock } from "@/lib/ventes-sans-stock";
import { getDb } from "@/lib/mongodb";
import { withStockCarry } from "@/lib/stock-carry";

type Tail<T extends unknown[]> = T extends [unknown, ...infer R] ? R : never;
import { getParametres } from "@/lib/parametres-repo";
import type {
  BaseDish,
  GbegameyDay,
  GbegameyLocalLine,
  GbegameyReceiptMovement,
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
import {
  LEFTOVER_LOOKBACK_DAYS,
  leftoverMapHasStock,
  previousIsoDate,
  shiftIsoDate,
} from "@/lib/zogbo-calc";

type GbegameyDoc = Omit<GbegameyDay, "date"> & {
  _id: string;
  rev?: number;
  source?: string;
};

function toDay(doc: GbegameyDoc): GbegameyDay {
  return {
    date: doc._id,
    status: doc.status ?? "ouverte",
    transferLines: (doc.transferLines ?? []).map((l) =>
      normalizeTransferLine(l),
    ),
    localLines: (doc.localLines ?? []).map((l) => normalizeLocalLine(l)),
    receipts: Array.isArray(doc.receipts) ? doc.receipts : [],
    updatedAt: doc.updatedAt ?? null,
    ventesSansStock: dayVentesSansStock(doc),
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

/**
 * Gbégamey est indépendant de Zogbo : plus aucun envoi n'est lu côté Zogbo,
 * le stock du site ne dépend que de sa propre saisie.
 */
async function loadSentMap(_date: string): Promise<Record<string, number>> {
  void _date;
  return {};
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
  /** Produits dont le stock a été saisi : la vente reste plafonnée au stock. */
  trackedTransfer: Set<string>;
  trackedLocal: Set<string>;
}> {
  void localDishes;
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
      const prevSent = await loadSentMap(prevDoc._id);
      const receivedMap = new Map(Object.entries(prevSent));
      const transfer = leftoverFromTransferLines(
        (prevDoc.transferLines ?? []).map((l) => normalizeTransferLine(l)),
        receivedMap,
        undefined,
      );
      const local = leftoverFromLocalLines(
        (prevDoc.localLines ?? []).map((l) => normalizeLocalLine(l)),
        undefined,
      );
      const trackedTransfer = new Set(
        (prevDoc.transferLines ?? [])
          .filter((l) => l.stockTracked === true)
          .map((l) => l.productId),
      );
      const trackedLocal = new Set(
        (prevDoc.localLines ?? [])
          .filter((l) => l.stockTracked === true)
          .map((l) => l.productId),
      );
      if (
        leftoverMapHasStock(transfer) ||
        leftoverMapHasStock(local) ||
        trackedTransfer.size > 0 ||
        trackedLocal.size > 0
      ) {
        return { transfer, local, trackedTransfer, trackedLocal };
      }
    }
  }
  // Le stock Gbégamey ne provient plus que des saisies faites dans l'appli :
  // plus de reprise du stock d'ouverture AquaPro.
  return {
    transfer: new Map(),
    local: new Map(),
    trackedTransfer: new Set(),
    trackedLocal: new Set(),
  };
}

/** Une ligne porte-t-elle une entrée de stock (initial, préparé, reçu, compté) ? */
function lineHasStockEntry(line: {
  initialStock?: number;
  prepared?: number;
  received?: number | null;
  counted?: number | null;
}): boolean {
  return (
    (Number(line.initialStock) || 0) > 0 ||
    (Number(line.prepared) || 0) > 0 ||
    (Number(line.received) || 0) > 0 ||
    (line.counted !== null &&
      line.counted !== undefined &&
      (Number(line.counted) || 0) > 0)
  );
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
    // « Ouverture » couvre les anciennes notes (« Ouverture AquaPro… ») et
    // les nouvelles (« Ouverture (…) »).
    (o) => o === "" || o.startsWith("Ouverture"),
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
  if (doc.status === "cloturee") return false;
  // Ventes enregistrées sans aucune entrée de stock ce jour-là (ni suivi) :
  // le stock saisi la veille reprend la main, les ventes sont conservées.
  const allLines = [...(doc.transferLines ?? []), ...(doc.localLines ?? [])];
  if (
    !allLines.some((l) => lineHasStockEntry(l)) &&
    !allLines.some((l) => l.stockTracked === true)
  ) {
    return true;
  }
  if (worked || localWorked) return false;
  // Journée entièrement vide (auto-créée) : laisser la main au report du
  // dernier stock réel.
  if (transferEmpty && localEmpty) return true;
  // Projection AquaPro non travaillée : le report de la veille reprend la main
  // pour les produits que le seed n'a pas remplies.
  return isPureAquaproProjection(doc);
}

/**
 * Réglage « vente libre / vente selon le stock » hérité : celui de la
 * dernière journée Gbégamey qui en porte un. Une fois le stock saisi, la vente
 * selon le stock reste active les jours suivants sans réactivation manuelle ;
 * l'admin peut toujours repasser un jour en vente libre.
 */
async function inheritedFreeSale(date: string): Promise<boolean> {
  const db = await getDb();
  const prev = await db
    .collection<GbegameyDoc>("gbegamey_jours")
    .find(
      { _id: { $lt: date }, ventesSansStock: { $type: "bool" } },
      { projection: { ventesSansStock: 1 } },
    )
    .sort({ _id: -1 })
    .limit(1)
    .next();
  return typeof prev?.ventesSansStock === "boolean"
    ? prev.ventesSansStock
    : true;
}

export async function getGbegameyDayPayload(
  date: string,
): Promise<GbegameyDayPayload> {
  const payload = await buildGbegameyDayPayload(date);
  const db = await getDb();
  const doc = await db
    .collection<GbegameyDoc>("gbegamey_jours")
    .findOne({ _id: date }, { projection: { ventesSansStock: 1 } });
  const ventesSansStock =
    typeof doc?.ventesSansStock === "boolean"
      ? doc.ventesSansStock
      : await inheritedFreeSale(date);
  return { ...payload, day: { ...payload.day, ventesSansStock } };
}

async function buildGbegameyDayPayload(
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
      leftoverMapHasStock(leftovers.local) ||
      leftovers.trackedTransfer.size > 0 ||
      leftovers.trackedLocal.size > 0;
    if (!has) return null;
    // Ventes / pertes déjà enregistrées ce jour : conservées lors du report.
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

    const day = createEmptyGbegameyDay(
      date,
      baseDishes,
      localDishes,
      leftovers.transfer,
      leftovers.local,
    );
    const updatedAt = new Date().toISOString();
    // Non signé : counted reste null pour que le théorique suive les ventes.
    // Un produit dont le stock a été saisi reste plafonné au stock le
    // lendemain : le suivi (`stockTracked`) est reporté avec le reste.
    const localLines = day.localLines.map((l) => {
      const held = heldLocal.get(l.productId);
      return {
        ...l,
        sold: held?.sold ?? l.sold,
        pertes: held?.pertes ?? l.pertes,
        counted: null,
        observations:
          l.initialStock > 0 ? "Report stock veille (non inventorié)" : "",
        ...(leftovers.trackedLocal.has(l.productId)
          ? { stockTracked: true }
          : {}),
      };
    });
    const transferLines = day.transferLines.map((l) => {
      const held = heldTransfer.get(l.productId);
      return {
        ...l,
        sold: held?.sold ?? l.sold,
        pertes: held?.pertes ?? l.pertes,
        counted: null,
        observations:
          l.initialStock > 0 ? "Report stock veille (non inventorié)" : "",
        ...(leftovers.trackedTransfer.has(l.productId)
          ? { stockTracked: true }
          : {}),
      };
    });
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
  input: Parameters<typeof saveGbegameyDayRaw>[0],
  ...rest: Tail<Parameters<typeof saveGbegameyDayRaw>>
): ReturnType<typeof saveGbegameyDayRaw> {
  return withStockCarry("gbegamey", input.date, () => saveGbegameyDayRaw(input, ...rest));
}

async function saveGbegameyDayRaw(
  input: {
    date: string;
    status?: GbegameyDay["status"];
    transferLines: GbegameyTransferLine[];
    localLines: GbegameyLocalLine[];
    stockSaisie?: boolean;
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
      const receipts = existing?.receipts ?? [];
      // Saisie de stock → vente selon le stock, sauf choix explicite de
      // l'admin pour ce jour. Sans saisie, le réglage hérité de la veille
      // n'est pas figé dans le document : une saisie plus tard dans la
      // journée peut encore activer la vente selon le stock.
      const explicit = typeof existing?.ventesSansStock === "boolean";
      const ventesSansStock = mergeVentesSansStockOnSave({
        stockSaisie: input.stockSaisie,
        existing,
        fallback: input.stockSaisie
          ? false
          : await inheritedFreeSale(input.date),
      });
      const persistPolicy = explicit || input.stockSaisie === true;

      return {
        set: {
          status,
          transferLines,
          localLines,
          receipts,
          updatedAt,
          ...(persistPolicy ? { ventesSansStock } : {}),
        },
        result: {
          day: {
            date: input.date,
            status,
            transferLines,
            localLines,
            receipts,
            updatedAt,
            ventesSansStock,
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

export type ReceiptActor = { id: string; name: string };

/**
 * Confirme la réception d’un plat envoyé par Zogbo.
 * Statut : en_attente (received null) → reçu (received saisi) + écart journalisé.
 */
export async function confirmGbegameyReceipt(
  input: Parameters<typeof confirmGbegameyReceiptRaw>[0],
  ...rest: Tail<Parameters<typeof confirmGbegameyReceiptRaw>>
): ReturnType<typeof confirmGbegameyReceiptRaw> {
  return withStockCarry("gbegamey", input.date, () => confirmGbegameyReceiptRaw(input, ...rest));
}

async function confirmGbegameyReceiptRaw(input: {
  date: string;
  productId: string;
  qty: number;
  note?: string;
  actor?: ReceiptActor | null;
  bypassClosedDay?: boolean;
}): Promise<GbegameyDayPayload> {
  if (!isValidDate(input.date)) {
    throw new Error("Date invalide (attendu YYYY-MM-DD)");
  }
  const qty = Math.round(Number(input.qty) || 0);
  if (!Number.isFinite(qty) || qty < 0) {
    throw new Error("Quantité reçue invalide.");
  }

  const { baseDishes, localDishes } = await getParametres();
  const openingEditable = await isOpeningDay(input.date);

  return updateDayDocument<GbegameyDoc, GbegameyDayPayload>(
    "gbegamey_jours",
    input.date,
    async (existing) => {
      if (!existing) {
        throw new Error("Journée Gbégamey introuvable — rechargez la page.");
      }
      assertDayOpen(
        existing.status ?? "ouverte",
        "Journée clôturée : réception impossible.",
        { bypass: input.bypassClosedDay },
      );

      const sentByProductId = await loadSentMap(input.date);
      const sent = sentByProductId[input.productId] ?? 0;
      if (sent <= 0 && qty <= 0) {
        throw new Error("Aucun envoi Zogbo à confirmer pour ce plat.");
      }

      const transferLines = syncTransferLines(
        (existing.transferLines ?? []).map((l) => normalizeTransferLine(l)),
        baseDishes,
      );
      const line = transferLines.find((l) => l.productId === input.productId);
      if (!line) throw new Error("Plat introuvable dans le transfert.");

      const variance = sent - qty;
      const note = String(input.note ?? "").trim().slice(0, 300);
      if (variance !== 0 && note.length < 3) {
        throw new Error(
          "Écart de transport : précisez la cause (casse, oubli, erreur de compte…).",
        );
      }

      const receipt: GbegameyReceiptMovement = {
        id: new ObjectId().toHexString(),
        at: new Date().toISOString(),
        productId: input.productId,
        name: line.name,
        qty,
        sentFromZogbo: sent,
        variance,
        note,
        actorName: input.actor?.name ?? null,
        cancelledAt: null,
      };

      const nextTransfers = transferLines.map((l) =>
        l.productId === input.productId ? { ...l, received: qty } : l,
      );
      const localLines = syncLocalLines(
        (existing.localLines ?? []).map((l) => normalizeLocalLine(l)),
        localDishes,
      );
      const receipts = [...(existing.receipts ?? []), receipt];
      const updatedAt = new Date().toISOString();
      const status = existing.status ?? "ouverte";

      return {
        set: {
          status,
          transferLines: nextTransfers,
          localLines,
          receipts,
          updatedAt,
        },
        result: {
          day: {
            date: input.date,
            status,
            transferLines: nextTransfers,
            localLines,
            receipts,
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

/** Annule une confirmation de réception (remet le constaté au précédent actif). */
export async function cancelGbegameyReceipt(
  input: Parameters<typeof cancelGbegameyReceiptRaw>[0],
  ...rest: Tail<Parameters<typeof cancelGbegameyReceiptRaw>>
): ReturnType<typeof cancelGbegameyReceiptRaw> {
  return withStockCarry("gbegamey", input.date, () => cancelGbegameyReceiptRaw(input, ...rest));
}

async function cancelGbegameyReceiptRaw(input: {
  date: string;
  receiptId: string;
  bypassClosedDay?: boolean;
}): Promise<GbegameyDayPayload> {
  if (!isValidDate(input.date)) {
    throw new Error("Date invalide (attendu YYYY-MM-DD)");
  }

  const { baseDishes, localDishes } = await getParametres();
  const openingEditable = await isOpeningDay(input.date);

  return updateDayDocument<GbegameyDoc, GbegameyDayPayload>(
    "gbegamey_jours",
    input.date,
    async (existing) => {
      if (!existing) throw new Error("Journée Gbégamey introuvable.");
      assertDayOpen(
        existing.status ?? "ouverte",
        "Journée clôturée : annulation impossible.",
        { bypass: input.bypassClosedDay },
      );

      const receipts = [...(existing.receipts ?? [])];
      const idx = receipts.findIndex((r) => r.id === input.receiptId);
      if (idx < 0) throw new Error("Réception introuvable.");
      const target = receipts[idx]!;
      if (target.cancelledAt) throw new Error("Réception déjà annulée.");

      receipts[idx] = {
        ...target,
        cancelledAt: new Date().toISOString(),
      };

      const activeForProduct = receipts
        .filter((r) => r.productId === target.productId && !r.cancelledAt)
        .sort((a, b) => a.at.localeCompare(b.at));
      const last = activeForProduct[activeForProduct.length - 1];

      const transferLines = syncTransferLines(
        (existing.transferLines ?? []).map((l) => normalizeTransferLine(l)),
        baseDishes,
      ).map((l) =>
        l.productId === target.productId
          ? { ...l, received: last ? last.qty : null }
          : l,
      );
      const localLines = syncLocalLines(
        (existing.localLines ?? []).map((l) => normalizeLocalLine(l)),
        localDishes,
      );
      const sentByProductId = await loadSentMap(input.date);
      const updatedAt = new Date().toISOString();
      const status = existing.status ?? "ouverte";

      return {
        set: {
          status,
          transferLines,
          localLines,
          receipts,
          updatedAt,
        },
        result: {
          day: {
            date: input.date,
            status,
            transferLines,
            localLines,
            receipts,
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

/**
 * Entrée de stock Gbégamey hors grille plats / accompagnements (ex. achat de
 * boissons) : active la vente selon le stock pour la journée, sauf choix
 * explicite de l'admin.
 */
export async function markGbegameyStockEntry(date: string): Promise<void> {
  const { day } = await getGbegameyDayPayload(date);
  await saveGbegameyDay({
    date,
    transferLines: day.transferLines,
    localLines: day.localLines,
    status: day.status,
    stockSaisie: true,
  });
}
