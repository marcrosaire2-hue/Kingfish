import { getDb } from "@/lib/mongodb";
import { isValidDate, updateDayDocument } from "@/lib/day-doc";
import { getParametres } from "@/lib/parametres-repo";
import type {
  BaseDish,
  GbegameyLocalLine,
  LocalDish,
  ZogboDay,
  ZogboLine,
  ZogboMovement,
  ZogboMovementType,
} from "@/lib/types";
import {
  applyZogboMovementToState,
  cancelZogboMovementInState,
  createEmptyZogboDay,
  leftoverFromZogboLines,
  LEFTOVER_LOOKBACK_DAYS,
  normalizeZogboLine,
  normalizeZogboMovement,
  previousIsoDate,
  shiftIsoDate,
  syncZogboLinesWithCatalog,
} from "@/lib/zogbo-calc";
import {
  loadAquaAlimentStocks,
  openingByProductName,
} from "@/lib/aquapro-opening-stock";

type ZogboDoc = Omit<ZogboDay, "date"> & { _id: string; rev?: number };

function normalizeAccompanimentLine(
  line: Partial<GbegameyLocalLine> & { productId: string; name: string },
): GbegameyLocalLine {
  return {
    productId: line.productId,
    name: line.name,
    initialStock: Math.max(0, Number(line.initialStock) || 0),
    prepared: Math.max(0, Number(line.prepared) || 0),
    sold: Math.max(0, Number(line.sold) || 0),
    pertes: Math.max(0, Number(line.pertes) || 0),
    counted:
      line.counted === null || line.counted === undefined
        ? null
        : Math.max(0, Number(line.counted) || 0),
    observations: String(line.observations ?? ""),
  };
}

export function syncZogboAccompanimentLines(
  lines: GbegameyLocalLine[],
  catalog: LocalDish[],
): GbegameyLocalLine[] {
  const byId = new Map(lines.map((l) => [l.productId, normalizeAccompanimentLine(l)]));
  return catalog.map(
    (d) =>
      byId.get(d.id) ?? {
        productId: d.id,
        name: d.name,
        initialStock: 0,
        prepared: 0,
        sold: 0,
        pertes: 0,
        counted: null,
        observations: "",
      },
  );
}

function toDay(doc: ZogboDoc, accompanimentLines?: GbegameyLocalLine[]): ZogboDay {
  const movements = (doc.movements ?? [])
    .map((m) => normalizeZogboMovement(m))
    .filter((m): m is ZogboMovement => !!m);
  return {
    date: doc._id,
    status: doc.status ?? "ouverte",
    lines: (doc.lines ?? []).map((l) => normalizeZogboLine(l)),
    accompanimentLines,
    movements,
    updatedAt: doc.updatedAt ?? null,
  };
}

export type ZogboDayPayload = {
  day: ZogboDay;
  baseDishes: BaseDish[];
};

/**
 * Reste à reporter : on remonte au dernier jour réellement travaillé,
 * pas seulement à la veille — sinon une journée de fermeture remet
 * tous les stocks à zéro.
 */
async function leftoversForDate(
  date: string,
  baseDishes: BaseDish[],
): Promise<Map<string, number>> {
  const prev = previousIsoDate(date);
  const floor = shiftIsoDate(date, -LEFTOVER_LOOKBACK_DAYS);
  if (prev && floor) {
    const db = await getDb();
    const prevDoc = await db
      .collection<ZogboDoc>("zogbo_jours")
      .find({ _id: { $lte: prev, $gte: floor } })
      .sort({ _id: -1 })
      .limit(1)
      .next();
    if (prevDoc?.lines?.length) {
      return leftoverFromZogboLines(
        prevDoc.lines.map((l) => normalizeZogboLine(l)),
      );
    }
  }
  try {
    const { byName } = await loadAquaAlimentStocks();
    return openingByProductName(baseDishes, byName);
  } catch {
    return new Map();
  }
}

export async function getZogboDayPayload(
  date: string,
): Promise<ZogboDayPayload> {
  if (!isValidDate(date)) {
    throw new Error("Date invalide (attendu YYYY-MM-DD)");
  }

  const { baseDishes, localDishes } = await getParametres();
  const db = await getDb();
  const col = db.collection<ZogboDoc>("zogbo_jours");
  const existing = await col.findOne({ _id: date });

  if (!existing) {
    const leftovers = await leftoversForDate(date, baseDishes);
    const day = createEmptyZogboDay(date, baseDishes, leftovers);
    if (leftovers.size > 0) {
      const updatedAt = new Date().toISOString();
      const lines = day.lines.map((l) => ({
        ...l,
        prepared: l.stock,
        counted: leftovers.has(l.productId) ? l.stock : null,
        observations: leftovers.has(l.productId)
          ? "Ouverture AquaPro (stock final)"
          : "",
      }));
      await col.updateOne(
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
      return { day: { ...day, lines, updatedAt }, baseDishes };
    }
    return { day, baseDishes };
  }

  const accompanimentLines = syncZogboAccompanimentLines(
    existing.accompanimentLines ?? [],
    localDishes,
  );
  const day = toDay(existing, accompanimentLines);
  return {
    day: {
      ...day,
      lines: syncZogboLinesWithCatalog(day.lines, baseDishes),
      accompanimentLines,
    },
    baseDishes,
  };
}

export async function saveZogboDay(
  input: {
    date: string;
    status?: ZogboDay["status"];
    lines: ZogboLine[];
    movements?: ZogboMovement[];
  },
  options?: { lockSold?: boolean; directWrite?: boolean },
): Promise<ZogboDayPayload> {
  if (!isValidDate(input.date)) {
    throw new Error("Date invalide (attendu YYYY-MM-DD)");
  }

  const lockSold = options?.lockSold !== false;
  const directWrite = options?.directWrite === true;
  const { baseDishes } = await getParametres();

  return updateDayDocument<ZogboDoc, ZogboDayPayload>(
    "zogbo_jours",
    input.date,
    async (existing) => {
      const leftovers = existing ? null : await leftoversForDate(input.date, baseDishes);

      // Les compteurs restent ceux de la base : la grille ne pilote ni le
      // stock, ni les envois, ni les ventes.
      const current = new Map(
        (existing?.lines ?? []).map((l) => [
          l.productId,
          normalizeZogboLine(l),
        ]),
      );

      const lines = syncZogboLinesWithCatalog(input.lines, baseDishes).map(
        (line) => {
          const normalized = normalizeZogboLine(line);
          if (directWrite) {
            return {
              ...normalized,
              pertes: 0,
            };
          }
          if (!existing) {
            return {
              ...normalized,
              stock: leftovers?.get(line.productId) ?? 0,
              prepared: 0,
              sentToGbegamey: 0,
              sold: lockSold ? 0 : normalized.sold,
              pertes: 0,
            };
          }
          const held = current.get(line.productId);
          return {
            ...normalized,
            stock: held?.stock ?? normalized.stock,
            prepared: held?.prepared ?? normalized.prepared,
            sentToGbegamey:
              held?.sentToGbegamey ?? normalized.sentToGbegamey,
            sold: lockSold ? (held?.sold ?? 0) : normalized.sold,
            pertes: held?.pertes ?? 0,
          };
        },
      );

      const movements = directWrite
        ? []
        : (input.movements ?? existing?.movements ?? [])
            .map((m) => normalizeZogboMovement(m))
            .filter((m): m is ZogboMovement => !!m);

      const updatedAt = new Date().toISOString();
      const status = input.status ?? "ouverte";

      return {
        set: { status, lines, movements, updatedAt },
        result: {
          day: { date: input.date, status, lines, movements, updatedAt },
          baseDishes,
        },
      };
    },
  );
}

/**
 * Applique une transformation au registre du jour sous verrou optimiste :
 * si un autre geste passe entre la lecture et l’écriture, on rejoue.
 */
async function mutateZogboDay(
  date: string,
  mutate: (day: ZogboDay) => {
    lines: ZogboLine[];
    movements: ZogboMovement[];
    movement: ZogboMovement;
  },
): Promise<ZogboDayPayload & { movement: ZogboMovement }> {
  return updateDayDocument<
    ZogboDoc,
    ZogboDayPayload & { movement: ZogboMovement }
  >("zogbo_jours", date, async () => {
    const payload = await getZogboDayPayload(date);
    const applied = mutate(payload.day);

    const updatedAt = new Date().toISOString();
    const status = payload.day.status;
    const lines = applied.lines.map((l) => normalizeZogboLine(l));
    const movements = applied.movements;

    return {
      set: { status, lines, movements, updatedAt },
      result: {
        day: { date, status, lines, movements, updatedAt },
        baseDishes: payload.baseDishes,
        movement: applied.movement,
      },
    };
  });
}

export async function applyZogboMovement(input: {
  date: string;
  productId: string;
  type: ZogboMovementType;
  qty: number;
}): Promise<ZogboDayPayload & { movement: ZogboMovement }> {
  return mutateZogboDay(input.date, (day) =>
    applyZogboMovementToState(day.lines, day.movements ?? [], {
      type: input.type,
      productId: input.productId,
      qty: input.qty,
    }),
  );
}

/**
 * Annule une préparation ou un envoi. Pour un envoi, on refuse si Gbégamey
 * a déjà vendu la marchandise — sinon on rendrait leur stock incohérent.
 */
export async function cancelZogboMovement(input: {
  date: string;
  movementId: string;
}): Promise<ZogboDayPayload & { movement: ZogboMovement }> {
  if (!isValidDate(input.date)) {
    throw new Error("Date invalide (attendu YYYY-MM-DD)");
  }

  const before = await getZogboDayPayload(input.date);
  const target = (before.day.movements ?? []).find(
    (m) => m.id === input.movementId,
  );
  if (!target) throw new Error("Mouvement introuvable");

  if (target.type === "send" && !target.cancelledAt) {
    await assertGbegameyCanGiveBack(input.date, target);
  }

  return mutateZogboDay(input.date, (day) =>
    cancelZogboMovementInState(
      day.lines,
      day.movements ?? [],
      input.movementId,
    ),
  );
}

type GbegameyTransferDoc = {
  _id: string;
  transferLines?: { productId: string; initialStock?: number; sold?: number }[];
};

async function assertGbegameyCanGiveBack(
  date: string,
  movement: ZogboMovement,
): Promise<void> {
  const db = await getDb();
  const doc = await db
    .collection<GbegameyTransferDoc>("gbegamey_jours")
    .findOne({ _id: date });
  const line = (doc?.transferLines ?? []).find(
    (l) => l.productId === movement.productId,
  );
  if (!line) return;

  const sold = Math.max(0, Number(line.sold) || 0);
  const initialStock = Math.max(0, Number(line.initialStock) || 0);

  const zogbo = await getZogboDayPayload(date);
  const sentTotal =
    zogbo.day.lines.find((l) => l.productId === movement.productId)
      ?.sentToGbegamey ?? 0;

  const remainingAfterCancel = initialStock + sentTotal - movement.qty;
  if (sold > remainingAfterCancel) {
    throw new Error(
      `Annulation impossible : Gbégamey a déjà vendu ${sold} « ${movement.name} ». ` +
        `Annulez d’abord ces ventes, ou enregistrez un nouvel envoi pour ajuster.`,
    );
  }
}

export async function listZogboDays(limit = 14): Promise<
  { date: string; status: string; updatedAt: string | null }[]
> {
  const db = await getDb();
  const col = db.collection<ZogboDoc>("zogbo_jours");
  const docs = await col
    .find({}, { projection: { status: 1, updatedAt: 1 } })
    .sort({ _id: -1 })
    .limit(limit)
    .toArray();

  return docs.map((d) => ({
    date: d._id,
    status: d.status,
    updatedAt: d.updatedAt ?? null,
  }));
}
