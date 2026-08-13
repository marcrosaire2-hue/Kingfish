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
  leftoverMapHasStock,
  LEFTOVER_LOOKBACK_DAYS,
  normalizeZogboLine,
  normalizeZogboMovement,
  previousIsoDate,
  shiftIsoDate,
  syncZogboLinesWithCatalog,
  zogboDayHasCarryStock,
} from "@/lib/zogbo-calc";
import {
  leftoverFromLocalLines,
} from "@/lib/gbegamey-calc";
import {
  loadAquaAlimentStocks,
  openingByProductName,
} from "@/lib/aquapro-opening-stock";

type ZogboDoc = Omit<ZogboDay, "date"> & {
  _id: string;
  rev?: number;
  source?: string;
};

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
 * Reste à reporter : on remonte au dernier jour avec un stock réel
 * (comptage ou théorique), en ignorant les journées vides auto-créées
 * (aquapro-opening à zéro) qui sinon casseraient la chaîne.
 * Inclut les accompagnements Zogbo (ex. Attasi).
 */
async function leftoversForDate(
  date: string,
  baseDishes: BaseDish[],
  localDishes: LocalDish[],
): Promise<{
  lines: Map<string, number>;
  accompaniment: Map<string, number>;
}> {
  const prev = previousIsoDate(date);
  const floor = shiftIsoDate(date, -LEFTOVER_LOOKBACK_DAYS);
  if (prev && floor) {
    const db = await getDb();
    const docs = await db
      .collection<ZogboDoc>("zogbo_jours")
      .find({ _id: { $lte: prev, $gte: floor } })
      .sort({ _id: -1 })
      .toArray();

    for (const prevDoc of docs) {
      const useCounted = prevDoc.status === "cloturee";
      const lines = leftoverFromZogboLines(
        (prevDoc.lines ?? []).map((l) => normalizeZogboLine(l)),
        { useCounted },
      );
      const accompaniment = leftoverFromLocalLines(
        (prevDoc.accompanimentLines ?? []).map((l) =>
          normalizeAccompanimentLine(l),
        ),
      );
      if (
        leftoverMapHasStock(lines) ||
        leftoverMapHasStock(accompaniment)
      ) {
        return { lines, accompaniment };
      }
    }
  }
  try {
    const { byName } = await loadAquaAlimentStocks();
    return {
      lines: openingByProductName(baseDishes, byName),
      accompaniment: openingByProductName(localDishes, byName),
    };
  } catch {
    return { lines: new Map(), accompaniment: new Map() };
  }
}

function buildAccompanimentOpening(
  localDishes: LocalDish[],
  leftovers: Map<string, number>,
): GbegameyLocalLine[] {
  return localDishes.map((d) => {
    const opening = leftovers.get(d.id) ?? 0;
    return {
      productId: d.id,
      name: d.name,
      initialStock: opening,
      prepared: 0,
      sold: 0,
      pertes: 0,
      // Non signé : le report du lendemain utilisera le théorique (init − vendu).
      counted: null,
      observations:
        opening > 0 ? "Report stock veille (non inventorié)" : "",
    };
  });
}

function applyLineOpenings(
  baseDishes: BaseDish[],
  leftovers: Map<string, number>,
): ZogboLine[] {
  return createEmptyZogboDay("tmp", baseDishes, leftovers).lines.map((l) => ({
    ...l,
    prepared: 0,
    counted: null,
    observations:
      (leftovers.get(l.productId) ?? 0) > 0
        ? "Report stock veille (non inventorié)"
        : "",
  }));
}

function accompanimentHasCarryStock(lines: GbegameyLocalLine[]): boolean {
  return leftoverMapHasStock(leftoverFromLocalLines(lines));
}

function zogboDocNeedsStockHeal(doc: ZogboDoc): boolean {
  const lines = (doc.lines ?? []).map((l) => normalizeZogboLine(l));
  const acc = (doc.accompanimentLines ?? []).map((l) =>
    normalizeAccompanimentLine(l),
  );
  const empty =
    !zogboDayHasCarryStock(lines) && !accompanimentHasCarryStock(acc);
  // Journée déjà travaillée (ventes / envois) : ne pas écraser.
  const worked = lines.some(
    (l) => l.sold > 0 || l.sentToGbegamey > 0 || l.prepared > 0,
  );
  const accWorked = acc.some((l) => l.sold > 0 || l.prepared > 0);
  if (worked || accWorked || doc.status === "cloturee") return false;
  if (empty) return true;
  // Journée « ouverture AquaPro » non travaillée : le seed ne remplit que les
  // désignations qui matchent ; les autres produits resteraient « épuisés » à
  // tort — le report du dernier stock réel reprend la main.
  if (doc.source !== "aquapro-opening") return false;
  const observations = [...lines, ...acc].map((l) => l.observations ?? "");
  return observations.every(
    // « Ouverture » couvre les anciennes notes (« Ouverture AquaPro… ») et
    // les nouvelles (« Ouverture (…) »).
    (o) => o === "" || o.startsWith("Ouverture"),
  );
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

  const materializeFromLeftovers = async (source: string) => {
    const leftovers = await leftoversForDate(date, baseDishes, localDishes);
    const has =
      leftoverMapHasStock(leftovers.lines) ||
      leftoverMapHasStock(leftovers.accompaniment);
    if (!has) return null;

    const updatedAt = new Date().toISOString();
    const lines = applyLineOpenings(baseDishes, leftovers.lines);
    const accompanimentLines = buildAccompanimentOpening(
      localDishes,
      leftovers.accompaniment,
    );
    await col.updateOne(
      { _id: date },
      {
        $set: {
          status: existing?.status ?? "ouverte",
          lines,
          accompanimentLines,
          movements: existing?.movements ?? [],
          updatedAt,
          source,
        },
        $setOnInsert: { _id: date },
      },
      { upsert: true },
    );
    return {
      day: {
        date,
        status: (existing?.status ?? "ouverte") as ZogboDay["status"],
        lines,
        accompanimentLines,
        movements: (existing?.movements ?? [])
          .map((m) => normalizeZogboMovement(m))
          .filter((m): m is ZogboMovement => !!m),
        updatedAt,
      },
      baseDishes,
    };
  };

  if (!existing) {
    const created = await materializeFromLeftovers("stock-report");
    if (created) return created;
    const day = createEmptyZogboDay(date, baseDishes);
    return {
      day: {
        ...day,
        accompanimentLines: syncZogboAccompanimentLines([], localDishes),
      },
      baseDishes,
    };
  }

  if (zogboDocNeedsStockHeal(existing)) {
    const healed = await materializeFromLeftovers("stock-report");
    if (healed) return healed;
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
  const { baseDishes, localDishes } = await getParametres();

  return updateDayDocument<ZogboDoc, ZogboDayPayload>(
    "zogbo_jours",
    input.date,
    async (existing) => {
      const leftovers = existing
        ? null
        : await leftoversForDate(input.date, baseDishes, localDishes);

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
              stock: leftovers?.lines.get(line.productId) ?? 0,
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
