import type { VenteSite } from "@/lib/types";

/** Cycle de vie d'une unité QR tracée (plat uniquement). */
export type StockUnitStatus = "prepare" | "envoye" | "vendu" | "perdu";

export const STOCK_UNIT_STATUS_LABELS: Record<StockUnitStatus, string> = {
  prepare: "Préparé",
  envoye: "Envoyé",
  vendu: "Vendu",
  perdu: "Perdu",
};

/** Transitions autorisées — jamais deux statuts incompatibles. */
export const STOCK_UNIT_TRANSITIONS: Record<
  StockUnitStatus,
  readonly StockUnitStatus[]
> = {
  prepare: ["envoye", "vendu", "perdu"],
  envoye: ["vendu", "perdu"],
  vendu: [],
  perdu: [],
};

export function canTransitionUnitStatus(
  from: StockUnitStatus,
  to: StockUnitStatus,
): boolean {
  return STOCK_UNIT_TRANSITIONS[from].includes(to);
}

export type StockUnit = {
  id: string;
  qrId: string;
  productId: string;
  productName: string;
  batchId: string;
  /** Journée de préparation (YYYY-MM-DD). */
  date: string;
  site: VenteSite;
  status: StockUnitStatus;
  /** Mouvement Zogbo « send » lié à l'envoi. */
  movementId: string | null;
  preparedAt: string;
  sentAt: string | null;
  soldAt: string | null;
  lostAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PlatUnitStats = {
  productId: string;
  productName: string;
  /** Compteur agrégé zogbo_jours.lines.prepared */
  prepared: number;
  sentAggregate: number;
  soldAggregate: number;
  pertesAggregate: number;
  stockAggregate: number;
  /** Unités QR créées pour ce jour / produit */
  qrGenerated: number;
  /** Unités au statut envoye (tous sites après envoi) */
  qrSent: number;
  /** Unités prepare encore à Zogbo */
  qrRemainingZogbo: number;
  qrVendu: number;
  qrPerdu: number;
  /** QR restant à générer = prepared − qrGenerated */
  qrToGenerate: number;
};

export type StockZogboPayload = {
  date: string;
  plats: PlatUnitStats[];
  accompanimentLines: import("@/lib/types").GbegameyLocalLine[];
  localDishes: import("@/lib/types").LocalDish[];
  baseDishes: import("@/lib/types").BaseDish[];
};

export type StockUnitScanResult = {
  unit: StockUnit;
  allowedActions: Array<"send" | "mark-lost" | "sell">;
  message: string | null;
};
