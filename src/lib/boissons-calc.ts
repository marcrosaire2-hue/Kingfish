import type {
  BoissonsDay,
  BoissonsLine,
  BoissonsLineComputed,
  BoissonsMovement,
  BoissonsMovementType,
  Drink,
} from "@/lib/types";
import { newId } from "@/lib/format";

type LegacyBoissonsLine = BoissonsLine & { sold?: number };

/** Défaut : casier grande bouteille */
export const DEFAULT_UNITS_PER_CASIER = 12;

/** Heuristique PB/PM → 24, sinon 12 (GB, etc.) */
export function guessUnitsPerCasier(name: string): number {
  const n = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
  if (/\bP[BM]\b/.test(n)) return 24;
  return DEFAULT_UNITS_PER_CASIER;
}

export function unitsPerCasierOf(drink: Drink | undefined | null): number {
  const raw = drink?.unitsPerCasier;
  if (raw !== undefined && raw !== null && Number(raw) > 0) {
    return Math.max(1, Math.round(Number(raw)));
  }
  return drink?.name
    ? guessUnitsPerCasier(drink.name)
    : DEFAULT_UNITS_PER_CASIER;
}

export function normalizeDrink(drink: Drink): Drink {
  return {
    id: drink.id,
    name: drink.name,
    purchasePrice: Math.max(0, Number(drink.purchasePrice) || 0),
    salePrice:
      drink.salePrice === null || drink.salePrice === undefined
        ? null
        : Math.max(0, Number(drink.salePrice) || 0),
    unitsPerCasier: unitsPerCasierOf(drink),
  };
}

/** Affiche une qté en casiers (ex. 1,5) */
export function formatCasiers(value: number): string {
  const n = Math.round(value * 100) / 100;
  if (Number.isInteger(n)) return String(n);
  return n
    .toFixed(2)
    .replace(/0+$/, "")
    .replace(/\.$/, "")
    .replace(".", ",");
}

export function emptyBoissonsLine(
  drink: Drink,
  initialStock = 0,
): BoissonsLine {
  return {
    productId: drink.id,
    name: drink.name,
    initialStock: Math.max(0, initialStock),
    purchases: 0,
    soldZogbo: 0,
    soldGbegamey: 0,
    counted: null,
    observations: "",
  };
}

export function normalizeBoissonsLine(line: LegacyBoissonsLine): BoissonsLine {
  const legacySold = Number(line.sold) || 0;
  return {
    productId: line.productId,
    name: line.name,
    initialStock: Math.max(0, Number(line.initialStock) || 0),
    purchases: Math.max(0, Number(line.purchases) || 0),
    soldZogbo: Math.max(
      0,
      line.soldZogbo !== undefined ? Number(line.soldZogbo) || 0 : legacySold,
    ),
    soldGbegamey: Math.max(0, Number(line.soldGbegamey) || 0),
    counted:
      line.counted === null || line.counted === undefined
        ? null
        : Math.max(0, Number(line.counted) || 0),
    observations: String(line.observations ?? ""),
  };
}

export function normalizeBoissonsMovement(
  m: Partial<BoissonsMovement> & {
    id?: string;
    type?: string;
    productId?: string;
    name?: string;
  },
): BoissonsMovement | null {
  if (!m.id || !m.productId || m.type !== "purchase") return null;
  return {
    id: m.id,
    at: m.at || new Date().toISOString(),
    type: "purchase",
    productId: m.productId,
    name: String(m.name ?? ""),
    qty: Math.max(0, Number(m.qty) || 0),
    stockAfter: Math.max(0, Number(m.stockAfter) || 0),
    cancelledAt: m.cancelledAt ?? null,
  };
}

export function movementTypeLabelBoissons(type: BoissonsMovementType): string {
  return type === "purchase" ? "Achat (casiers)" : type;
}

export function syncBoissonsLines(
  lines: BoissonsLine[],
  drinks: Drink[],
): BoissonsLine[] {
  const byId = new Map(
    lines.map((l) => [l.productId, normalizeBoissonsLine(l)]),
  );
  return drinks.map((drink) => {
    const existing = byId.get(drink.id);
    if (!existing) return emptyBoissonsLine(drink);
    return { ...existing, name: drink.name };
  });
}

export function createEmptyBoissonsDay(
  date: string,
  drinks: Drink[],
  initialByProductId?: Map<string, number> | Record<string, number>,
): BoissonsDay {
  const map =
    initialByProductId instanceof Map
      ? initialByProductId
      : new Map(Object.entries(initialByProductId ?? {}));
  return {
    date,
    status: "ouverte",
    lines: drinks.map((d) => emptyBoissonsLine(d, map.get(d.id) ?? 0)),
    movements: [],
    updatedAt: null,
  };
}

function remainingCasiers(
  line: Pick<
    BoissonsLine,
    "initialStock" | "purchases" | "soldZogbo" | "soldGbegamey"
  >,
  upc: number,
): number {
  const available = line.initialStock + line.purchases;
  const soldCasiers =
    (line.soldZogbo + line.soldGbegamey) / Math.max(1, upc);
  return available - soldCasiers;
}

export function leftoverFromBoissonsLines(
  lines: BoissonsLine[],
  drinks?: Drink[],
): Map<string, number> {
  const drinkById = new Map((drinks ?? []).map((d) => [d.id, d]));
  const out = new Map<string, number>();
  for (const line of lines) {
    const computed = computeBoissonsLine(
      line,
      drinkById.get(line.productId),
    );
    const leftover =
      computed.counted !== null
        ? computed.counted
        : Math.max(0, computed.theoreticalRemaining);
    out.set(line.productId, leftover);
  }
  return out;
}

export function computeBoissonsLine(
  line: BoissonsLine,
  drink: Drink | undefined,
): BoissonsLineComputed {
  const normalized = normalizeBoissonsLine(line);
  const upc = unitsPerCasierOf(drink);
  const purchasePrice = drink?.purchasePrice ?? 0;
  const salePrice = drink?.salePrice ?? null;
  const available = normalized.initialStock + normalized.purchases;
  const soldTotal = normalized.soldZogbo + normalized.soldGbegamey;
  const soldCasiers = soldTotal / upc;
  const theoreticalRemaining = available - soldCasiers;
  const stockBottles = Math.max(0, Math.round(available * upc - soldTotal));
  const soldAmountZogbo =
    salePrice === null ? 0 : normalized.soldZogbo * salePrice;
  const soldAmountGbegamey =
    salePrice === null ? 0 : normalized.soldGbegamey * salePrice;
  const soldAmount = soldAmountZogbo + soldAmountGbegamey;
  const margin =
    salePrice === null ? null : soldTotal * (salePrice - purchasePrice);
  const variance =
    normalized.counted === null
      ? null
      : theoreticalRemaining - normalized.counted;

  return {
    ...normalized,
    purchasePrice,
    salePrice,
    unitsPerCasier: upc,
    available,
    soldTotal,
    soldCasiers,
    soldAmount,
    soldAmountZogbo,
    soldAmountGbegamey,
    margin,
    theoreticalRemaining,
    stockBottles,
    variance,
  };
}

/** Stock restant vendable en bouteilles */
export function physicalBoissonsStock(
  line: Pick<
    BoissonsLine,
    "initialStock" | "purchases" | "soldZogbo" | "soldGbegamey"
  >,
  unitsPerCasier: number = DEFAULT_UNITS_PER_CASIER,
): number {
  const upc = Math.max(1, Math.round(unitsPerCasier) || DEFAULT_UNITS_PER_CASIER);
  const bottles =
    (line.initialStock + line.purchases) * upc -
    line.soldZogbo -
    line.soldGbegamey;
  return Math.max(0, Math.round(bottles));
}

export function applyBoissonsPurchaseToState(
  lines: BoissonsLine[],
  movements: BoissonsMovement[],
  input: { productId: string; qty: number; unitsPerCasier?: number },
): {
  lines: BoissonsLine[];
  movements: BoissonsMovement[];
  movement: BoissonsMovement;
} {
  const qty = Math.max(0, Math.round(Number(input.qty) || 0));
  if (qty <= 0) throw new Error("Quantité invalide (casiers)");

  const idx = lines.findIndex((l) => l.productId === input.productId);
  if (idx < 0) throw new Error("Boisson introuvable");

  const line = normalizeBoissonsLine(lines[idx]!);
  const upc = Math.max(
    1,
    Math.round(input.unitsPerCasier || DEFAULT_UNITS_PER_CASIER),
  );
  const purchases = line.purchases + qty;
  const stockAfter = remainingCasiers({ ...line, purchases }, upc);

  const movement: BoissonsMovement = {
    id: newId("bmvt"),
    at: new Date().toISOString(),
    type: "purchase",
    productId: line.productId,
    name: line.name,
    qty,
    stockAfter: Math.max(0, Math.round(stockAfter * 100) / 100),
    cancelledAt: null,
  };

  const nextLines = lines.map((l, i) =>
    i === idx ? { ...line, purchases } : normalizeBoissonsLine(l),
  );

  return {
    lines: nextLines,
    movements: [movement, ...movements],
    movement,
  };
}

export function cancelBoissonsMovementInState(
  lines: BoissonsLine[],
  movements: BoissonsMovement[],
  movementId: string,
  unitsPerCasier: number = DEFAULT_UNITS_PER_CASIER,
): {
  lines: BoissonsLine[];
  movements: BoissonsMovement[];
  movement: BoissonsMovement;
} {
  const target = movements.find((m) => m.id === movementId);
  if (!target) throw new Error("Mouvement introuvable");
  if (target.cancelledAt) throw new Error("Mouvement déjà annulé");

  const idx = lines.findIndex((l) => l.productId === target.productId);
  if (idx < 0) throw new Error("Boisson introuvable");
  const line = normalizeBoissonsLine(lines[idx]!);
  const upc = Math.max(1, Math.round(unitsPerCasier) || DEFAULT_UNITS_PER_CASIER);

  const purchases = Math.max(0, line.purchases - target.qty);
  const onHandAfter = remainingCasiers({ ...line, purchases }, upc);
  if (onHandAfter < -1e-9) {
    throw new Error(
      "Impossible d’annuler : le stock serait négatif (ventes déjà enregistrées).",
    );
  }

  const cancelled: BoissonsMovement = {
    ...target,
    cancelledAt: new Date().toISOString(),
  };

  const nextLines = lines.map((l, i) =>
    i === idx ? { ...line, purchases } : normalizeBoissonsLine(l),
  );
  const nextMovements = movements.map((m) =>
    m.id === movementId ? cancelled : m,
  );

  return { lines: nextLines, movements: nextMovements, movement: cancelled };
}

export function computeBoissonsDay(
  day: BoissonsDay,
  drinks: Drink[],
): {
  lines: BoissonsLineComputed[];
  movements: BoissonsMovement[];
  totals: {
    available: number;
    purchases: number;
    sold: number;
    soldZogbo: number;
    soldGbegamey: number;
    soldAmount: number;
    soldAmountZogbo: number;
    soldAmountGbegamey: number;
    margin: number;
    varianceCount: number;
    missingSalePrice: number;
  };
} {
  const byId = new Map(drinks.map((d) => [d.id, d]));
  const lines = day.lines.map((line) =>
    computeBoissonsLine(line, byId.get(line.productId)),
  );
  const movements = (day.movements ?? [])
    .map((m) => normalizeBoissonsMovement(m))
    .filter((m): m is BoissonsMovement => !!m)
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  const totals = lines.reduce(
    (acc, l) => {
      acc.available += l.available;
      acc.purchases += l.purchases;
      acc.sold += l.soldTotal;
      acc.soldZogbo += l.soldZogbo;
      acc.soldGbegamey += l.soldGbegamey;
      acc.soldAmount += l.soldAmount;
      acc.soldAmountZogbo += l.soldAmountZogbo;
      acc.soldAmountGbegamey += l.soldAmountGbegamey;
      if (l.margin !== null) acc.margin += l.margin;
      if (l.variance !== null && l.variance !== 0) acc.varianceCount += 1;
      if (l.salePrice === null) acc.missingSalePrice += 1;
      return acc;
    },
    {
      available: 0,
      purchases: 0,
      sold: 0,
      soldZogbo: 0,
      soldGbegamey: 0,
      soldAmount: 0,
      soldAmountZogbo: 0,
      soldAmountGbegamey: 0,
      margin: 0,
      varianceCount: 0,
      missingSalePrice: 0,
    },
  );

  return { lines, movements, totals };
}
