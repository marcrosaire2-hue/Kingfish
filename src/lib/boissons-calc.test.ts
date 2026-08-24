import { describe, expect, it } from "vitest";
import {
  computeBoissonsLine,
  formatCasiers,
  guessUnitsPerCasier,
  leftoverFromBoissonsLines,
  normalizeBoissonsLine,
  physicalBoissonsStockForSite,
  unitsPerCasierOf,
} from "@/lib/boissons-calc";
import type { BoissonsLine, Drink } from "@/lib/types";

function ligne(patch: Partial<BoissonsLine> = {}): BoissonsLine {
  return {
    productId: "drink-beaufort",
    name: "Beaufort",
    initialStockZogbo: 0,
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
    ...patch,
  };
}

function boisson(patch: Partial<Drink> = {}): Drink {
  return {
    id: "drink-beaufort",
    name: "Beaufort",
    purchasePrice: 400,
    salePrice: 600,
    unitsPerCasier: 12,
    ...patch,
  } as Drink;
}

describe("physicalBoissonsStockForSite", () => {
  it("convertit les casiers en bouteilles avant de retirer les ventes", () => {
    // 3 casiers de 12 = 36 bouteilles, moins 5 vendues à Zogbo.
    expect(
      physicalBoissonsStockForSite(
        ligne({ initialStockZogbo: 2, purchasesZogbo: 1, soldZogbo: 5 }),
        "zogbo",
        12,
      ),
    ).toBe(31);
  });

  it("les deux sites sont indépendants : vendre à Zogbo ne touche pas Gbégamey", () => {
    const l = ligne({
      initialStockZogbo: 3,
      soldZogbo: 5,
      initialStockGbegamey: 3,
      soldGbegamey: 4,
    });
    expect(physicalBoissonsStockForSite(l, "zogbo", 12)).toBe(31);
    expect(physicalBoissonsStockForSite(l, "gbegamey", 12)).toBe(32);
  });

  it("ne descend jamais sous zéro", () => {
    expect(
      physicalBoissonsStockForSite(
        ligne({ initialStockZogbo: 1, soldZogbo: 50 }),
        "zogbo",
        12,
      ),
    ).toBe(0);
  });

  it("le comptage saisi prévaut sur le théorique", () => {
    // Théorique : 3 casiers de 12 = 36 bt, moins 5 vendues = 31.
    // Compté 24 bouteilles, moins 5 vendues = 19 : c'est le comptage
    // qui fait foi.
    expect(
      physicalBoissonsStockForSite(
        ligne({
          initialStockZogbo: 2,
          purchasesZogbo: 1,
          soldZogbo: 5,
          countedZogbo: 24,
        }),
        "zogbo",
        12,
      ),
    ).toBe(19);
  });

  it("le comptage à zéro vide le stock même si le théorique est positif", () => {
    expect(
      physicalBoissonsStockForSite(
        ligne({
          initialStockZogbo: 2,
          purchasesZogbo: 1,
          soldZogbo: 1,
          countedZogbo: 0,
        }),
        "zogbo",
        12,
      ),
    ).toBe(0);
  });

  it("retombe sur le conditionnement par défaut si la valeur est absurde", () => {
    const l = ligne({ initialStockZogbo: 1 });
    expect(physicalBoissonsStockForSite(l, "zogbo", 0)).toBe(
      physicalBoissonsStockForSite(l, "zogbo", 12),
    );
    expect(physicalBoissonsStockForSite(l, "zogbo", -3)).toBeGreaterThan(0);
  });
});

describe("unitsPerCasierOf / guessUnitsPerCasier", () => {
  it("utilise le conditionnement déclaré du produit", () => {
    expect(unitsPerCasierOf(boisson({ unitsPerCasier: 24 }))).toBe(24);
  });

  it("devine un conditionnement quand rien n'est déclaré", () => {
    expect(guessUnitsPerCasier("Beaufort GB")).toBeGreaterThan(0);
  });

  it("ne renvoie jamais zéro, qui provoquerait une division par zéro", () => {
    expect(unitsPerCasierOf(undefined)).toBeGreaterThan(0);
    expect(unitsPerCasierOf(null)).toBeGreaterThan(0);
  });
});

describe("computeBoissonsLine", () => {
  it("calcule la marge sur le total vendu (deux sites)", () => {
    const c = computeBoissonsLine(
      ligne({ initialStockZogbo: 5, soldZogbo: 10, soldGbegamey: 2 }),
      boisson(),
    );
    expect(c.soldTotal).toBe(12);
    expect(c.soldAmount).toBe(12 * 600);
    expect(c.margin).toBe(12 * (600 - 400));
  });

  it("laisse la marge indéterminée sans prix de vente", () => {
    const c = computeBoissonsLine(
      ligne({ initialStockZogbo: 5, soldZogbo: 3 }),
      boisson({ salePrice: null }),
    );
    expect(c.margin).toBeNull();
    // Sans prix, aucun chiffre d'affaires ne doit être inventé.
    expect(c.soldAmount).toBe(0);
  });

  it("sépare le chiffre d'affaires des deux points de vente", () => {
    const c = computeBoissonsLine(
      ligne({ initialStockZogbo: 5, soldZogbo: 4, soldGbegamey: 6 }),
      boisson(),
    );
    expect(c.soldAmountZogbo).toBe(4 * 600);
    expect(c.soldAmountGbegamey).toBe(6 * 600);
    expect(c.soldAmount).toBe(c.soldAmountZogbo + c.soldAmountGbegamey);
  });

  it("mesure l'écart entre théorique et comptage physique, par site", () => {
    const c = computeBoissonsLine(
      ligne({
        initialStockZogbo: 10,
        soldZogbo: 12,
        countedZogbo: 96,
        initialStockGbegamey: 5,
        soldGbegamey: 6,
        countedGbegamey: 48,
      }),
      boisson(),
    );
    // 10 casiers − 1 casier vendu = 9 théoriques ; 96 bt comptées = 8 casiers.
    expect(c.theoreticalRemainingZogbo).toBe(9);
    expect(c.varianceZogbo).toBe(1);
    // 5 casiers − 0,5 casier vendu = 4,5 théoriques ; 48 bt comptées = 4 casiers.
    expect(c.theoreticalRemainingGbegamey).toBe(4.5);
    expect(c.varianceGbegamey).toBe(0.5);
  });

  it("reporte le comptage en casiers pour le jour suivant, par site", () => {
    const { zogbo, gbegamey } = leftoverFromBoissonsLines(
      [ligne({ initialStockZogbo: 3, countedZogbo: 25, countedGbegamey: 13 })],
      [boisson()],
    );
    // 25 bouteilles comptées = 2,08 casiers reportés.
    expect(zogbo.get("drink-beaufort")).toBeCloseTo(25 / 12, 2);
    expect(gbegamey.get("drink-beaufort")).toBeCloseTo(13 / 12, 2);
  });

  it("ne calcule aucun écart tant que rien n'est compté", () => {
    const c = computeBoissonsLine(ligne({ initialStockZogbo: 3 }), boisson());
    expect(c.varianceZogbo).toBeNull();
    expect(c.varianceGbegamey).toBeNull();
  });
});

describe("normalizeBoissonsLine", () => {
  it("ramène les quantités négatives à zéro", () => {
    const l = normalizeBoissonsLine(
      ligne({ initialStockZogbo: -4, purchasesZogbo: -1, soldZogbo: -9 }),
    );
    expect(l.initialStockZogbo).toBe(0);
    expect(l.purchasesZogbo).toBe(0);
    expect(l.soldZogbo).toBe(0);
  });

  it("ramène un comptage à virgule à un nombre entier de bouteilles", () => {
    // Résidu de conversion casiers → bouteilles trouvé en base (« 1.92 bt ») :
    // une bouteille ne se compte pas en fractions.
    expect(
      normalizeBoissonsLine(ligne({ countedZogbo: 1.92 })).countedZogbo,
    ).toBe(2);
    expect(
      normalizeBoissonsLine(ligne({ countedZogbo: 23.04 })).countedZogbo,
    ).toBe(23);
    expect(normalizeBoissonsLine(ligne({ countedZogbo: 0 })).countedZogbo).toBe(
      0,
    );
    expect(
      normalizeBoissonsLine(ligne({ countedZogbo: null })).countedZogbo,
    ).toBeNull();
  });

  it("le report d'un jour sur l'autre ne fabrique plus de décimales", () => {
    // Le report sort en casiers arrondis à 2 décimales ; reconverti en
    // bouteilles il doit retomber sur un entier, jour après jour.
    const upc = 12;
    const veille = ligne({ countedZogbo: 23 });
    const casiers = leftoverFromBoissonsLines(
      [veille],
      [boisson({ unitsPerCasier: upc })],
    ).zogbo.get("drink-beaufort")!;
    const ouverture = normalizeBoissonsLine(
      ligne({ countedZogbo: Math.round(casiers * upc) }),
    );
    expect(Number.isInteger(ouverture.countedZogbo!)).toBe(true);
    expect(ouverture.countedZogbo).toBe(23);
  });

  it("une donnée héritée (avant séparation par site) est reflétée sur les deux sites, pas fabriquée à zéro pour l'un d'eux", () => {
    const legacy = {
      productId: "drink-beaufort",
      name: "Beaufort",
      initialStock: 4,
      purchases: 1,
      soldZogbo: 2,
      soldGbegamey: 1,
      pertes: 0,
      counted: 30,
      observations: "",
    };
    const l = normalizeBoissonsLine(legacy);
    expect(l.initialStockZogbo).toBe(4);
    expect(l.initialStockGbegamey).toBe(4);
    expect(l.countedZogbo).toBe(30);
    expect(l.countedGbegamey).toBe(30);
    // Les ventes déjà réparties par site restent inchangées.
    expect(l.soldZogbo).toBe(2);
    expect(l.soldGbegamey).toBe(1);
  });
});

describe("formatCasiers", () => {
  it("affiche les casiers sans décimale superflue", () => {
    expect(formatCasiers(3)).toBe("3");
  });

  it("garde la fraction quand elle existe", () => {
    expect(formatCasiers(2.5)).toContain("2");
  });
});
