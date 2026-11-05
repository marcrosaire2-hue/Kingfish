import { describe, expect, it } from "vitest";
import { classerFamille } from "@/lib/point-ventes-calc";

const catalogue = [
  { id: "a", name: "Alloco" },
  { id: "b", name: "Riz" },
  { id: "c", name: "Atassi" },
  { id: "d", name: "Piron" },
  { id: "e", name: "Placali" },
];

describe("Point des ventes — classement", () => {
  it("classe du mieux vendu au moins vendu", () => {
    const r = classerFamille(catalogue, [
      { productId: "b", name: "Riz", qty: 12, amount: 6000 },
      { productId: "a", name: "Alloco", qty: 30, amount: 15000 },
      { productId: "d", name: "Piron", qty: 2, amount: 1000 },
      { productId: "e", name: "Placali", qty: 5, amount: 2500 },
    ], 2);
    expect(r.top.map((x) => x.name)).toEqual(["Alloco", "Riz"]);
    // Les moins vendus : parmi ceux qui ont vendu, sans répéter le top.
    expect(r.flop.map((x) => x.name)).toEqual(["Piron", "Placali"]);
  });

  it("peu d’articles vendus : partagés entre mieux et moins vendus", () => {
    const r = classerFamille(catalogue, [
      { productId: "a", name: "Alloco", qty: 25, amount: 0 },
      { productId: "b", name: "Riz", qty: 7, amount: 0 },
      { productId: "c", name: "Atassi", qty: 6, amount: 0 },
      { productId: "d", name: "Piron", qty: 5, amount: 0 },
      { productId: "e", name: "Placali", qty: 2, amount: 0 },
    ], 10);
    expect(r.top.map((x) => x.name)).toEqual(["Alloco", "Riz", "Atassi"]);
    expect(r.flop.map((x) => x.name)).toEqual(["Placali", "Piron"]);
  });

  it("liste à part tous les articles jamais vendus", () => {
    const r = classerFamille(catalogue, [
      { productId: "a", name: "Alloco", qty: 1, amount: 500 },
    ]);
    expect(r.jamaisVendusListe.map((x) => x.name)).toEqual(["Atassi", "Piron", "Placali", "Riz"]);
    expect(r.jamaisVendus).toBe(4);
    expect(r.vendus).toBe(1);
    expect(r.flop).toEqual([]);
  });

  it("une correction qui annule la vente compte comme jamais vendu", () => {
    const r = classerFamille(catalogue, [
      { productId: "a", name: "Alloco", qty: 2, amount: 1000 },
      { productId: "a", name: "Alloco", qty: -2, amount: -1000 },
    ]);
    expect(r.vendus).toBe(0);
    expect(r.jamaisVendusListe.some((x) => x.name === "Alloco")).toBe(true);
    expect(r.qty).toBe(0);
  });

  it("garde un article vendu absent du catalogue", () => {
    const r = classerFamille(catalogue, [
      { productId: "z", name: "Ancien plat", qty: 4, amount: 2000 },
    ]);
    expect(r.top[0]?.name).toBe("Ancien plat");
    expect(r.total).toBe(6);
    expect(r.amount).toBe(2000);
  });
});
