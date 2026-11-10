import {
  stockEventDirection,
  stockLedgerKey,
  type StockEvent,
  type StockLedgerFamily,
  type StockLedgerUnit,
} from "@/lib/stock-ledger";
import type { VenteSite } from "@/lib/types";

/**
 * Réparation d'un stock à partir d'une ancre.
 *
 * Une ancre est un comptage physique jugé fiable : à son horodatage, le stock
 * vaut exactement la quantité comptée. On rejoue ensuite les événements
 * postérieurs pour obtenir le stock attendu, puis on le compare au comptage
 * suivant. Aucun solde n'est borné : un attendu négatif est un signal.
 */

export type StockAnchor = {
  site: VenteSite;
  family: StockLedgerFamily;
  productId: string;
  name: string;
  unit: StockLedgerUnit;
  qty: number;
  at: string;
};

export type StockRepairReplay = {
  anchor: StockAnchor;
  /** Stock attendu après rejeu (peut être négatif). */
  expected: number;
  /** Mouvements pris en compte (strictement après l'ancre). */
  movements: StockEvent[];
  /** Événements du même produit ignorés car antérieurs ou égaux à l'ancre. */
  ignoredBeforeAnchor: StockEvent[];
  /** Comptages rencontrés après l'ancre (ils réécrivent le stock). */
  countsAfterAnchor: number;
  lastCountAt: string | null;
  lastEcart: number | null;
  /** Vrai si l'attendu est négatif : survente ou sortie non déclarée. */
  negative: boolean;
  /** Clés d'idempotence dupliquées dans le flux considéré. */
  duplicateKeys: string[];
};

function anchorKey(anchor: StockAnchor): string {
  return stockLedgerKey(anchor);
}

function sameKey(event: StockEvent, anchor: StockAnchor): boolean {
  return stockLedgerKey(event) === anchorKey(anchor);
}

function sortByAtThenId(a: StockEvent, b: StockEvent): number {
  if (a.at !== b.at) return a.at < b.at ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function assertAt(at: string, label: string): void {
  if (!at || Number.isNaN(Date.parse(at))) {
    throw new Error(`${label} : horodatage invalide (${at}).`);
  }
}

/**
 * Rejoue les événements d'un produit à partir de l'ancre.
 *
 * `until` est une borne exclusive (utile pour comparer à un comptage sans
 * inclure ce comptage lui-même). Les événements à l'instant exact de l'ancre
 * sont ignorés : l'ancre fait foi à cet instant.
 */
export function replayStockFromAnchor(input: {
  anchor: StockAnchor;
  events: readonly StockEvent[];
  until?: string | null;
}): StockRepairReplay {
  const { anchor, events } = input;
  assertAt(anchor.at, "Ancre");
  if (!Number.isFinite(anchor.qty)) {
    throw new Error("Ancre : quantité invalide.");
  }
  const until = input.until ?? null;
  if (until !== null) assertAt(until, "Borne de rejeu");

  const movements: StockEvent[] = [];
  const ignoredBeforeAnchor: StockEvent[] = [];
  for (const event of events) {
    if (!sameKey(event, anchor)) continue;
    if (event.at <= anchor.at) {
      ignoredBeforeAnchor.push(event);
      continue;
    }
    if (until !== null && event.at >= until) continue;
    movements.push(event);
  }
  movements.sort(sortByAtThenId);
  ignoredBeforeAnchor.sort(sortByAtThenId);

  const seen = new Set<string>();
  const duplicateKeys: string[] = [];
  let expected = anchor.qty;
  let countsAfterAnchor = 0;
  let lastCountAt: string | null = null;
  let lastEcart: number | null = null;

  for (const event of movements) {
    const key = `${event.site}:${event.idempotencyKey}`;
    if (seen.has(key)) {
      duplicateKeys.push(key);
      continue;
    }
    seen.add(key);

    if (event.type === "comptage") {
      lastEcart = round4(event.qty - expected);
      expected = round4(event.qty);
      countsAfterAnchor += 1;
      lastCountAt = event.at;
      continue;
    }
    expected = round4(
      expected + stockEventDirection(event.type) * event.qty,
    );
  }

  return {
    anchor,
    expected,
    movements,
    ignoredBeforeAnchor,
    countsAfterAnchor,
    lastCountAt,
    lastEcart,
    negative: expected < 0,
    duplicateKeys,
  };
}

export type StockRepairComparison = StockRepairReplay & {
  count: StockEvent;
  /**
   * `counted − expected` : positif = stock physique en excès (entrée non
   * déclarée), négatif = manquant (vente/perte non déclarée).
   */
  variance: number;
};

/** Compare le stock attendu à un comptage postérieur, sans inclure ce comptage. */
export function compareRepairToCount(input: {
  anchor: StockAnchor;
  count: StockEvent;
  events: readonly StockEvent[];
}): StockRepairComparison {
  const { anchor, count, events } = input;
  assertAt(count.at, "Comptage");
  if (stockLedgerKey(count) !== anchorKey(anchor)) {
    throw new Error(
      "Le comptage et l'ancre ne portent pas sur le même site/famille/produit.",
    );
  }
  if (count.at <= anchor.at) {
    throw new Error("Le comptage de contrôle doit être postérieur à l'ancre.");
  }
  const replay = replayStockFromAnchor({
    anchor,
    events,
    until: count.at,
  });
  return {
    ...replay,
    count,
    variance: round4(count.qty - replay.expected),
  };
}

export type StockRepairReportLine = StockRepairComparison & {
  countId: string;
  /** Le comptage de contrôle est cohérent avec le rejeu. */
  ok: boolean;
};

/**
 * Construit le rapport de réparation d'un site : une ligne par comptage de
 * contrôle postérieur à chaque ancre. Les produits sans ancre ne sont pas
 * réparables et ne figurent pas dans le rapport.
 */
export function buildStockRepairReport(input: {
  site: VenteSite;
  anchors: readonly StockAnchor[];
  counts: readonly StockEvent[];
  events: readonly StockEvent[];
}): StockRepairReportLine[] {
  const lines: StockRepairReportLine[] = [];
  for (const anchor of input.anchors) {
    if (anchor.site !== input.site) continue;
    const laterCounts = input.counts
      .filter(
        (count) =>
          count.site === input.site &&
          count.type === "comptage" &&
          stockLedgerKey(count) === anchorKey(anchor) &&
          count.at > anchor.at,
      )
      .sort(sortByAtThenId);
    for (const count of laterCounts) {
      const comparison = compareRepairToCount({
        anchor,
        count,
        events: input.events,
      });
      lines.push({
        ...comparison,
        countId: count.id,
        ok: comparison.variance === 0 && !comparison.negative,
      });
    }
  }
  return lines;
}
