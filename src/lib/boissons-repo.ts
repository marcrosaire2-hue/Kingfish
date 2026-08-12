import { updateDayDocument } from "@/lib/day-doc";
import { getDb } from "@/lib/mongodb";
import { getParametres } from "@/lib/parametres-repo";
import type {
  BoissonsDay,
  BoissonsLine,
  BoissonsMovement,
  Drink,
} from "@/lib/types";
import {
  applyBoissonsPurchaseToState,
  cancelBoissonsMovementInState,
  createEmptyBoissonsDay,
  leftoverFromBoissonsLines,
  normalizeBoissonsLine,
  normalizeBoissonsMovement,
  syncBoissonsLines,
} from "@/lib/boissons-calc";
import { loadAquaBoissonOpeningCasiers } from "@/lib/aquapro-opening-stock";
import { previousIsoDate } from "@/lib/zogbo-calc";

type BoissonsDoc = Omit<BoissonsDay, "date"> & { _id: string; rev?: number };

function isValidDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

function toDay(doc: BoissonsDoc): BoissonsDay {
  const movements = (doc.movements ?? [])
    .map((m) => normalizeBoissonsMovement(m))
    .filter((m): m is BoissonsMovement => !!m);
  return {
    date: doc._id,
    status: doc.status ?? "ouverte",
    lines: (doc.lines ?? []).map((l) => normalizeBoissonsLine(l)),
    movements,
    updatedAt: doc.updatedAt ?? null,
  };
}

export type BoissonsDayPayload = {
  day: BoissonsDay;
  drinks: Drink[];
};

async function leftoversForDate(
  date: string,
  drinks: Drink[],
): Promise<Map<string, number>> {
  const prev = previousIsoDate(date);
  if (prev) {
    const db = await getDb();
    const prevDoc = await db
      .collection<BoissonsDoc>("boissons_jours")
      .find({ _id: { $lte: prev } })
      .sort({ _id: -1 })
      .limit(1)
      .next();
    if (prevDoc?.lines?.length) {
      return leftoverFromBoissonsLines(
        prevDoc.lines.map((l) => normalizeBoissonsLine(l)),
        drinks,
      );
    }
  }
  try {
    return await loadAquaBoissonOpeningCasiers(drinks);
  } catch {
    return new Map();
  }
}

export async function getBoissonsDayPayload(
  date: string,
): Promise<BoissonsDayPayload> {
  if (!isValidDate(date)) throw new Error("Date invalide (attendu YYYY-MM-DD)");

  const { drinks } = await getParametres();
  const db = await getDb();
  const existing = await db
    .collection<BoissonsDoc>("boissons_jours")
    .findOne({ _id: date });

  if (!existing) {
    const leftovers = await leftoversForDate(date, drinks);
    const day = createEmptyBoissonsDay(date, drinks, leftovers);
    if (leftovers.size > 0) {
      const updatedAt = new Date().toISOString();
      const lines = day.lines.map((l) => ({
        ...l,
        counted: leftovers.has(l.productId) ? leftovers.get(l.productId)! : null,
        observations: leftovers.has(l.productId)
          ? "Ouverture AquaPro (dernier inventaire)"
          : "",
      }));
      await db.collection<BoissonsDoc>("boissons_jours").updateOne(
        { _id: date },
        {
          $set: {
            status: "ouverte",
            lines,
            movements: [],
            updatedAt,
            source: "aquapro-opening",
          },
          $setOnInsert: { _id: date },
        },
        { upsert: true },
      );
      return { day: { ...day, lines, updatedAt }, drinks };
    }
    return { day, drinks };
  }

  const day = toDay(existing);
  return {
    day: { ...day, lines: syncBoissonsLines(day.lines, drinks) },
    drinks,
  };
}

export async function saveBoissonsDay(
  input: {
    date: string;
    status?: BoissonsDay["status"];
    lines: BoissonsLine[];
  },
  options?: { lockSold?: boolean; directWrite?: boolean },
): Promise<BoissonsDayPayload> {
  if (!isValidDate(input.date)) {
    throw new Error("Date invalide (attendu YYYY-MM-DD)");
  }

  const lockSold = options?.lockSold !== false;
  const directWrite = options?.directWrite === true;
  const { drinks } = await getParametres();

  return updateDayDocument<BoissonsDoc, BoissonsDayPayload>(
    "boissons_jours",
    input.date,
    async (existing) => {
      const leftovers = existing ? null : await leftoversForDate(input.date, drinks);

      const held = new Map(
        (existing?.lines ?? []).map((l) => [
          l.productId,
          normalizeBoissonsLine(l),
        ]),
      );

      const movements = directWrite
        ? []
        : (existing?.movements ?? [])
            .map((m) => normalizeBoissonsMovement(m))
            .filter((m): m is BoissonsMovement => !!m);

      const lines = syncBoissonsLines(input.lines, drinks).map((line) => {
        const normalized = normalizeBoissonsLine(line);
        if (directWrite) {
          return {
            ...normalized,
            pertes: 0,
          };
        }
        const prev = held.get(line.productId);
        const initialStock = existing
          ? (prev?.initialStock ?? 0)
          : (leftovers?.get(line.productId) ?? 0);
        const purchases = prev?.purchases ?? 0;
        return {
          productId: line.productId,
          name: line.name,
          initialStock,
          purchases,
          soldZogbo: lockSold
            ? (prev?.soldZogbo ?? 0)
            : Math.max(0, Number(line.soldZogbo) || 0),
          soldGbegamey: lockSold
            ? (prev?.soldGbegamey ?? 0)
            : Math.max(0, Number(line.soldGbegamey) || 0),
          pertes: prev?.pertes ?? 0,
          counted: line.counted,
          observations: String(line.observations ?? ""),
        };
      });

      const updatedAt = new Date().toISOString();
      const status = input.status ?? "ouverte";

      return {
        set: { status, lines, movements, updatedAt },
        result: {
          day: { date: input.date, status, lines, movements, updatedAt },
          drinks,
        },
      };
    },
  );
}

export async function applyBoissonsPurchase(input: {
  date: string;
  productId: string;
  qty: number;
}): Promise<BoissonsDayPayload & { movement: BoissonsMovement }> {
  if (!isValidDate(input.date)) throw new Error("Date invalide");
  const payload = await getBoissonsDayPayload(input.date);
  const drink = payload.drinks.find((d) => d.id === input.productId);
  const applied = applyBoissonsPurchaseToState(
    payload.day.lines,
    payload.day.movements ?? [],
    {
      productId: input.productId,
      qty: input.qty,
      unitsPerCasier: drink?.unitsPerCasier,
    },
  );

  const db = await getDb();
  const updatedAt = new Date().toISOString();
  const status = payload.day.status;
  await db.collection<BoissonsDoc>("boissons_jours").updateOne(
    { _id: input.date },
    {
      $set: {
        status,
        lines: applied.lines,
        movements: applied.movements,
        updatedAt,
      },
      $setOnInsert: { _id: input.date },
    },
    { upsert: true },
  );

  return {
    day: {
      date: input.date,
      status,
      lines: syncBoissonsLines(applied.lines, payload.drinks),
      movements: applied.movements,
      updatedAt,
    },
    drinks: payload.drinks,
    movement: applied.movement,
  };
}

export async function cancelBoissonsMovement(input: {
  date: string;
  movementId: string;
}): Promise<BoissonsDayPayload & { movement: BoissonsMovement }> {
  if (!isValidDate(input.date)) throw new Error("Date invalide");
  const payload = await getBoissonsDayPayload(input.date);
  const target = (payload.day.movements ?? []).find(
    (m) => m.id === input.movementId,
  );
  const drink = target
    ? payload.drinks.find((d) => d.id === target.productId)
    : undefined;
  const cancelled = cancelBoissonsMovementInState(
    payload.day.lines,
    payload.day.movements ?? [],
    input.movementId,
    drink?.unitsPerCasier,
  );

  const db = await getDb();
  const updatedAt = new Date().toISOString();
  const status = payload.day.status;
  await db.collection<BoissonsDoc>("boissons_jours").updateOne(
    { _id: input.date },
    {
      $set: {
        status,
        lines: cancelled.lines,
        movements: cancelled.movements,
        updatedAt,
      },
    },
  );

  return {
    day: {
      date: input.date,
      status,
      lines: syncBoissonsLines(cancelled.lines, payload.drinks),
      movements: cancelled.movements,
      updatedAt,
    },
    drinks: payload.drinks,
    movement: cancelled.movement,
  };
}
