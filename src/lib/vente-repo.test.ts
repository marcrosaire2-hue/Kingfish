import { describe, expect, it } from "vitest";
import { normalizeDrink } from "@/lib/boissons-calc";
import type { Drink } from "@/lib/types";

/**
 * Le seuil d'alerte transite par normalizeDrink, qui reconstruit l'objet
 * champ par champ : un oubli ici perdrait la saisie sans rien signaler.
 */
describe("normalizeDrink — seuil d'alerte", () => {
  const base: Drink = {
    id: "drink-x",
    name: "X",
    purchasePrice: 400,
    salePrice: 600,
    unitsPerCasier: 12,
  };

  it("conserve le seuil saisi", () => {
    expect(normalizeDrink({ ...base, alertThreshold: 24 }).alertThreshold).toBe(
      24,
    );
  });

  it("ramène un seuil absent à zéro, soit aucune alerte", () => {
    expect(normalizeDrink(base).alertThreshold).toBe(0);
  });

  it("refuse un seuil négatif", () => {
    expect(
      normalizeDrink({ ...base, alertThreshold: -5 }).alertThreshold,
    ).toBe(0);
  });
});
