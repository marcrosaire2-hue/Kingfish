import type { ComptageRef } from "@/lib/stock-comptage";
import {
  mapComptageToStockEvent,
} from "@/lib/stock-ledger-map";
import type {
  StockEvent,
  StockLedgerFamily,
  StockLedgerUnit,
} from "@/lib/stock-ledger";
import type { VenteSite } from "@/lib/types";

export type CountableLine = {
  productId: string;
  name: string;
  counted: number | null;
  comptage?: ComptageRef;
};

/**
 * Traduit les comptages d'un tableau de lignes en événements de journal.
 *
 * L'horodatage vient du repère de comptage (`comptage.at`). Un comptage
 * ancien, sans horodatage, est ignoré : on ne peut pas le replacer dans le
 * temps sans risquer de fausser le rejeu.
 */
export function comptageEventsFromLines(input: {
  site: VenteSite;
  date: string;
  family: StockLedgerFamily;
  unit: StockLedgerUnit;
  lines: readonly CountableLine[];
}): StockEvent[] {
  const events: StockEvent[] = [];
  for (const line of input.lines) {
    if (line.counted === null || line.counted === undefined) continue;
    const at = line.comptage?.at;
    if (!at || Number.isNaN(Date.parse(at))) continue;
    events.push(
      mapComptageToStockEvent({
        site: input.site,
        family: input.family,
        productId: line.productId,
        name: line.name,
        qty: line.counted,
        unit: input.unit,
        at,
        date: input.date,
        reference: `${input.date}@${at}`,
      }),
    );
  }
  return events;
}

/** Comptages boissons : le comptage est en bouteilles pour le site concerné. */
export function boissonsComptageEvents(input: {
  site: VenteSite;
  date: string;
  lines: readonly {
    productId: string;
    name: string;
    countedZogbo: number | null;
    countedGbegamey: number | null;
    comptageZogbo?: ComptageRef;
    comptageGbegamey?: ComptageRef;
  }[];
}): StockEvent[] {
  const zogbo = input.site === "zogbo";
  return comptageEventsFromLines({
    site: input.site,
    date: input.date,
    family: "boisson",
    unit: "bt",
    lines: input.lines.map((line) => ({
      productId: line.productId,
      name: line.name,
      counted: zogbo ? line.countedZogbo : line.countedGbegamey,
      comptage: zogbo ? line.comptageZogbo : line.comptageGbegamey,
    })),
  });
}
