import { describe, expect, it } from "vitest";
import {
  buildJournalBalance,
  buildJournalTotals,
  type JournalRow,
} from "@/lib/journal-stock-repo";

function row(overrides: Partial<JournalRow>): JournalRow {
  return {
    id: "x",
    at: "2026-08-14T10:00:00.000Z",
    date: "2026-08-14",
    site: "zogbo",
    type: "vente",
    kind: "plat",
    productId: "p1",
    name: "Poisson braisé",
    qty: 2,
    direction: -1,
    unitPrice: 1500,
    montant: 3000,
    annule: false,
    detail: "",
    acteur: null,
    equipe: null,
    ...overrides,
  };
}

describe("journal des mouvements de stock", () => {
  it("compte entrées et sorties avec le signe de la direction", () => {
    const totals = buildJournalTotals([
      row({ type: "vente", qty: 3, direction: -1, montant: 4500 }),
      row({ type: "achat", qty: 10, direction: 1, montant: 5000 }),
      row({ type: "perte", qty: 1, direction: -1, montant: 1500 }),
      row({
        type: "reception",
        site: "gbegamey",
        qty: 8,
        direction: 1,
        montant: 0,
      }),
    ]);

    expect(totals.count).toBe(4);
    expect(totals.qtyEntrees).toBe(18);
    expect(totals.qtySorties).toBe(4);
    expect(totals.montant).toBe(11000);
    expect(totals.byType.vente.count).toBe(1);
    expect(totals.byType.vente.qty).toBe(3);
    expect(totals.byType.vente.montant).toBe(4500);
    expect(totals.byType.reception.qty).toBe(8);
  });

  it("une vente annulée devient une entrée (retour en stock)", () => {
    const totals = buildJournalTotals([
      row({ type: "vente", qty: 2, direction: -1, montant: 3000 }),
      row({ type: "vente", qty: 2, direction: 1, montant: 3000, annule: true }),
    ]);
    expect(totals.qtySorties).toBe(2);
    expect(totals.qtyEntrees).toBe(2);
  });

  it("calcule le solde par produit, hors mouvements annulés", () => {
    const balance = buildJournalBalance([
      row({
        productId: "p1",
        name: "Poisson braisé",
        qty: 5,
        direction: -1,
        montant: 7500,
      }),
      row({
        type: "achat",
        productId: "p1",
        name: "Poisson braisé",
        qty: 8,
        direction: 1,
        montant: 6000,
      }),
      row({
        type: "vente",
        productId: "p1",
        name: "Poisson braisé",
        qty: 2,
        direction: 1,
        montant: 3000,
        annule: true,
      }),
      row({
        productId: "p2",
        name: "Riz blanc",
        qty: 3,
        direction: -1,
        montant: 900,
      }),
    ]);

    expect(balance).toHaveLength(2);
    const poisson = balance.find((b) => b.productId === "p1")!;
    expect(poisson.entrees).toBe(8);
    expect(poisson.sorties).toBe(5);
    expect(poisson.solde).toBe(3);
    expect(poisson.montant).toBe(13500);
    const riz = balance.find((b) => b.productId === "p2")!;
    expect(riz.solde).toBe(-3);
  });
});