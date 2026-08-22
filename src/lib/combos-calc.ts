import type {
  ComboDish,
  CombosDay,
  CombosLine,
  CombosLineComputed,
  CombosMovement,
  CombosMovementType,
} from "@/lib/types";
import { newId } from "@/lib/format";
import { previousIsoDate } from "@/lib/zogbo-calc";

type LegacyCombosLine = Partial<CombosLine> & {
  productId: string;
  name: string;
};

export function emptyCombosLine(
  combo: ComboDish,
  opening?: { stockZogbo?: number; initialGbegamey?: number },
): CombosLine {
  return {
    productId: combo.id,
    name: combo.name,
    baseDishName: combo.baseDishName,
    stockZogbo: Math.max(0, opening?.stockZogbo ?? 0),
    prepared: 0,
    sentToGbegamey: 0,
    soldZogbo: 0,
    pertesZogbo: 0,
    countedZogbo: null,
    initialGbegamey: Math.max(0, opening?.initialGbegamey ?? 0),
    soldGbegamey: 0,
    pertesGbegamey: 0,
    countedGbegamey: null,
    observations: "",
  };
}

export function normalizeCombosLine(line: LegacyCombosLine): CombosLine {
  return {
    productId: line.productId,
    name: line.name,
    baseDishName: line.baseDishName ?? null,
    stockZogbo: Math.max(0, Number(line.stockZogbo) || 0),
    prepared: Math.max(0, Number(line.prepared) || 0),
    sentToGbegamey: Math.max(0, Number(line.sentToGbegamey) || 0),
    soldZogbo: Math.max(0, Number(line.soldZogbo) || 0),
    pertesZogbo: Math.max(0, Number(line.pertesZogbo) || 0),
    countedZogbo:
      line.countedZogbo === null || line.countedZogbo === undefined
        ? null
        : Math.max(0, Number(line.countedZogbo) || 0),
    initialGbegamey: Math.max(0, Number(line.initialGbegamey) || 0),
    soldGbegamey: Math.max(0, Number(line.soldGbegamey) || 0),
    pertesGbegamey: Math.max(0, Number(line.pertesGbegamey) || 0),
    countedGbegamey:
      line.countedGbegamey === null || line.countedGbegamey === undefined
        ? null
        : Math.max(0, Number(line.countedGbegamey) || 0),
    observations: String(line.observations ?? ""),
  };
}

export function normalizeCombosMovement(
  m: Partial<CombosMovement> & {
    id?: string;
    type?: string;
    productId?: string;
    name?: string;
  },
): CombosMovement | null {
  if (!m.id || !m.productId || !m.type) return null;
  if (m.type !== "prepare" && m.type !== "send") return null;
  return {
    id: m.id,
    at: m.at || new Date().toISOString(),
    type: m.type,
    productId: m.productId,
    name: String(m.name ?? ""),
    qty: Math.max(0, Number(m.qty) || 0),
    stockAfter: Math.max(0, Number(m.stockAfter) || 0),
    cancelledAt: m.cancelledAt ?? null,
  };
}

export function movementTypeLabelCombos(type: CombosMovementType): string {
  return type === "prepare" ? "Préparé (entrée)" : "Envoi Gbégamey";
}

export function syncCombosLines(
  lines: CombosLine[],
  combos: ComboDish[],
): CombosLine[] {
  const byId = new Map(
    lines.map((l) => [l.productId, normalizeCombosLine(l)]),
  );
  return combos.map((combo) => {
    const existing = byId.get(combo.id);
    if (!existing) return emptyCombosLine(combo);
    return {
      ...existing,
      name: combo.name,
      baseDishName: combo.baseDishName,
    };
  });
}

export function createEmptyCombosDay(
  date: string,
  combos: ComboDish[],
  leftovers?: {
    zogbo?: Map<string, number> | Record<string, number>;
    gbegamey?: Map<string, number> | Record<string, number>;
  },
): CombosDay {
  const zogboMap =
    leftovers?.zogbo instanceof Map
      ? leftovers.zogbo
      : new Map(Object.entries(leftovers?.zogbo ?? {}));
  const gbeMap =
    leftovers?.gbegamey instanceof Map
      ? leftovers.gbegamey
      : new Map(Object.entries(leftovers?.gbegamey ?? {}));

  return {
    date,
    status: "ouverte",
    lines: combos.map((c) =>
      emptyCombosLine(c, {
        stockZogbo: zogboMap.get(c.id) ?? 0,
        initialGbegamey: gbeMap.get(c.id) ?? 0,
      }),
    ),
    movements: [],
    updatedAt: null,
  };
}

export function physicalComboStockZogbo(
  line: Pick<CombosLine, "stockZogbo" | "soldZogbo"> & { pertesZogbo?: number },
): number {
  return (
    line.stockZogbo -
    line.soldZogbo -
    Math.max(0, Number(line.pertesZogbo) || 0)
  );
}

export function physicalComboStockGbegamey(
  line: Pick<
    CombosLine,
    "initialGbegamey" | "sentToGbegamey" | "soldGbegamey"
  > & { pertesGbegamey?: number },
): number {
  return (
    line.initialGbegamey +
    line.sentToGbegamey -
    line.soldGbegamey -
    Math.max(0, Number(line.pertesGbegamey) || 0)
  );
}

export function computeCombosLine(
  line: CombosLine,
  unitPrice: number,
): CombosLineComputed {
  const normalized = normalizeCombosLine(line);
  const receivedGbegamey = normalized.sentToGbegamey;
  const availableZogbo = normalized.stockZogbo;
  const availableGbegamey =
    normalized.initialGbegamey + normalized.sentToGbegamey;
  const stockActuelZogbo = physicalComboStockZogbo(normalized);
  const stockActuelGbegamey = physicalComboStockGbegamey(normalized);
  const soldTotal = normalized.soldZogbo + normalized.soldGbegamey;
  const varianceZogbo =
    normalized.countedZogbo === null
      ? null
      : stockActuelZogbo - normalized.countedZogbo;
  const varianceGbegamey =
    normalized.countedGbegamey === null
      ? null
      : stockActuelGbegamey - normalized.countedGbegamey;

  return {
    ...normalized,
    unitPrice,
    receivedGbegamey,
    availableZogbo,
    availableGbegamey,
    stockActuelZogbo,
    stockActuelGbegamey,
    soldTotal,
    soldAmount: soldTotal * unitPrice,
    soldAmountZogbo: normalized.soldZogbo * unitPrice,
    soldAmountGbegamey: normalized.soldGbegamey * unitPrice,
    varianceZogbo,
    varianceGbegamey,
  };
}

export function leftoverFromCombosLines(lines: CombosLine[]): {
  zogbo: Map<string, number>;
  gbegamey: Map<string, number>;
} {
  const zogbo = new Map<string, number>();
  const gbegamey = new Map<string, number>();
  for (const line of lines) {
    const c = computeCombosLine(line, 0);
    zogbo.set(
      line.productId,
      c.countedZogbo !== null
        ? c.countedZogbo
        : Math.max(0, c.stockActuelZogbo),
    );
    gbegamey.set(
      line.productId,
      c.countedGbegamey !== null
        ? c.countedGbegamey
        : Math.max(0, c.stockActuelGbegamey),
    );
  }
  return { zogbo, gbegamey };
}

export function applyCombosMovementToState(
  lines: CombosLine[],
  movements: CombosMovement[],
  input: {
    type: CombosMovementType;
    productId: string;
    qty: number;
  },
): {
  lines: CombosLine[];
  movements: CombosMovement[];
  movement: CombosMovement;
} {
  const qty = Math.max(0, Math.round(Number(input.qty) || 0));
  if (qty <= 0) throw new Error("Quantité invalide");

  const idx = lines.findIndex((l) => l.productId === input.productId);
  if (idx < 0) throw new Error("Formule introuvable");

  const line = normalizeCombosLine(lines[idx]!);
  let nextStock = line.stockZogbo;
  let prepared = line.prepared;
  let sentToGbegamey = line.sentToGbegamey;

  if (input.type === "prepare") {
    nextStock = line.stockZogbo + qty;
    prepared = line.prepared + qty;
  } else {
    const onHand = physicalComboStockZogbo(line);
    if (qty > onHand) {
      throw new Error(
        `Stock insuffisant pour « ${line.name} » : ${onHand} en main ` +
          `(${line.stockZogbo} dispo − ${line.soldZogbo} vendu)`,
      );
    }
    nextStock = line.stockZogbo - qty;
    sentToGbegamey = line.sentToGbegamey + qty;
  }

  const movement: CombosMovement = {
    id: newId("cmvt"),
    at: new Date().toISOString(),
    type: input.type,
    productId: line.productId,
    name: line.name,
    qty,
    stockAfter: nextStock,
    cancelledAt: null,
  };

  const nextLines = lines.map((l, i) =>
    i === idx
      ? { ...line, stockZogbo: nextStock, prepared, sentToGbegamey }
      : normalizeCombosLine(l),
  );

  return {
    lines: nextLines,
    movements: [movement, ...movements],
    movement,
  };
}

export function cancelCombosMovementInState(
  lines: CombosLine[],
  movements: CombosMovement[],
  movementId: string,
): {
  lines: CombosLine[];
  movements: CombosMovement[];
  movement: CombosMovement;
} {
  const target = movements.find((m) => m.id === movementId);
  if (!target) throw new Error("Mouvement introuvable");
  if (target.cancelledAt) throw new Error("Mouvement déjà annulé");

  const idx = lines.findIndex((l) => l.productId === target.productId);
  if (idx < 0) throw new Error("Formule introuvable");
  const line = normalizeCombosLine(lines[idx]!);

  let nextStock: number;
  let prepared = line.prepared;
  let sentToGbegamey = line.sentToGbegamey;

  if (target.type === "prepare") {
    nextStock = line.stockZogbo - target.qty;
    if (physicalComboStockZogbo({ stockZogbo: nextStock, soldZogbo: line.soldZogbo }) < 0) {
      throw new Error(
        `Annulation impossible pour « ${line.name} » : ces ${target.qty} combos ` +
          `ont déjà été envoyés ou vendus.`,
      );
    }
    prepared = Math.max(0, line.prepared - target.qty);
  } else {
    const gbeAfter =
      line.initialGbegamey +
      (line.sentToGbegamey - target.qty) -
      line.soldGbegamey;
    if (gbeAfter < 0) {
      throw new Error(
        `Annulation impossible : Gbégamey a déjà vendu une partie de cet envoi.`,
      );
    }
    nextStock = line.stockZogbo + target.qty;
    sentToGbegamey = Math.max(0, line.sentToGbegamey - target.qty);
  }

  const cancelled: CombosMovement = {
    ...target,
    cancelledAt: new Date().toISOString(),
  };

  return {
    lines: lines.map((l, i) =>
      i === idx
        ? { ...line, stockZogbo: nextStock, prepared, sentToGbegamey }
        : normalizeCombosLine(l),
    ),
    movements: movements.map((m) => (m.id === movementId ? cancelled : m)),
    movement: cancelled,
  };
}

export function computeCombosDay(
  day: CombosDay,
  combos: ComboDish[],
): {
  lines: CombosLineComputed[];
  movements: CombosMovement[];
  totals: {
    stockZogbo: number;
    prepared: number;
    sent: number;
    soldZogbo: number;
    soldGbegamey: number;
    soldTotal: number;
    soldAmount: number;
    soldAmountZogbo: number;
    soldAmountGbegamey: number;
    stockActuelZogbo: number;
    stockActuelGbegamey: number;
  };
} {
  const priceById = new Map(combos.map((c) => [c.id, c.unitPrice]));
  const lines = day.lines.map((line) =>
    computeCombosLine(line, priceById.get(line.productId) ?? 0),
  );
  const movements = (day.movements ?? [])
    .map((m) => normalizeCombosMovement(m))
    .filter((m): m is CombosMovement => !!m)
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  const totals = lines.reduce(
    (acc, l) => {
      acc.stockZogbo += l.stockZogbo;
      acc.prepared += l.prepared;
      acc.sent += l.sentToGbegamey;
      acc.soldZogbo += l.soldZogbo;
      acc.soldGbegamey += l.soldGbegamey;
      acc.soldTotal += l.soldTotal;
      acc.soldAmount += l.soldAmount;
      acc.soldAmountZogbo += l.soldAmountZogbo;
      acc.soldAmountGbegamey += l.soldAmountGbegamey;
      acc.stockActuelZogbo += l.stockActuelZogbo;
      acc.stockActuelGbegamey += l.stockActuelGbegamey;
      return acc;
    },
    {
      stockZogbo: 0,
      prepared: 0,
      sent: 0,
      soldZogbo: 0,
      soldGbegamey: 0,
      soldTotal: 0,
      soldAmount: 0,
      soldAmountZogbo: 0,
      soldAmountGbegamey: 0,
      stockActuelZogbo: 0,
      stockActuelGbegamey: 0,
    },
  );

  return { lines, movements, totals };
}

export { previousIsoDate };
