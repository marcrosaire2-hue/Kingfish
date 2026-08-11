import { updateDayDocument } from "@/lib/day-doc";
import { getDb } from "@/lib/mongodb";
import { getParametres } from "@/lib/parametres-repo";
import {
  applyMatieresPurchaseToState,
  cancelMatieresMovementInState,
  createEmptyMatieresDay,
  leftoverFromMatieresLines,
  normalizeMatieresLine,
  normalizeMatieresMovement,
  syncMatieresLines,
} from "@/lib/matieres-calc";
import {
  loadAquaAlimentStocks,
  openingForMaterials,
} from "@/lib/aquapro-opening-stock";
import type {
  MatieresDay,
  MatieresLine,
  MatieresMovement,
  RawMaterial,
} from "@/lib/types";
import { previousIsoDate } from "@/lib/zogbo-calc";

type MatieresDoc = Omit<MatieresDay, "date"> & { _id: string; rev?: number };

function isValidDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

function toDay(doc: MatieresDoc): MatieresDay {
  const movements = (doc.movements ?? [])
    .map((m) => normalizeMatieresMovement(m))
    .filter((m): m is MatieresMovement => !!m);
  return {
    date: doc._id,
    status: doc.status ?? "ouverte",
    lines: (doc.lines ?? []).map((l) => normalizeMatieresLine(l)),
    movements,
    updatedAt: doc.updatedAt ?? null,
  };
}

export type MatieresDayPayload = {
  day: MatieresDay;
  materials: RawMaterial[];
};

async function leftoversForDate(
  date: string,
  materials: RawMaterial[],
): Promise<Map<string, number>> {
  const prev = previousIsoDate(date);
  if (prev) {
    const db = await getDb();
    const prevDoc = await db
      .collection<MatieresDoc>("matieres_jours")
      .find({ _id: { $lte: prev } })
      .sort({ _id: -1 })
      .limit(1)
      .next();
    if (prevDoc?.lines?.length) {
      return leftoverFromMatieresLines(
        prevDoc.lines.map((l) => normalizeMatieresLine(l)),
      );
    }
  }
  // Cutover : stock final AquaPro si aucune journée King Fish
  try {
    const stocks = await loadAquaAlimentStocks();
    return openingForMaterials(materials, stocks);
  } catch {
    return new Map();
  }
}

export async function getMatieresDayPayload(
  date: string,
): Promise<MatieresDayPayload> {
  if (!isValidDate(date)) throw new Error("Date invalide (attendu YYYY-MM-DD)");

  const { rawMaterials = [] } = await getParametres();
  const db = await getDb();
  const existing = await db
    .collection<MatieresDoc>("matieres_jours")
    .findOne({ _id: date });

  if (!existing) {
    const leftovers = await leftoversForDate(date, rawMaterials);
    const day = createEmptyMatieresDay(date, rawMaterials, leftovers);
    // Persiste l’ouverture AquaPro pour que le stock reste géré dans le site
    if (leftovers.size > 0) {
      const updatedAt = new Date().toISOString();
      const lines = day.lines.map((l) => ({
        ...l,
        counted: leftovers.has(l.productId) ? leftovers.get(l.productId)! : null,
        observations: leftovers.has(l.productId)
          ? "Ouverture AquaPro (stock final)"
          : "",
      }));
      await db.collection<MatieresDoc>("matieres_jours").updateOne(
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
      return {
        day: { ...day, lines, updatedAt },
        materials: rawMaterials,
      };
    }
    return { day, materials: rawMaterials };
  }

  const day = toDay(existing);
  return {
    day: { ...day, lines: syncMatieresLines(day.lines, rawMaterials) },
    materials: rawMaterials,
  };
}

export async function saveMatieresDay(input: {
  date: string;
  status?: MatieresDay["status"];
  lines: MatieresLine[];
}): Promise<MatieresDayPayload> {
  if (!isValidDate(input.date)) {
    throw new Error("Date invalide (attendu YYYY-MM-DD)");
  }

  const { rawMaterials = [] } = await getParametres();

  return updateDayDocument<MatieresDoc, MatieresDayPayload>(
    "matieres_jours",
    input.date,
    async (existing) => {
      const leftovers = existing ? null : await leftoversForDate(input.date, rawMaterials);
      const held = new Map(
        (existing?.lines ?? []).map((l) => [
          l.productId,
          normalizeMatieresLine(l),
        ]),
      );
      const movements = (existing?.movements ?? [])
        .map((m) => normalizeMatieresMovement(m))
        .filter((m): m is MatieresMovement => !!m);

      const lines = syncMatieresLines(input.lines, rawMaterials).map((line) => {
        const prev = held.get(line.productId);
        const initialStock = existing
          ? (prev?.initialStock ?? 0)
          : (leftovers?.get(line.productId) ?? 0);
        const purchases = prev?.purchases ?? 0;
        const consumed = prev?.consumed ?? 0;
        return {
          productId: line.productId,
          name: line.name,
          initialStock,
          purchases,
          consumed,
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
          materials: rawMaterials,
        },
      };
    },
  );
}

export async function applyMatieresPurchase(input: {
  date: string;
  productId: string;
  qty: number;
  unitPrice?: number;
}): Promise<MatieresDayPayload & { movement: MatieresMovement }> {
  if (!isValidDate(input.date)) throw new Error("Date invalide");
  const payload = await getMatieresDayPayload(input.date);
  const mat = payload.materials.find((m) => m.id === input.productId);
  const applied = applyMatieresPurchaseToState(
    payload.day.lines,
    payload.day.movements ?? [],
    {
      productId: input.productId,
      qty: input.qty,
      unitPrice: input.unitPrice ?? mat?.purchasePrice ?? 0,
    },
  );

  const db = await getDb();
  const updatedAt = new Date().toISOString();
  const status = payload.day.status;
  await db.collection<MatieresDoc>("matieres_jours").updateOne(
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
      lines: syncMatieresLines(applied.lines, payload.materials),
      movements: applied.movements,
      updatedAt,
    },
    materials: payload.materials,
    movement: applied.movement,
  };
}

export async function cancelMatieresMovement(input: {
  date: string;
  movementId: string;
}): Promise<MatieresDayPayload> {
  if (!isValidDate(input.date)) throw new Error("Date invalide");
  const payload = await getMatieresDayPayload(input.date);
  const applied = cancelMatieresMovementInState(
    payload.day.lines,
    payload.day.movements ?? [],
    input.movementId,
  );

  const db = await getDb();
  const updatedAt = new Date().toISOString();
  const status = payload.day.status;
  await db.collection<MatieresDoc>("matieres_jours").updateOne(
    { _id: input.date },
    {
      $set: {
        status,
        lines: applied.lines,
        movements: applied.movements,
        updatedAt,
      },
    },
  );

  return {
    day: {
      date: input.date,
      status,
      lines: syncMatieresLines(applied.lines, payload.materials),
      movements: applied.movements,
      updatedAt,
    },
    materials: payload.materials,
  };
}
