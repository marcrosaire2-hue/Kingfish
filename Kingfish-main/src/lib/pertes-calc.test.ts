import { describe, expect, it } from "vitest";
import {
  physicalBoissonsStockForSite,
  computeBoissonsLine,
} from "@/lib/boissons-calc";
import { computeLocalLine, computeTransferLine } from "@/lib/gbegamey-calc";
import { stockOf } from "@/lib/matieres-calc";
import { computeZogboLine, physicalStock } from "@/lib/zogbo-calc";
import type {
  BoissonsLine,
  GbegameyLocalLine,
  GbegameyTransferLine,
  MatieresLine,
  ZogboLine,
} from "@/lib/types";

/**
 * Une perte déclarée doit sortir du stock exactement comme une vente, mais
 * sans produire de chiffre d'affaires. Ces tests verrouillent la déduction
 * dans les quatre familles : une régression ici ferait vendre du stock qui
 * n'existe plus.
 */

describe("plats Zogbo", () => {
  const base: ZogboLine = {
    productId: "p",
    name: "P",
    stock: 20,
    prepared: 20,
    sentToGbegamey: 0,
    sold: 5,
    pertes: 0,
    counted: null,
    observations: "",
  };

  it("la perte sort du stock vendable", () => {
    expect(physicalStock({ ...base, pertes: 3 })).toBe(12);
  });

  it("le reste théorique en tient compte", () => {
    expect(computeZogboLine({ ...base, pertes: 3 }, 1000).theoreticalRemaining)
      .toBe(12);
  });

  it("mais la perte ne produit aucun chiffre d'affaires", () => {
    const sans = computeZogboLine(base, 1000);
    const avec = computeZogboLine({ ...base, pertes: 3 }, 1000);
    expect(avec.soldAmount).toBe(sans.soldAmount);
  });
});

describe("plats Gbégamey", () => {
  it("plats reçus : la perte sort du solde", () => {
    const ligne: GbegameyTransferLine = {
      productId: "p",
      name: "P",
      initialStock: 0,
      received: 10,
      sold: 2,
      pertes: 3,
      counted: null,
      observations: "",
    };
    expect(computeTransferLine(ligne, 10, 1000).theoreticalRemaining).toBe(5);
  });

  it("plats sur place : la perte sort du disponible", () => {
    const ligne: GbegameyLocalLine = {
      productId: "l",
      name: "L",
      initialStock: 4,
      prepared: 6,
      sold: 2,
      pertes: 3,
      counted: null,
      observations: "",
    };
    expect(computeLocalLine(ligne, 1000).theoreticalRemaining).toBe(5);
  });

  it("accompagnements Zogbo : même formule de stock que sur place", () => {
    const ligne: GbegameyLocalLine = {
      productId: "a",
      name: "Alloco",
      initialStock: 8,
      prepared: 4,
      sold: 1,
      pertes: 2,
      counted: null,
      observations: "",
    };
    expect(computeLocalLine(ligne, 300).theoreticalRemaining).toBe(9);
  });
});

describe("boissons", () => {
  const base: BoissonsLine = {
    productId: "b",
    name: "B",
    initialStockZogbo: 2,
    purchasesZogbo: 0,
    soldZogbo: 0,
    pertesZogbo: 0,
    countedZogbo: null,
    initialStockGbegamey: 0,
    purchasesGbegamey: 0,
    soldGbegamey: 0,
    pertesGbegamey: 0,
    countedGbegamey: null,
    observations: "",
  };

  it("la perte se compte en bouteilles, pas en casiers", () => {
    // 2 casiers de 12 = 24 bouteilles, 5 cassées : 19 restantes.
    expect(
      physicalBoissonsStockForSite({ ...base, pertesZogbo: 5 }, "zogbo", 12),
    ).toBe(19);
  });

  it("le reste théorique en casiers reflète les bouteilles perdues", () => {
    const c = computeBoissonsLine(
      { ...base, pertesZogbo: 12 },
      {
        id: "b",
        name: "B",
        purchasePrice: 400,
        salePrice: 600,
        unitsPerCasier: 12,
      },
    );
    // Un casier entier perdu sur les deux.
    expect(c.theoreticalRemainingZogbo).toBe(1);
  });

  it("une perte à Zogbo ne touche pas au stock de Gbégamey", () => {
    const l = { ...base, initialStockGbegamey: 2, pertesZogbo: 5 };
    expect(physicalBoissonsStockForSite(l, "gbegamey", 12)).toBe(24);
  });

  it("ne descend jamais sous zéro", () => {
    expect(
      physicalBoissonsStockForSite({ ...base, pertesZogbo: 999 }, "zogbo", 12),
    ).toBe(0);
  });
});

describe("matières premières", () => {
  it("la perte sort du stock disponible", () => {
    const ligne: MatieresLine = {
      productId: "m",
      name: "M",
      initialStock: 30,
      purchases: 10,
      consumed: 15,
      pertes: 5,
      counted: null,
      observations: "",
    };
    expect(stockOf(ligne)).toBe(20);
  });
});
