import type {
  BaseDish,
  ZogboDay,
  ZogboLine,
  ZogboLineComputed,
  ZogboMovement,
  ZogboMovementType,
} from "@/lib/types";
import { newId } from "@/lib/format";

type LegacyZogboLine = Partial<ZogboLine> & {
  productId: string;
  name: string;
  initialStock?: number;
};

export function emptyZogboLine(
  dish: Pick<BaseDish, "id" | "name">,
  openingStock = 0,
): ZogboLine {
  const stock = Math.max(0, openingStock);
  return {
    productId: dish.id,
    name: dish.name,
    stock,
    prepared: 0,
    sentToGbegamey: 0,
    sold: 0,
    pertes: 0,
    counted: null,
    observations: "",
  };
}

export function normalizeZogboLine(line: LegacyZogboLine): ZogboLine {
  const prepared = Math.max(0, Number(line.prepared) || 0);
  const sentToGbegamey = Math.max(0, Number(line.sentToGbegamey) || 0);
  const sold = Math.max(0, Number(line.sold) || 0);
  const legacyInitial = Math.max(0, Number(line.initialStock) || 0);

  let stock: number;
  if (line.stock !== undefined && line.stock !== null) {
    stock = Math.max(0, Number(line.stock) || 0);
  } else {
    // Migration ancien modèle : stock = init + préparé − envoyé
    stock = Math.max(0, legacyInitial + prepared - sentToGbegamey);
  }

  return {
    productId: line.productId,
    name: line.name,
    stock,
    prepared,
    sentToGbegamey,
    sold,
    pertes: Math.max(0, Number(line.pertes) || 0),
    counted:
      line.counted === null || line.counted === undefined
        ? null
        : Math.max(0, Number(line.counted) || 0),
    observations: String(line.observations ?? ""),
  };
}

export function normalizeZogboMovement(
  m: Partial<ZogboMovement> & {
    id?: string;
    type?: string;
    productId?: string;
    name?: string;
  },
): ZogboMovement | null {
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

export function syncZogboLinesWithCatalog(
  lines: ZogboLine[],
  baseDishes: BaseDish[],
): ZogboLine[] {
  const byId = new Map(
    lines.map((l) => [l.productId, normalizeZogboLine(l)]),
  );
  return baseDishes.map((dish) => {
    const existing = byId.get(dish.id);
    if (!existing) return emptyZogboLine(dish);
    return { ...existing, name: dish.name };
  });
}

export function createEmptyZogboDay(
  date: string,
  baseDishes: BaseDish[],
  openingByProductId?: Map<string, number> | Record<string, number>,
): ZogboDay {
  const map =
    openingByProductId instanceof Map
      ? openingByProductId
      : new Map(Object.entries(openingByProductId ?? {}));
  return {
    date,
    status: "ouverte",
    lines: baseDishes.map((d) => emptyZogboLine(d, map.get(d.id) ?? 0)),
    movements: [],
    updatedAt: null,
  };
}

/**
 * Ce qui est réellement en main à Zogbo : le préparé encore présent
 * (les envois l’ont déjà décrémenté) moins ce qui a été vendu sur place.
 */
export function physicalStock(
  line: Pick<ZogboLine, "stock" | "sold"> & { pertes?: number },
): number {
  return line.stock - line.sold - Math.max(0, Number(line.pertes) || 0);
}

export function computeZogboLine(
  line: ZogboLine,
  unitPrice: number,
): ZogboLineComputed {
  const normalized = normalizeZogboLine(line);
  const counted = normalized.counted;
  // Le comptage saisi devient le stock du jour : la vérité physique remplace
  // le stock mouvementé dès qu'elle est saisie. Les ventes et pertes le
  // décrementent ensuite.
  const available =
    counted !== null ? Math.max(0, counted) : normalized.stock;
  const theoreticalRemaining = Math.max(
    0,
    available - normalized.sold - normalized.pertes,
  );
  // Stock qui prévaut : le comptage (stock initial) s'il existe, sinon le
  // mouvementé. Le comptage est la vérité physique : les ventes suivantes le
  // décrementent, sans recompter le vendu antérieur.
  const prevalentMaxSold =
    counted !== null
      ? Math.max(0, counted)
      : Math.max(0, available - normalized.pertes);
  // Plus d'écart mesurable : le comptage EST le stock du jour.
  const variance = null;

  return {
    ...normalized,
    unitPrice,
    available,
    availableAmount: available * unitPrice,
    soldAmount: normalized.sold * unitPrice,
    theoreticalRemaining,
    prevalentMaxSold,
    prevalentRemaining: Math.max(0, prevalentMaxSold - normalized.sold),
    variance,
  };
}

export function computeZogboDay(
  day: ZogboDay,
  baseDishes: BaseDish[],
): {
  lines: ZogboLineComputed[];
  movements: ZogboMovement[];
  totals: {
    stock: number;
    prepared: number;
    sent: number;
    available: number;
    availableAmount: number;
    sold: number;
    soldAmount: number;
    theoretical: number;
    counted: number;
    varianceCount: number;
  };
} {
  const priceById = new Map(baseDishes.map((d) => [d.id, d.unitPrice]));
  const lines = day.lines.map((line) =>
    computeZogboLine(line, priceById.get(line.productId) ?? 0),
  );
  const movements = (day.movements ?? [])
    .map((m) => normalizeZogboMovement(m))
    .filter((m): m is ZogboMovement => !!m)
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  const totals = lines.reduce(
    (acc, l) => {
      acc.stock += l.stock;
      acc.prepared += l.prepared;
      acc.sent += l.sentToGbegamey;
      acc.available += l.available;
      acc.availableAmount += l.availableAmount;
      acc.sold += l.sold;
      acc.soldAmount += l.soldAmount;
      acc.theoretical += l.theoreticalRemaining;
      if (l.counted !== null) acc.counted += l.counted;
      if (l.variance !== null && l.variance !== 0) acc.varianceCount += 1;
      return acc;
    },
    {
      stock: 0,
      prepared: 0,
      sent: 0,
      available: 0,
      availableAmount: 0,
      sold: 0,
      soldAmount: 0,
      theoretical: 0,
      counted: 0,
      varianceCount: 0,
    },
  );

  return { lines, movements, totals };
}

/** Applique un mouvement et renvoie lignes + mouvement */
export function applyZogboMovementToState(
  lines: ZogboLine[],
  movements: ZogboMovement[],
  input: {
    type: ZogboMovementType;
    productId: string;
    qty: number;
  },
): { lines: ZogboLine[]; movements: ZogboMovement[]; movement: ZogboMovement } {
  const qty = Math.max(0, Math.round(Number(input.qty) || 0));
  if (qty <= 0) throw new Error("Quantité invalide");

  const idx = lines.findIndex((l) => l.productId === input.productId);
  if (idx < 0) throw new Error("Plat introuvable");

  const line = normalizeZogboLine(lines[idx]!);
  let nextStock = line.stock;
  let prepared = line.prepared;
  let sentToGbegamey = line.sentToGbegamey;

  if (input.type === "prepare") {
    nextStock = line.stock + qty;
    prepared = line.prepared + qty;
  } else {
    // On ne peut envoyer que ce qui est physiquement là :
    // le stock préparé moins ce qui a déjà été vendu sur place.
    const onHand = physicalStock(line);
    if (qty > onHand) {
      throw new Error(
        `Stock insuffisant pour « ${line.name} » : ${onHand} en main ` +
          `(${line.stock} préparé − ${line.sold} vendu)`,
      );
    }
    nextStock = line.stock - qty;
    sentToGbegamey = line.sentToGbegamey + qty;
  }

  const movement: ZogboMovement = {
    id: newId("mvt"),
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
      ? {
          ...line,
          stock: nextStock,
          prepared,
          sentToGbegamey,
        }
      : normalizeZogboLine(l),
  );

  return {
    lines: nextLines,
    movements: [movement, ...movements],
    movement,
  };
}

/**
 * Annule un mouvement : la ligne du registre reste (barrée, horodatée),
 * son effet sur le stock est repris. Aucune écriture n’est effacée.
 */
export function cancelZogboMovementInState(
  lines: ZogboLine[],
  movements: ZogboMovement[],
  movementId: string,
): { lines: ZogboLine[]; movements: ZogboMovement[]; movement: ZogboMovement } {
  const target = movements.find((m) => m.id === movementId);
  if (!target) throw new Error("Mouvement introuvable");
  if (target.cancelledAt) throw new Error("Mouvement déjà annulé");

  const idx = lines.findIndex((l) => l.productId === target.productId);
  if (idx < 0) throw new Error("Plat introuvable");
  const line = normalizeZogboLine(lines[idx]!);

  let nextStock: number;
  let prepared = line.prepared;
  let sentToGbegamey = line.sentToGbegamey;

  if (target.type === "prepare") {
    // Retirer une préparation : impossible si les plats sont déjà
    // partis (envoi) ou vendus — le stock deviendrait négatif.
    nextStock = line.stock - target.qty;
    if (physicalStock({ stock: nextStock, sold: line.sold }) < 0) {
      throw new Error(
        `Annulation impossible pour « ${line.name} » : ces ${target.qty} plats ` +
          `ont déjà été envoyés ou vendus. Faites une nouvelle préparation ` +
          `pour ajuster.`,
      );
    }
    prepared = Math.max(0, line.prepared - target.qty);
  } else {
    nextStock = line.stock + target.qty;
    sentToGbegamey = Math.max(0, line.sentToGbegamey - target.qty);
  }

  const cancelledAt = new Date().toISOString();
  const movement: ZogboMovement = { ...target, cancelledAt };

  return {
    lines: lines.map((l, i) =>
      i === idx
        ? { ...line, stock: nextStock, prepared, sentToGbegamey }
        : normalizeZogboLine(l),
    ),
    movements: movements.map((m) => (m.id === movementId ? movement : m)),
    movement,
  };
}

export function leftoverFromZogboLines(
  lines: ZogboLine[],
  // Conservé pour compatibilité d’appel ; le comptage étant le stock du
  // jour, le théorique en tient déjà compte.
  _options?: { useCounted?: boolean },
): Map<string, number> {
  // Le comptage étant le stock du jour, le reste du jour l'est aussi :
  // compté − vendu − pertes, même si la journée n'est pas clôturée.
  const out = new Map<string, number>();
  for (const line of lines) {
    const computed = computeZogboLine(line, 0);
    out.set(line.productId, Math.max(0, computed.theoreticalRemaining));
  }
  return out;
}

/** True s’il reste au moins une portion à reporter. */
export function leftoverMapHasStock(map: Map<string, number>): boolean {
  for (const qty of map.values()) {
    if (qty > 0) return true;
  }
  return false;
}

/**
 * Journée « vide » (souvent aquapro-opening) : rien à vendre ni à reporter.
 * On ne doit pas bloquer le report du dernier inventaire réel.
 */
export function zogboDayHasCarryStock(lines: ZogboLine[]): boolean {
  return leftoverMapHasStock(leftoverFromZogboLines(lines));
}

/** Fuseau du restaurant : toute date « jour de service » s’y calcule. */
export const BUSINESS_TIMEZONE = "Africa/Porto-Novo";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Décale une date ISO de `days` jours (négatif = vers le passé). */
export function shiftIsoDate(isoDate: string, days: number): string | null {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/**
 * Fenêtre de report du stock : si le restaurant est resté fermé plus
 * longtemps, le reste n’est pas repris (plats périssables).
 */
export const LEFTOVER_LOOKBACK_DAYS = 7;

export function previousIsoDate(isoDate: string): string | null {
  return shiftIsoDate(isoDate, -1);
}

/** Calendrier civil au Bénin, pas celui du serveur (souvent UTC). */
export function isoDateInTimeZone(
  instant: Date,
  timeZone = BUSINESS_TIMEZONE,
): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

export function todayIsoDate(now = new Date()): string {
  return isoDateInTimeZone(now);
}

/**
 * Jour de service : tant que la caisse de la zone est ouverte, les ventes
 * restent collées à sa date — même après minuit. Sinon, date demandée ou
 * calendrier civil de Porto-Novo.
 */
export function operatingDateFromCaisse(
  caisseDate: string | null | undefined,
  requested: string | null | undefined,
  today: string,
): string {
  if (caisseDate && ISO_DATE.test(caisseDate)) return caisseDate;
  if (requested && ISO_DATE.test(requested)) return requested;
  return today;
}

export function formatDisplayDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "full" }).format(
    new Date(y, m - 1, d),
  );
}

export function movementTypeLabel(type: ZogboMovementType): string {
  return type === "prepare" ? "Préparé" : "Envoi Gbégamey";
}
