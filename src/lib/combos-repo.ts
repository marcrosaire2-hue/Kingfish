import { updateDayDocument } from "@/lib/day-doc";
import { getDb } from "@/lib/mongodb";
import { getParametres } from "@/lib/parametres-repo";
import type {
  ComboDish,
  CombosDay,
  CombosLine,
  CombosMovement,
  CombosMovementType,
} from "@/lib/types";
import {
  applyCombosMovementToState,
  cancelCombosMovementInState,
  createEmptyCombosDay,
  leftoverFromCombosLines,
  normalizeCombosLine,
  normalizeCombosMovement,
  previousIsoDate,
  syncCombosLines,
} from "@/lib/combos-calc";
import { LEFTOVER_LOOKBACK_DAYS, shiftIsoDate } from "@/lib/zogbo-calc";

type CombosDoc = Omit<CombosDay, "date"> & { _id: string; rev?: number };

function isValidDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

function toDay(doc: CombosDoc): CombosDay {
  const movements = (doc.movements ?? [])
    .map((m) => normalizeCombosMovement(m))
    .filter((m): m is CombosMovement => !!m);
  return {
    date: doc._id,
    status: doc.status ?? "ouverte",
    lines: (doc.lines ?? []).map((l) => normalizeCombosLine(l)),
    movements,
    updatedAt: doc.updatedAt ?? null,
  };
}

export type CombosDayPayload = {
  day: CombosDay;
  combos: ComboDish[];
};

async function leftoversForDate(date: string): Promise<{
  zogbo: Map<string, number>;
  gbegamey: Map<string, number>;
}> {
  const prev = previousIsoDate(date);
  const floor = shiftIsoDate(date, -LEFTOVER_LOOKBACK_DAYS);
  if (!prev || !floor) return { zogbo: new Map(), gbegamey: new Map() };
  const db = await getDb();
  const prevDoc = await db
    .collection<CombosDoc>("combos_jours")
    .find({ _id: { $lte: prev, $gte: floor } })
    .sort({ _id: -1 })
    .limit(1)
    .next();
  if (!prevDoc?.lines?.length) return { zogbo: new Map(), gbegamey: new Map() };
  return leftoverFromCombosLines(
    prevDoc.lines.map((l) => normalizeCombosLine(l)),
  );
}

export async function getCombosDayPayload(
  date: string,
): Promise<CombosDayPayload> {
  if (!isValidDate(date)) throw new Error("Date invalide (attendu YYYY-MM-DD)");

  const { combos } = await getParametres();
  const db = await getDb();
  const existing = await db
    .collection<CombosDoc>("combos_jours")
    .findOne({ _id: date });

  if (!existing) {
    const leftovers = await leftoversForDate(date);
    return { day: createEmptyCombosDay(date, combos, leftovers), combos };
  }

  const day = toDay(existing);
  return {
    day: { ...day, lines: syncCombosLines(day.lines, combos) },
    combos,
  };
}

export async function saveCombosDay(
  input: {
    date: string;
    status?: CombosDay["status"];
    lines: CombosLine[];
  },
  options?: { lockSold?: boolean; directWrite?: boolean },
): Promise<CombosDayPayload> {
  if (!isValidDate(input.date)) {
    throw new Error("Date invalide (attendu YYYY-MM-DD)");
  }

  const lockSold = options?.lockSold !== false;
  const directWrite = options?.directWrite === true;
  const { combos } = await getParametres();

  return updateDayDocument<CombosDoc, CombosDayPayload>(
    "combos_jours",
    input.date,
    async (existing) => {
      const leftovers = existing ? null : await leftoversForDate(input.date);
      const held = new Map(
        (existing?.lines ?? []).map((l) => [
          l.productId,
          normalizeCombosLine(l),
        ]),
      );
      const movements = directWrite
        ? []
        : (existing?.movements ?? [])
            .map((m) => normalizeCombosMovement(m))
            .filter((m): m is CombosMovement => !!m);

      const lines = syncCombosLines(input.lines, combos).map((line) => {
        const normalized = normalizeCombosLine(line);
        if (directWrite) {
          return {
            ...normalized,
            pertesZogbo: 0,
            pertesGbegamey: 0,
          };
        }
        const prev = held.get(line.productId);
        return {
          productId: line.productId,
          name: line.name,
          baseDishName: line.baseDishName,
          stockZogbo: existing
            ? (prev?.stockZogbo ?? 0)
            : (leftovers?.zogbo.get(line.productId) ?? 0),
          prepared: prev?.prepared ?? 0,
          sentToGbegamey: prev?.sentToGbegamey ?? 0,
          soldZogbo: lockSold
            ? (prev?.soldZogbo ?? 0)
            : Math.max(0, Number(line.soldZogbo) || 0),
          pertesZogbo: prev?.pertesZogbo ?? 0,
          countedZogbo: line.countedZogbo,
          initialGbegamey: existing
            ? (prev?.initialGbegamey ?? 0)
            : (leftovers?.gbegamey.get(line.productId) ?? 0),
          soldGbegamey: lockSold
            ? (prev?.soldGbegamey ?? 0)
            : Math.max(0, Number(line.soldGbegamey) || 0),
          pertesGbegamey: prev?.pertesGbegamey ?? 0,
          countedGbegamey: line.countedGbegamey,
          observations: String(line.observations ?? ""),
        };
      });

      const updatedAt = new Date().toISOString();
      const status = input.status ?? "ouverte";

      return {
        set: { status, lines, movements, updatedAt },
        result: {
          day: { date: input.date, status, lines, movements, updatedAt },
          combos,
        },
      };
    },
  );
}

export async function applyCombosMovement(input: {
  date: string;
  productId: string;
  type: CombosMovementType;
  qty: number;
}): Promise<CombosDayPayload & { movement: CombosMovement }> {
  if (!isValidDate(input.date)) throw new Error("Date invalide");
  const payload = await getCombosDayPayload(input.date);
  const applied = applyCombosMovementToState(
    payload.day.lines,
    payload.day.movements ?? [],
    {
      type: input.type,
      productId: input.productId,
      qty: input.qty,
    },
  );

  const db = await getDb();
  const updatedAt = new Date().toISOString();
  const status = payload.day.status;
  await db.collection<CombosDoc>("combos_jours").updateOne(
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
      lines: syncCombosLines(applied.lines, payload.combos),
      movements: applied.movements,
      updatedAt,
    },
    combos: payload.combos,
    movement: applied.movement,
  };
}

export async function cancelCombosMovement(input: {
  date: string;
  movementId: string;
}): Promise<CombosDayPayload & { movement: CombosMovement }> {
  if (!isValidDate(input.date)) throw new Error("Date invalide");
  const payload = await getCombosDayPayload(input.date);
  const cancelled = cancelCombosMovementInState(
    payload.day.lines,
    payload.day.movements ?? [],
    input.movementId,
  );

  const db = await getDb();
  const updatedAt = new Date().toISOString();
  const status = payload.day.status;
  await db.collection<CombosDoc>("combos_jours").updateOne(
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
      lines: syncCombosLines(cancelled.lines, payload.combos),
      movements: cancelled.movements,
      updatedAt,
    },
    combos: payload.combos,
    movement: cancelled.movement,
  };
}
