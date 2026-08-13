import { getParametres } from "@/lib/parametres-repo";
import { computeGbegameyDay, computeLocalLine } from "@/lib/gbegamey-calc";
import { computeZogboDay, physicalStock } from "@/lib/zogbo-calc";
import { getGbegameyDayPayload } from "@/lib/gbegamey-repo";
import { getZogboDayPayload } from "@/lib/zogbo-repo";
import type { VenteSite } from "@/lib/types";

export type StockZone =
  | "zogbo-plats"
  | "zogbo-accompagnements"
  | "gbegamey-plats"
  | "gbegamey-accompagnements";

export type StockRow = {
  zone: StockZone;
  zoneLabel: string;
  productId: string;
  name: string;
  kind: "plat" | "local";
  /** Solde d'ouverture du jour (report veille ou inventaire). */
  opening: number;
  /** Entrées du jour : préparé (Zogbo) ou reçu (Gbé plats) ou préparé (acc.). */
  entrees: number;
  /** Envoyé vers Gbégamey (plats Zogbo uniquement). */
  envoye: number;
  vendu: number;
  pertes: number;
  /** Reste théorique en fin de journée. */
  stockFinal: number;
  /** Stock encore vendable sur place (plats Zogbo). */
  stockVendable: number | null;
  compte: number | null;
  ecart: number | null;
  unit: "portions";
};

export type StockZoneTotal = {
  zone: StockZone;
  zoneLabel: string;
  lignes: number;
  stockFinal: number;
  stockVendable: number | null;
  vendu: number;
  ecarts: number;
};

export type StockPayload = {
  date: string;
  scopeSite: VenteSite | null;
  rows: StockRow[];
  totalsByZone: StockZoneTotal[];
  dayStatus: {
    zogbo: string | null;
    gbegamey: string | null;
  };
};

export type EpuiseRow = {
  zone: StockZone;
  zoneLabel: string;
  productId: string;
  name: string;
  kind: "plat" | "local";
  restant: number;
};

/**
 * Produits épuisés pour une journée : plus rien à vendre en fin de journée
 * (stockVendable nul à Zogbo, reste théorique nul partout ailleurs).
 * Le catalogue complet est requis (onlyActive=false) : un produit à zéro
 * n'a par définition aucune ligne « active » à signaler.
 */
export async function getEpuises(input: {
  date: string;
  scopeSite?: VenteSite | null;
}): Promise<EpuiseRow[]> {
  const { rows } = await getStockPayload({
    date: input.date,
    scopeSite: input.scopeSite,
    onlyActive: false,
  });
  return rows
    .map((r) => ({
      zone: r.zone,
      zoneLabel: r.zoneLabel,
      productId: r.productId,
      name: r.name,
      kind: r.kind,
      // Le comptage saisi prévaut : reste = compté − vendu, exactement la
      // même règle que le contrôle de vente (un produit compté 3 puis vendu
      // 3 est épuisé, malgré un comptage brut positif).
      stock:
        r.compte !== null
          ? r.compte - r.vendu
          : (r.stockVendable ?? r.stockFinal),
    }))
    .filter((r) => r.stock <= 0)
    .map(({ stock, ...e }) => ({ ...e, restant: stock }))
    .sort(
      (a, b) =>
        a.zoneLabel.localeCompare(b.zoneLabel, "fr") ||
        a.name.localeCompare(b.name, "fr"),
    );
}

function isValidDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

function zogboOpeningStock(line: {
  stock: number;
  prepared: number;
  sentToGbegamey: number;
}): number {
  return Math.max(0, line.stock - line.prepared + line.sentToGbegamey);
}

function hasActivity(row: Omit<StockRow, "zone" | "zoneLabel" | "kind">): boolean {
  return (
    row.opening > 0 ||
    row.entrees > 0 ||
    row.envoye > 0 ||
    row.vendu > 0 ||
    row.pertes > 0 ||
    row.stockFinal !== 0 ||
    (row.stockVendable !== null && row.stockVendable !== 0) ||
    row.compte !== null
  );
}

function pushRow(rows: StockRow[], row: StockRow, onlyActive: boolean) {
  if (!onlyActive || hasActivity(row)) rows.push(row);
}

function buildZoneTotals(rows: StockRow[]): StockZoneTotal[] {
  const byZone = new Map<StockZone, StockZoneTotal>();
  for (const row of rows) {
    const existing = byZone.get(row.zone) ?? {
      zone: row.zone,
      zoneLabel: row.zoneLabel,
      lignes: 0,
      stockFinal: 0,
      stockVendable: row.stockVendable !== null ? 0 : null,
      vendu: 0,
      ecarts: 0,
    };
    existing.lignes += 1;
    existing.stockFinal += row.stockFinal;
    if (existing.stockVendable !== null && row.stockVendable !== null) {
      existing.stockVendable += row.stockVendable;
    }
    existing.vendu += row.vendu;
    if (row.ecart !== null && row.ecart !== 0) existing.ecarts += 1;
    byZone.set(row.zone, existing);
  }
  return [...byZone.values()].sort((a, b) =>
    a.zoneLabel.localeCompare(b.zoneLabel, "fr"),
  );
}

export async function getStockPayload(input: {
  date: string;
  scopeSite?: VenteSite | null;
  /** false = tout le catalogue ; true = lignes avec stock ou mouvement */
  onlyActive?: boolean;
}): Promise<StockPayload> {
  const { date, scopeSite = null, onlyActive = true } = input;
  if (!isValidDate(date)) throw new Error("Date invalide (attendu YYYY-MM-DD)");

  const parametres = await getParametres();
  const priceLocal = new Map(
    parametres.localDishes.map((d) => [d.id, d.unitPrice]),
  );

  const rows: StockRow[] = [];
  let zogboStatus: string | null = null;
  let gbegameyStatus: string | null = null;

  if (scopeSite !== "gbegamey") {
    const { day } = await getZogboDayPayload(date);
    zogboStatus = day.status;
    const computed = computeZogboDay(day, parametres.baseDishes);

    for (const line of computed.lines) {
      const opening = zogboOpeningStock(line);
      const stockVendable = physicalStock(line);
      const row: StockRow = {
        zone: "zogbo-plats",
        zoneLabel: "Zogbo · plats",
        productId: line.productId,
        name: line.name,
        kind: "plat",
        opening,
        entrees: line.prepared,
        envoye: line.sentToGbegamey,
        vendu: line.sold,
        pertes: line.pertes,
        stockFinal: line.theoreticalRemaining,
        stockVendable,
        compte: line.counted,
        ecart: line.variance,
        unit: "portions",
      };
      pushRow(rows, row, onlyActive);
    }

    const accLines = day.accompanimentLines ?? [];
    for (const raw of accLines) {
      const line = computeLocalLine(
        raw,
        priceLocal.get(raw.productId) ?? 0,
      );
      const row: StockRow = {
        zone: "zogbo-accompagnements",
        zoneLabel: "Zogbo · accompagnements",
        productId: line.productId,
        name: line.name,
        kind: "local",
        opening: line.initialStock,
        entrees: line.prepared,
        envoye: 0,
        vendu: line.sold,
        pertes: line.pertes,
        stockFinal: line.theoreticalRemaining,
        stockVendable: line.theoreticalRemaining,
        compte: line.counted,
        ecart: line.variance,
        unit: "portions",
      };
      pushRow(rows, row, onlyActive);
    }
  }

  if (scopeSite !== "zogbo") {
    const gb = await getGbegameyDayPayload(date);
    gbegameyStatus = gb.day.status;
    const computed = computeGbegameyDay(
      gb.day,
      parametres.baseDishes,
      parametres.localDishes,
      new Map(Object.entries(gb.sentByProductId)),
    );

    for (const line of computed.transfers) {
      const row: StockRow = {
        zone: "gbegamey-plats",
        zoneLabel: "Gbégamey · plats reçus",
        productId: line.productId,
        name: line.name,
        kind: "plat",
        opening: line.initialStock,
        entrees: line.receivedFromZogbo,
        envoye: 0,
        vendu: line.sold,
        pertes: line.pertes,
        stockFinal: line.theoreticalRemaining,
        stockVendable: line.theoreticalRemaining,
        compte: line.counted,
        ecart: line.variance,
        unit: "portions",
      };
      pushRow(rows, row, onlyActive);
    }

    for (const line of computed.locals) {
      const row: StockRow = {
        zone: "gbegamey-accompagnements",
        zoneLabel: "Gbégamey · accompagnements",
        productId: line.productId,
        name: line.name,
        kind: "local",
        opening: line.initialStock,
        entrees: line.prepared,
        envoye: 0,
        vendu: line.sold,
        pertes: line.pertes,
        stockFinal: line.theoreticalRemaining,
        stockVendable: line.theoreticalRemaining,
        compte: line.counted,
        ecart: line.variance,
        unit: "portions",
      };
      pushRow(rows, row, onlyActive);
    }
  }

  return {
    date,
    scopeSite,
    rows,
    totalsByZone: buildZoneTotals(rows),
    dayStatus: {
      zogbo: zogboStatus,
      gbegamey: gbegameyStatus,
    },
  };
}
