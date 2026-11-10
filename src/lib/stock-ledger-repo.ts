import { ObjectId, type Filter } from "mongodb";
import { getDb } from "@/lib/mongodb";
import {
  applyStockEvents,
  assertStockEvent,
  type StockBalance,
  type StockEvent,
  type StockLedgerFamily,
} from "@/lib/stock-ledger";
import type { VenteSite } from "@/lib/types";

export const STOCK_EVENTS_COLLECTION = "stock_events";

type StockEventDoc = Omit<StockEvent, "id"> & { _id: ObjectId };

type StockEventQuery = {
  site: VenteSite;
  family?: StockLedgerFamily;
  productId?: string;
  /** Borne basse incluse sur le jour de service (YYYY-MM-DD). */
  from?: string | null;
  /** Borne haute incluse sur le jour de service (YYYY-MM-DD). */
  to?: string | null;
};

function toDoc(event: StockEvent): Omit<StockEventDoc, "_id"> {
  return {
    site: event.site,
    family: event.family,
    productId: event.productId,
    name: event.name,
    type: event.type,
    qty: event.qty,
    unit: event.unit,
    at: event.at,
    date: event.date,
    actorId: event.actorId ?? null,
    source: event.source ?? null,
    idempotencyKey: event.idempotencyKey,
  };
}

function fromDoc(doc: StockEventDoc): StockEvent {
  return {
    id: doc._id.toHexString(),
    site: doc.site,
    family: doc.family,
    productId: doc.productId,
    name: doc.name,
    type: doc.type,
    qty: doc.qty,
    unit: doc.unit,
    at: doc.at,
    date: doc.date,
    actorId: doc.actorId ?? null,
    source: doc.source ?? null,
    idempotencyKey: doc.idempotencyKey,
  };
}

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: number }).code === 11000
  );
}

/**
 * Ajoute des événements sans jamais doubler : la clé d'idempotence est unique
 * par site. Rejouer un import, un rejeu réseau ou une reprise ne crée pas de
 * mouvement supplémentaire.
 */
export async function appendStockEvents(
  events: readonly StockEvent[],
): Promise<{ inserted: number; skipped: number }> {
  if (events.length === 0) return { inserted: 0, skipped: 0 };
  for (const event of events) assertStockEvent(event);

  const db = await getDb();
  const col = db.collection<StockEventDoc>(STOCK_EVENTS_COLLECTION);

  const ops = events.map((event) => ({
    updateOne: {
      filter: {
        site: event.site,
        idempotencyKey: event.idempotencyKey,
      } as Filter<StockEventDoc>,
      update: { $setOnInsert: toDoc(event) },
      upsert: true,
    },
  }));

  try {
    const result = await col.bulkWrite(ops, { ordered: false });
    const inserted = result.upsertedCount;
    return { inserted, skipped: events.length - inserted };
  } catch (error) {
    // Deux écritures concurrentes avec la même clé : la seconde est ignorée.
    if (!isDuplicateKey(error)) throw error;
    return { inserted: 0, skipped: events.length };
  }
}

export async function readStockEvents(
  query: StockEventQuery,
): Promise<StockEvent[]> {
  const db = await getDb();
  const filter: Filter<StockEventDoc> = { site: query.site };
  if (query.family) filter.family = query.family;
  if (query.productId) filter.productId = query.productId;
  if (query.from || query.to) {
    filter.date = {
      ...(query.from ? { $gte: query.from } : {}),
      ...(query.to ? { $lte: query.to } : {}),
    };
  }
  const docs = await db
    .collection<StockEventDoc>(STOCK_EVENTS_COLLECTION)
    .find(filter)
    .sort({ at: 1, _id: 1 })
    .toArray();
  return docs.map(fromDoc);
}

/** Solde courant d'un site, recalculé depuis le journal (aucun solde stocké). */
export async function getStockBalances(query: {
  site: VenteSite;
  family?: StockLedgerFamily;
  /** Ne prendre en compte que les événements jusqu'à cet instant ISO. */
  asOf?: string | null;
}): Promise<StockBalance[]> {
  const events = await readStockEvents({ site: query.site, family: query.family });
  return [...applyStockEvents(events, { at: query.asOf ?? null }).values()];
}

/** Solde courant d'un produit précis. */
export async function getStockBalance(input: {
  site: VenteSite;
  family: StockLedgerFamily;
  productId: string;
  asOf?: string | null;
}): Promise<StockBalance | null> {
  const events = await readStockEvents({
    site: input.site,
    family: input.family,
    productId: input.productId,
  });
  const balances = applyStockEvents(events, { at: input.asOf ?? null });
  return balances.get(`${input.site}:${input.family}:${input.productId}`) ?? null;
}
