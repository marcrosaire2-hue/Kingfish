import { describe, expect, it } from "vitest";
import { normalizeDrink } from "@/lib/boissons-calc";
import { assertSameTeamCancellation } from "@/lib/vente-repo";
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

describe("assertSameTeamCancellation — annulation interdite entre équipes", () => {
  const refuse = (saleShift: string | null, cancellerShift: string | null) =>
    expect(() =>
      assertSameTeamCancellation({ saleShift, cancellerShift }),
    ).toThrow(/Annulation refusée/);

  it("refuse l'annulation d'une vente de jour par l'équipe de nuit", () => {
    refuse("jour", "nuit");
  });

  it("refuse l'annulation d'une vente de nuit par l'équipe de jour", () => {
    refuse("nuit", "jour");
  });

  it("autorise une équipe à annuler ses propres ventes", () => {
    expect(() =>
      assertSameTeamCancellation({ saleShift: "jour", cancellerShift: "jour" }),
    ).not.toThrow();
    expect(() =>
      assertSameTeamCancellation({ saleShift: "nuit", cancellerShift: "nuit" }),
    ).not.toThrow();
  });

  it("autorise l'encadrement (hors équipe) à annuler n'importe quelle vente", () => {
    for (const sale of ["jour", "nuit", "aucune", null, undefined]) {
      expect(() =>
        assertSameTeamCancellation({ saleShift: sale, cancellerShift: "aucune" }),
      ).not.toThrow();
    }
  });

  it("autorise l'annulation des ventes sans équipe (reprise, legs)", () => {
    for (const canceller of ["jour", "nuit", "aucune", null, undefined]) {
      expect(() =>
        assertSameTeamCancellation({ saleShift: "aucune", cancellerShift: canceller }),
      ).not.toThrow();
    }
  });

  it("normalise les alias hérités (matin → jour, soir → nuit)", () => {
    refuse("matin", "soir");
    expect(() =>
      assertSameTeamCancellation({ saleShift: "matin", cancellerShift: "jour" }),
    ).not.toThrow();
  });
});
