import { describe, expect, it } from "vitest";
import {
  computeCombosLine,
  normalizeCombosLine,
  physicalComboStockGbegamey,
  physicalComboStockZogbo,
} from "@/lib/combos-calc";
import type { CombosLine } from "@/lib/types";

function ligne(patch: Partial<CombosLine> = {}): CombosLine {
  return {
    productId: "combo-poisson-frites",
    name: "POISSON + FRITES",
    baseDishName: null,
    stockZogbo: 0,
    prepared: 0,
    sentToGbegamey: 0,
    soldZogbo: 0,
    pertesZogbo: 0,
    countedZogbo: null,
    initialGbegamey: 0,
    soldGbegamey: 0,
    pertesGbegamey: 0,
    countedGbegamey: null,
    observations: "",
    ...patch,
  };
}

describe("stock physique par point de vente", () => {
  it("Zogbo : ce qui est en stock moins ce qui y a été vendu", () => {
    expect(physicalComboStockZogbo({ stockZogbo: 10, soldZogbo: 4 })).toBe(6);
  });

  it("Gbégamey : le reste de la veille plus le reçu, moins les ventes", () => {
    expect(
      physicalComboStockGbegamey({
        initialGbegamey: 3,
        sentToGbegamey: 7,
        soldGbegamey: 5,
      }),
    ).toBe(5);
  });

  it("les deux points sont indépendants", () => {
    // Vendre à Zogbo ne doit rien retirer au stock de Gbégamey.
    const l = ligne({
      stockZogbo: 10,
      soldZogbo: 10,
      initialGbegamey: 4,
      sentToGbegamey: 0,
    });
    expect(physicalComboStockZogbo(l)).toBe(0);
    expect(physicalComboStockGbegamey(l)).toBe(4);
  });
});

describe("computeCombosLine", () => {
  it("valorise le total vendu sur les deux points", () => {
    const c = computeCombosLine(
      ligne({ stockZogbo: 10, soldZogbo: 3, initialGbegamey: 10, soldGbegamey: 2 }),
      2500,
    );
    expect(c.soldTotal).toBe(5);
    expect(c.soldAmount).toBe(5 * 2500);
  });

  it("mesure un écart de comptage par point de vente", () => {
    const c = computeCombosLine(
      ligne({
        stockZogbo: 10,
        soldZogbo: 2,
        countedZogbo: 7,
        initialGbegamey: 5,
        soldGbegamey: 1,
        countedGbegamey: 4,
      }),
      2500,
    );
    expect(c.varianceZogbo).toBe(1);
    expect(c.varianceGbegamey).toBe(0);
  });

  it("ne calcule aucun écart tant que rien n'est compté", () => {
    const c = computeCombosLine(ligne({ stockZogbo: 5 }), 2500);
    expect(c.varianceZogbo).toBeNull();
    expect(c.varianceGbegamey).toBeNull();
  });
});

describe("normalizeCombosLine", () => {
  it("ramène les quantités négatives à zéro", () => {
    const l = normalizeCombosLine(
      ligne({ stockZogbo: -2, soldGbegamey: -8, initialGbegamey: -1 }),
    );
    expect(l.stockZogbo).toBe(0);
    expect(l.soldGbegamey).toBe(0);
    expect(l.initialGbegamey).toBe(0);
  });

  it("distingue un comptage nul d'une absence de comptage", () => {
    expect(normalizeCombosLine(ligne({ countedZogbo: 0 })).countedZogbo).toBe(0);
    expect(
      normalizeCombosLine(ligne({ countedZogbo: null })).countedZogbo,
    ).toBeNull();
  });
});
