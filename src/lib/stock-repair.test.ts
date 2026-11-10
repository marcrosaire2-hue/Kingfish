import { describe, expect, it } from "vitest";
import {
  buildStockRepairReport,
  compareRepairToCount,
  replayStockFromAnchor,
  type StockAnchor,
} from "@/lib/stock-repair";
import type { StockEvent, StockEventType } from "@/lib/stock-ledger";

let seq = 0;

function event(
  patch: Partial<StockEvent> & {
    type: StockEventType;
    qty: number;
    at: string;
  },
): StockEvent {
  seq += 1;
  return {
    id: `e${seq}`,
    site: "zogbo",
    family: "boisson",
    productId: "b1",
    name: "Boisson",
    unit: "bt",
    date: "2026-08-10",
    idempotencyKey: `k${seq}`,
    ...patch,
  };
}

const anchor: StockAnchor = {
  site: "zogbo",
  family: "boisson",
  productId: "b1",
  name: "Boisson",
  unit: "bt",
  qty: 10,
  at: "2026-08-10T10:00:00.000Z",
};

describe("replayStockFromAnchor", () => {
  it("ignore les événements antérieurs ou égaux à l'ancre", () => {
    const r = replayStockFromAnchor({
      anchor,
      events: [
        event({ type: "vente", qty: 5, at: "2026-08-10T09:00:00.000Z" }),
        event({
          type: "comptage",
          qty: 10,
          at: "2026-08-10T10:00:00.000Z",
        }),
        event({ type: "vente", qty: 2, at: "2026-08-10T11:00:00.000Z" }),
        event({ type: "entree", qty: 3, at: "2026-08-10T12:00:00.000Z" }),
      ],
    });
    expect(r.expected).toBe(11);
    expect(r.movements).toHaveLength(2);
    expect(r.ignoredBeforeAnchor).toHaveLength(2);
  });

  it("rejoue ventes, entrées, pertes et reprises sans borne", () => {
    const r = replayStockFromAnchor({
      anchor,
      events: [
        event({ type: "vente", qty: 4, at: "2026-08-10T11:00:00.000Z" }),
        event({ type: "entree", qty: 6, at: "2026-08-10T11:30:00.000Z" }),
        event({ type: "perte", qty: 1, at: "2026-08-10T11:45:00.000Z" }),
        event({ type: "annulation", qty: 2, at: "2026-08-10T11:50:00.000Z" }),
      ],
    });
    expect(r.expected).toBe(13);
    expect(r.negative).toBe(false);
  });

  it("un comptage postérieur réécrit le stock et fige son écart", () => {
    const r = replayStockFromAnchor({
      anchor,
      events: [
        event({ type: "vente", qty: 4, at: "2026-08-10T11:00:00.000Z" }),
        event({
          type: "comptage",
          qty: 8,
          at: "2026-08-10T12:00:00.000Z",
          idempotencyKey: "comptage-1",
        }),
      ],
    });
    expect(r.expected).toBe(8);
    expect(r.countsAfterAnchor).toBe(1);
    expect(r.lastEcart).toBe(2);
    expect(r.lastCountAt).toBe("2026-08-10T12:00:00.000Z");
  });

  it("conserve un attendu négatif au lieu de le borner à zéro", () => {
    const r = replayStockFromAnchor({
      anchor: { ...anchor, qty: 1 },
      events: [
        event({ type: "vente", qty: 5, at: "2026-08-10T11:00:00.000Z" }),
      ],
    });
    expect(r.expected).toBe(-4);
    expect(r.negative).toBe(true);
  });

  it("exclut la borne `until`", () => {
    const r = replayStockFromAnchor({
      anchor,
      events: [
        event({ type: "vente", qty: 2, at: "2026-08-10T11:00:00.000Z" }),
        event({ type: "vente", qty: 3, at: "2026-08-10T12:00:00.000Z" }),
      ],
      until: "2026-08-10T12:00:00.000Z",
    });
    expect(r.expected).toBe(8);
  });

  it("dédoublonne les clés d'idempotence et les signale", () => {
    const r = replayStockFromAnchor({
      anchor,
      events: [
        event({
          type: "vente",
          qty: 2,
          at: "2026-08-10T11:00:00.000Z",
          idempotencyKey: "vente:1",
        }),
        event({
          type: "vente",
          qty: 2,
          at: "2026-08-10T11:00:00.000Z",
          idempotencyKey: "vente:1",
        }),
      ],
    });
    expect(r.expected).toBe(8);
    expect(r.movements).toHaveLength(2);
    expect(r.duplicateKeys).toEqual(["zogbo:vente:1"]);
  });

  it("ne mélange jamais les sites, familles ou produits", () => {
    const r = replayStockFromAnchor({
      anchor,
      events: [
        event({
          site: "gbegamey",
          type: "vente",
          qty: 9,
          at: "2026-08-10T11:00:00.000Z",
        }),
        event({
          family: "matiere",
          type: "vente",
          qty: 9,
          at: "2026-08-10T11:00:00.000Z",
        }),
        event({
          productId: "b2",
          type: "vente",
          qty: 9,
          at: "2026-08-10T11:00:00.000Z",
        }),
      ],
    });
    expect(r.expected).toBe(10);
    expect(r.movements).toHaveLength(0);
  });
});

describe("compareRepairToCount", () => {
  it("calcule un manquant négatif sans inclure le comptage", () => {
    const count = event({
      type: "comptage",
      qty: 6,
      at: "2026-08-10T12:00:00.000Z",
    });
    const r = compareRepairToCount({
      anchor,
      count,
      events: [event({ type: "vente", qty: 3, at: "2026-08-10T11:00:00.000Z" }), count],
    });
    expect(r.expected).toBe(7);
    expect(r.variance).toBe(-1);
  });

  it("signale un excès physique positif", () => {
    const count = event({
      type: "comptage",
      qty: 9,
      at: "2026-08-10T12:00:00.000Z",
    });
    const r = compareRepairToCount({
      anchor,
      count,
      events: [event({ type: "vente", qty: 3, at: "2026-08-10T11:00:00.000Z" }), count],
    });
    expect(r.variance).toBe(2);
  });

  it("refuse un comptage antérieur ou sur un autre produit", () => {
    expect(() =>
      compareRepairToCount({
        anchor,
        count: event({
          type: "comptage",
          qty: 1,
          at: "2026-08-10T09:00:00.000Z",
        }),
        events: [],
      }),
    ).toThrow(/postérieur/);
    expect(() =>
      compareRepairToCount({
        anchor,
        count: event({
          productId: "b2",
          type: "comptage",
          qty: 1,
          at: "2026-08-10T12:00:00.000Z",
        }),
        events: [],
      }),
    ).toThrow(/même site/);
  });
});

describe("buildStockRepairReport", () => {
  it("produit une ligne par comptage de contrôle du site", () => {
    const c1 = event({
      type: "comptage",
      qty: 7,
      at: "2026-08-10T12:00:00.000Z",
    });
    const c2 = event({
      type: "comptage",
      qty: 5,
      at: "2026-08-10T13:00:00.000Z",
    });
    const report = buildStockRepairReport({
      site: "zogbo",
      anchors: [anchor],
      counts: [c1, c2],
      events: [
        event({ type: "vente", qty: 3, at: "2026-08-10T11:00:00.000Z" }),
        event({ type: "vente", qty: 2, at: "2026-08-10T12:30:00.000Z" }),
        c1,
        c2,
      ],
    });
    expect(report).toHaveLength(2);
    expect(report[0]!.countId).toBe(c1.id);
    expect(report[0]!.variance).toBe(0);
    expect(report[0]!.ok).toBe(true);
    expect(report[1]!.variance).toBe(0);
  });

  it("ignore les ancres et comptages des autres sites", () => {
    const report = buildStockRepairReport({
      site: "zogbo",
      anchors: [{ ...anchor, site: "gbegamey" }],
      counts: [
        event({
          site: "gbegamey",
          type: "comptage",
          qty: 1,
          at: "2026-08-10T12:00:00.000Z",
        }),
      ],
      events: [],
    });
    expect(report).toHaveLength(0);
  });
});
