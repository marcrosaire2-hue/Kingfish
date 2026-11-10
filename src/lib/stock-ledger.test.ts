import { describe, expect, it } from "vitest";
import {
  applyStockEvents,
  dedupeStockEvents,
  listStockBalances,
  stockEventDirection,
  type StockEvent,
} from "@/lib/stock-ledger";

let seq = 0;
function ev(partial: Partial<StockEvent> & Pick<StockEvent, "type" | "qty">): StockEvent {
  seq += 1;
  return {
    id: `e${String(seq).padStart(4, "0")}`,
    site: "zogbo",
    family: "boisson",
    productId: "coca",
    name: "Coca",
    unit: "bt",
    at: `2026-11-10T0${Math.min(9, seq % 10)}:00:00.000Z`,
    date: "2026-11-10",
    idempotencyKey: `k${seq}`,
    ...partial,
  };
}

describe("journal d'événements de stock", () => {
  it("entrées − ventes − pertes, sans stock stocké", () => {
    const events = [
      ev({ type: "stock_initial", qty: 10, at: "2026-11-10T07:00:00.000Z" }),
      ev({ type: "entree", qty: 5, at: "2026-11-10T08:00:00.000Z" }),
      ev({ type: "vente", qty: 3, at: "2026-11-10T09:00:00.000Z" }),
      ev({ type: "perte", qty: 1, at: "2026-11-10T10:00:00.000Z" }),
    ];
    const [b] = listStockBalances(events);
    expect(b!.stock).toBe(11);
    expect(b!.entrees).toBe(15);
    expect(b!.ventes).toBe(3);
    expect(b!.pertes).toBe(1);
    expect(b!.lastCounted).toBeNull();
  });

  it("le comptage écrit le stock et fige l'écart une seule fois", () => {
    const events = [
      ev({ type: "stock_initial", qty: 10, at: "2026-11-10T07:00:00.000Z" }),
      ev({ type: "vente", qty: 4, at: "2026-11-10T08:00:00.000Z" }),
      // Théorique 6, compté 9 → écart +3, stock = 9.
      ev({
        type: "comptage",
        qty: 9,
        at: "2026-11-10T09:00:00.000Z",
        source: "inventaire",
      }),
      // Vente après le comptage : s'applique au stock compté.
      ev({ type: "vente", qty: 2, at: "2026-11-10T10:00:00.000Z" }),
    ];
    const [b] = listStockBalances(events);
    expect(b!.lastCounted).toBe(9);
    expect(b!.lastEcart).toBe(3);
    expect(b!.stock).toBe(7);
    expect(b!.counts).toBe(1);
  });

  it("le dernier écart reste celui du dernier comptage, sans recalcul", () => {
    const events = [
      ev({
        type: "comptage",
        qty: 10,
        at: "2026-11-10T08:00:00.000Z",
      }),
      ev({
        type: "comptage",
        qty: 4,
        at: "2026-11-10T09:00:00.000Z",
      }),
      ev({ type: "vente", qty: 1, at: "2026-11-10T10:00:00.000Z" }),
    ];
    const [b] = listStockBalances(events);
    // 1er comptage : 10 − 0 = +10 ; 2e : 4 − 10 = −6.
    expect(b!.lastEcart).toBe(-6);
    expect(b!.stock).toBe(3);
  });

  it("ne borne pas le négatif : une survente reste visible", () => {
    const events = [
      ev({ type: "stock_initial", qty: 2, at: "2026-11-10T07:00:00.000Z" }),
      ev({ type: "vente", qty: 5, at: "2026-11-10T08:00:00.000Z" }),
      ev({ type: "comptage", qty: 0, at: "2026-11-10T09:00:00.000Z" }),
      ev({ type: "vente", qty: 1, at: "2026-11-10T10:00:00.000Z" }),
    ];
    const [b] = listStockBalances(events);
    // Le comptage remet à 0, la vente suivante passe à −1.
    expect(b!.stock).toBe(-1);
    expect(b!.lastEcart).toBe(3);
  });

  it("production et annulation", () => {
    const events = [
      ev({ type: "production", qty: 6, family: "plat", unit: "portion" }),
      ev({ type: "vente", qty: 2, family: "plat", unit: "portion" }),
      ev({ type: "annulation", qty: 1, family: "plat", unit: "portion" }),
    ];
    const [b] = listStockBalances(events);
    expect(b!.production).toBe(6);
    expect(b!.annulations).toBe(1);
    expect(b!.stock).toBe(5);
  });

  it("borne temporelle `at`", () => {
    const events = [
      ev({ type: "stock_initial", qty: 10, at: "2026-11-10T07:00:00.000Z" }),
      ev({ type: "vente", qty: 4, at: "2026-11-10T12:00:00.000Z" }),
    ];
    const [avant] = listStockBalances(events, { at: "2026-11-10T09:00:00.000Z" });
    const [apres] = listStockBalances(events, { at: "2026-11-10T23:00:00.000Z" });
    expect(avant!.stock).toBe(10);
    expect(apres!.stock).toBe(6);
  });

  it("sépare les sites et les produits", () => {
    const events = [
      ev({ type: "entree", qty: 10, site: "zogbo" }),
      ev({ type: "entree", qty: 3, site: "gbegamey" }),
      ev({ type: "entree", qty: 4, site: "zogbo", productId: "fanta", name: "Fanta" }),
    ];
    const balances = applyStockEvents(events);
    expect(balances.get("zogbo:boisson:coca")!.stock).toBe(10);
    expect(balances.get("gbegamey:boisson:coca")!.stock).toBe(3);
    expect(balances.get("zogbo:boisson:fanta")!.stock).toBe(4);
  });

  it("rejette les quantités négatives et les horodatages invalides", () => {
    expect(() => applyStockEvents([ev({ type: "vente", qty: -1 })])).toThrow(
      /négative/,
    );
    expect(() =>
      applyStockEvents([
        ev({ type: "vente", qty: 1, at: "pas-une-date" }),
      ]),
    ).toThrow(/Horodatage/);
  });

  it("dédoublonne par clé d'idempotence (site + clé)", () => {
    const a = ev({ type: "vente", qty: 2, idempotencyKey: "vente:1" });
    const b = ev({
      type: "vente",
      qty: 2,
      idempotencyKey: "vente:1",
      id: "autre",
    });
    const c = ev({
      type: "vente",
      qty: 2,
      idempotencyKey: "vente:1",
      site: "gbegamey",
    });
    expect(dedupeStockEvents([a, b, c])).toHaveLength(2);
  });

  it("direction par type d'événement", () => {
    expect(stockEventDirection("entree")).toBe(1);
    expect(stockEventDirection("production")).toBe(1);
    expect(stockEventDirection("vente")).toBe(-1);
    expect(stockEventDirection("perte")).toBe(-1);
    expect(stockEventDirection("comptage")).toBe(0);
  });
});
