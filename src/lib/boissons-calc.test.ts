import { describe, expect, it } from "vitest";
import {
  computeBoissonsLine,
  formatCasiers,
  guessUnitsPerCasier,
  leftoverFromBoissonsLines,
  normalizeBoissonsLine,
  physicalBoissonsStock,
  unitsPerCasierOf,
} from "@/lib/boissons-calc";
import type { BoissonsLine, Drink } from "@/lib/types";

function ligne(patch: Partial<BoissonsLine> = {}): BoissonsLine {
  return {
    productId: "drink-beaufort",
    name: "Beaufort",
    initialStock: 0,
    purchases: 0,
    soldZogbo: 0,
    soldGbegamey: 0,
    pertes: 0,
    counted: null,
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

describe("physicalBoissonsStock", () => {
  it("convertit les casiers en bouteilles avant de retirer les ventes", () => {
    // 3 casiers de 12 = 36 bouteilles, moins 5 vendues à Zogbo et 4 à Gbégamey.
    expect(
      physicalBoissonsStock(
        ligne({ initialStock: 2, purchases: 1, soldZogbo: 5, soldGbegamey: 4 }),
        12,
      ),
    ).toBe(27);
  });

  it("ne descend jamais sous zéro", () => {
    expect(
      physicalBoissonsStock(ligne({ initialStock: 1, soldZogbo: 50 }), 12),
    ).toBe(0);
  });

  it("le comptage saisi prévaut sur le théorique", () => {
    // Théorique : 3 casiers de 12 = 36 bt, moins 5 vendues = 31.
    // Compté 24 bouteilles, moins 5 vendues = 19 : c'est le comptage
    // qui fait foi.
    expect(
      physicalBoissonsStock(
        ligne({ initialStock: 2, purchases: 1, soldZogbo: 5, counted: 24 }),
        12,
      ),
    ).toBe(19);
  });

  it("le comptage à zéro vide le stock même si le théorique est positif", () => {
    expect(
      physicalBoissonsStock(
        ligne({ initialStock: 2, purchases: 1, soldZogbo: 1, counted: 0 }),
        12,
      ),
    ).toBe(0);
  });

  it("retombe sur le conditionnement par défaut si la valeur est absurde", () => {
    const l = ligne({ initialStock: 1 });
    expect(physicalBoissonsStock(l, 0)).toBe(physicalBoissonsStock(l, 12));
    expect(physicalBoissonsStock(l, -3)).toBeGreaterThan(0);
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
  it("calcule la marge sur le total vendu", () => {
    const c = computeBoissonsLine(
      ligne({ initialStock: 5, soldZogbo: 10, soldGbegamey: 2 }),
      boisson(),
    );
    expect(c.soldTotal).toBe(12);
    expect(c.soldAmount).toBe(12 * 600);
    expect(c.margin).toBe(12 * (600 - 400));
  });

  it("laisse la marge indéterminée sans prix de vente", () => {
    const c = computeBoissonsLine(
      ligne({ initialStock: 5, soldZogbo: 3 }),
      boisson({ salePrice: null }),
    );
    expect(c.margin).toBeNull();
    // Sans prix, aucun chiffre d'affaires ne doit être inventé.
    expect(c.soldAmount).toBe(0);
  });

  it("sépare le chiffre d'affaires des deux points de vente", () => {
    const c = computeBoissonsLine(
      ligne({ initialStock: 5, soldZogbo: 4, soldGbegamey: 6 }),
      boisson(),
    );
    expect(c.soldAmountZogbo).toBe(4 * 600);
    expect(c.soldAmountGbegamey).toBe(6 * 600);
    expect(c.soldAmount).toBe(c.soldAmountZogbo + c.soldAmountGbegamey);
  });

  it("mesure l'écart entre théorique et comptage physique", () => {
    const c = computeBoissonsLine(
      ligne({ initialStock: 10, soldZogbo: 12, counted: 96 }),
      boisson(),
    );
    // 10 casiers − 1 casier vendu = 9 théoriques ; 96 bt comptées = 8 casiers.
    expect(c.theoreticalRemaining).toBe(9);
    expect(c.variance).toBe(1);
  });

  it("reporte le comptage en casiers pour le jour suivant", () => {
    const map = leftoverFromBoissonsLines(
      [ligne({ initialStock: 3, counted: 25 })],
      [boisson()],
    );
    // 25 bouteilles comptées = 2,08 casiers reportés.
    expect(map.get("drink-beaufort")).toBeCloseTo(25 / 12, 2);
  });

  it("ne calcule aucun écart tant que rien n'est compté", () => {
    expect(computeBoissonsLine(ligne({ initialStock: 3 }), boisson()).variance)
      .toBeNull();
  });
});

describe("normalizeBoissonsLine", () => {
  it("ramène les quantités négatives à zéro", () => {
    const l = normalizeBoissonsLine(
      ligne({ initialStock: -4, purchases: -1, soldZogbo: -9 }),
    );
    expect(l.initialStock).toBe(0);
    expect(l.purchases).toBe(0);
    expect(l.soldZogbo).toBe(0);
  });

  it("ramène un comptage à virgule à un nombre entier de bouteilles", () => {
    // Résidu de conversion casiers → bouteilles trouvé en base (« 1.92 bt ») :
    // une bouteille ne se compte pas en fractions.
    expect(normalizeBoissonsLine(ligne({ counted: 1.92 })).counted).toBe(2);
    expect(normalizeBoissonsLine(ligne({ counted: 23.04 })).counted).toBe(23);
    expect(normalizeBoissonsLine(ligne({ counted: 0 })).counted).toBe(0);
    expect(normalizeBoissonsLine(ligne({ counted: null })).counted).toBeNull();
  });

  it("le report d'un jour sur l'autre ne fabrique plus de décimales", () => {
    // Le report sort en casiers arrondis à 2 décimales ; reconverti en
    // bouteilles il doit retomber sur un entier, jour après jour.
    const upc = 12;
    const veille = ligne({ counted: 23 });
    const casiers = leftoverFromBoissonsLines(
      [veille],
      [boisson({ unitsPerCasier: upc })],
    ).get("drink-beaufort")!;
    const ouverture = normalizeBoissonsLine(
      ligne({ counted: Math.round(casiers * upc) }),
    );
    expect(Number.isInteger(ouverture.counted!)).toBe(true);
    expect(ouverture.counted).toBe(23);
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
