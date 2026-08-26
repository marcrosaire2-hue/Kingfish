import { describe, expect, it } from "vitest";

/**
 * Tests purs sur le format de réponse attendu (sans Mongo) :
 * la page et l’export s’appuient sur ces champs.
 */
describe("quantités vendues — contrat de données", () => {
  it("trie les articles par quantité décroissante côté client si besoin", () => {
    const rows = [
      { name: "A", qty: 2 },
      { name: "B", qty: 10 },
      { name: "C", qty: 5 },
    ];
    const sorted = [...rows].sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));
    expect(sorted.map((r) => r.name)).toEqual(["B", "C", "A"]);
  });

  it("agrège les totaux", () => {
    const rows = [
      { qty: 4, amount: 6000, lignes: 2 },
      { qty: 5, amount: 7500, lignes: 3 },
    ];
    const totals = rows.reduce(
      (acc: { articles: number; qty: number; amount: number; lignes: number }, r) => {
        acc.qty += r.qty;
        acc.amount += r.amount;
        acc.lignes += r.lignes;
        return acc;
      },
      { articles: rows.length, qty: 0, amount: 0, lignes: 0 },
    );
    expect(totals).toEqual({
      articles: 2,
      qty: 9,
      amount: 13500,
      lignes: 5,
    });
  });
});
