import type { VenteKind, VenteSite } from "@/lib/types";

/** Cycle de vie d'une unité QR tracée. */
export type StockUnitStatus = "prepare" | "envoye" | "vendu" | "perdu";

/** Nature de l’article étiqueté. */
export type StockUnitKind = Extract<VenteKind, "plat" | "local" | "boisson">;

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
  /** Code court collé sous le QR, saisi à la caisse sans scanner. */
  stickerCode: string;
  kind: StockUnitKind;
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
  accStats: PlatUnitStats[];
  drinkStats: PlatUnitStats[];
  accompanimentLines: import("@/lib/types").GbegameyLocalLine[];
  localDishes: import("@/lib/types").LocalDish[];
  baseDishes: import("@/lib/types").BaseDish[];
  drinks: import("@/lib/types").Drink[];
};

export type StockUnitScanResult = {
  unit: StockUnit;
  allowedActions: Array<"send" | "mark-lost" | "sell">;
  message: string | null;
};
