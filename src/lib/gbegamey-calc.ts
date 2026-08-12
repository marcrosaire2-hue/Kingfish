import type {
  BaseDish,
  GbegameyDay,
  GbegameyLocalComputed,
  GbegameyLocalLine,
  GbegameyTransferComputed,
  GbegameyTransferLine,
  LocalDish,
} from "@/lib/types";

type LegacyTransfer = GbegameyTransferLine & { initialStock?: number };
type LegacyLocal = GbegameyLocalLine & { initialStock?: number };

export function emptyTransferLine(
  dish: Pick<BaseDish, "id" | "name">,
  initialStock = 0,
): GbegameyTransferLine {
  return {
    productId: dish.id,
    name: dish.name,
    initialStock: Math.max(0, initialStock),
    received: null,
    sold: 0,
    pertes: 0,
    counted: null,
    observations: "",
  };
}

export function emptyLocalLine(
  dish: Pick<LocalDish, "id" | "name">,
  initialStock = 0,
): GbegameyLocalLine {
  return {
    productId: dish.id,
    name: dish.name,
    initialStock: Math.max(0, initialStock),
    prepared: 0,
    sold: 0,
    pertes: 0,
    counted: null,
    observations: "",
  };
}

export function normalizeTransferLine(
  line: LegacyTransfer,
): GbegameyTransferLine {
  return {
    productId: line.productId,
    name: line.name,
    initialStock: Math.max(0, Number(line.initialStock) || 0),
    received:
      line.received === null || line.received === undefined
        ? null
        : Math.max(0, Number(line.received) || 0),
    sold: Math.max(0, Number(line.sold) || 0),
    pertes: Math.max(0, Number(line.pertes) || 0),
    counted:
      line.counted === null || line.counted === undefined
        ? null
        : Math.max(0, Number(line.counted) || 0),
    observations: String(line.observations ?? ""),
  };
}

export function normalizeLocalLine(line: LegacyLocal): GbegameyLocalLine {
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

export function syncTransferLines(
  lines: GbegameyTransferLine[],
  baseDishes: BaseDish[],
): GbegameyTransferLine[] {
  const byId = new Map(
    lines.map((l) => [l.productId, normalizeTransferLine(l)]),
  );
  return baseDishes.map((dish) => {
    const existing = byId.get(dish.id);
    if (!existing) return emptyTransferLine(dish);
    return { ...existing, name: dish.name };
  });
}

export function syncLocalLines(
  lines: GbegameyLocalLine[],
  localDishes: LocalDish[],
): GbegameyLocalLine[] {
  const byId = new Map(lines.map((l) => [l.productId, normalizeLocalLine(l)]));
  return localDishes.map((dish) => {
    const existing = byId.get(dish.id);
    if (!existing) return emptyLocalLine(dish);
    return { ...existing, name: dish.name };
  });
}

export function createEmptyGbegameyDay(
  date: string,
  baseDishes: BaseDish[],
  localDishes: LocalDish[],
  initialTransfer?: Map<string, number> | Record<string, number>,
  initialLocal?: Map<string, number> | Record<string, number>,
): GbegameyDay {
  const transferMap =
    initialTransfer instanceof Map
      ? initialTransfer
      : new Map(Object.entries(initialTransfer ?? {}));
  const localMap =
    initialLocal instanceof Map
      ? initialLocal
      : new Map(Object.entries(initialLocal ?? {}));
  return {
    date,
    status: "ouverte",
    transferLines: baseDishes.map((d) =>
      emptyTransferLine(d, transferMap.get(d.id) ?? 0),
    ),
    localLines: localDishes.map((d) =>
      emptyLocalLine(d, localMap.get(d.id) ?? 0),
    ),
    updatedAt: null,
  };
}

export function computeTransferLine(
  line: GbegameyTransferLine,
  sentFromZogbo: number,
  unitPrice: number,
): GbegameyTransferComputed {
  const normalized = normalizeTransferLine(line);

  // Tant que la réception n’est pas vérifiée, on retient ce que Zogbo a
  // déclaré : la marchandise reste vendable sans geste supplémentaire.
  const receivedFromZogbo = normalized.received ?? sentFromZogbo;
  const transportVariance =
    normalized.received === null ? null : sentFromZogbo - normalized.received;

  const available = normalized.initialStock + receivedFromZogbo;
  const theoreticalRemaining =
    available - normalized.sold - normalized.pertes;
  const variance =
    normalized.counted === null
      ? null
      : theoreticalRemaining - normalized.counted;

  return {
    ...normalized,
    sentFromZogbo,
    receivedFromZogbo,
    transportVariance,
    unitPrice,
    available,
    receivedAmount: receivedFromZogbo * unitPrice,
    soldAmount: normalized.sold * unitPrice,
    theoreticalRemaining,
    variance,
  };
}

export function computeLocalLine(
  line: GbegameyLocalLine,
  unitPrice: number,
): GbegameyLocalComputed {
  const normalized = normalizeLocalLine(line);
  const available = normalized.initialStock + normalized.prepared;
  const theoreticalRemaining =
    available - normalized.sold - normalized.pertes;
  const variance =
    normalized.counted === null
      ? null
      : theoreticalRemaining - normalized.counted;

  return {
    ...normalized,
    unitPrice,
    available,
    soldAmount: normalized.sold * unitPrice,
    theoreticalRemaining,
    variance,
  };
}

export function leftoverFromTransferLines(
  lines: GbegameyTransferLine[],
  receivedById: Map<string, number>,
  unitPriceById?: Map<string, number>,
  options?: { useCounted?: boolean },
): Map<string, number> {
  const useCounted = options?.useCounted !== false;
  const out = new Map<string, number>();
  for (const line of lines) {
    const computed = computeTransferLine(
      line,
      receivedById.get(line.productId) ?? 0,
      unitPriceById?.get(line.productId) ?? 0,
    );
    const leftover =
      useCounted && computed.counted !== null
        ? computed.counted
        : Math.max(0, computed.theoreticalRemaining);
    out.set(line.productId, leftover);
  }
  return out;
}

export function leftoverFromLocalLines(
  lines: GbegameyLocalLine[],
  unitPriceById?: Map<string, number>,
  options?: { useCounted?: boolean },
): Map<string, number> {
  const useCounted = options?.useCounted !== false;
  const out = new Map<string, number>();
  for (const line of lines) {
    const computed = computeLocalLine(
      line,
      unitPriceById?.get(line.productId) ?? 0,
    );
    const leftover =
      useCounted && computed.counted !== null
        ? computed.counted
        : Math.max(0, computed.theoreticalRemaining);
    out.set(line.productId, leftover);
  }
  return out;
}

export function computeGbegameyDay(
  day: GbegameyDay,
  baseDishes: BaseDish[],
  localDishes: LocalDish[],
  sentByProductId: Map<string, number>,
): {
  transfers: GbegameyTransferComputed[];
  locals: GbegameyLocalComputed[];
  totals: {
    initialStock: number;
    sent: number;
    received: number;
    /** Total envoyé − constaté sur les lignes vérifiées */
    transportLost: number;
    /** Nombre de lignes vérifiées présentant une perte au transport */
    transportVarianceCount: number;
    transferSold: number;
    transferSoldAmount: number;
    localInitial: number;
    localPrepared: number;
    localSold: number;
    localSoldAmount: number;
    soldAmount: number;
    varianceCount: number;
  };
} {
  const basePrice = new Map(baseDishes.map((d) => [d.id, d.unitPrice]));
  const localPrice = new Map(localDishes.map((d) => [d.id, d.unitPrice]));

  const transfers = day.transferLines.map((line) =>
    computeTransferLine(
      line,
      sentByProductId.get(line.productId) ?? 0,
      basePrice.get(line.productId) ?? 0,
    ),
  );

  const locals = day.localLines.map((line) =>
    computeLocalLine(line, localPrice.get(line.productId) ?? 0),
  );

  const totals = {
    initialStock: 0,
    sent: 0,
    received: 0,
    transportLost: 0,
    transportVarianceCount: 0,
    transferSold: 0,
    transferSoldAmount: 0,
    localInitial: 0,
    localPrepared: 0,
    localSold: 0,
    localSoldAmount: 0,
    soldAmount: 0,
    varianceCount: 0,
  };

  for (const t of transfers) {
    totals.initialStock += t.initialStock;
    totals.sent += t.sentFromZogbo;
    totals.received += t.receivedFromZogbo;
    totals.transferSold += t.sold;
    totals.transferSoldAmount += t.soldAmount;
    if (t.transportVariance !== null && t.transportVariance !== 0) {
      totals.transportLost += t.transportVariance;
      totals.transportVarianceCount += 1;
    }
    if (t.variance !== null && t.variance !== 0) totals.varianceCount += 1;
  }
  for (const l of locals) {
    totals.localInitial += l.initialStock;
    totals.localPrepared += l.prepared;
    totals.localSold += l.sold;
    totals.localSoldAmount += l.soldAmount;
    if (l.variance !== null && l.variance !== 0) totals.varianceCount += 1;
  }
  totals.soldAmount = totals.transferSoldAmount + totals.localSoldAmount;

  return { transfers, locals, totals };
}
