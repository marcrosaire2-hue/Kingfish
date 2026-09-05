import { describe, expect, it } from "vitest";
import {
  dayVentesSansStock,
  mergeVentesSansStockOnSave,
} from "@/lib/ventes-sans-stock";
import {
  isDrinkStockTracked,
  isLineStockTracked,
  shouldEnforceProductStock,
} from "@/lib/stock-tracked";
import type { BoissonsLine } from "@/lib/types";

describe("ventes sans stock", () => {
  it("laisse la vente libre par défaut (dégrisé)", () => {
    expect(dayVentesSansStock(null)).toBe(true);
    expect(dayVentesSansStock(undefined)).toBe(true);
    expect(dayVentesSansStock({})).toBe(true);
    expect(dayVentesSansStock({ ventesSansStock: true })).toBe(true);
  });

  it("ne plaque au stock que si le flag est explicitement false", () => {
    expect(dayVentesSansStock({ ventesSansStock: false })).toBe(false);
  });

  it("ne bascule plus toute la journée après saisie de stock", () => {
    expect(
      mergeVentesSansStockOnSave({
        stockSaisie: true,
        existing: { ventesSansStock: true },
      }),
    ).toBe(true);
    expect(
      mergeVentesSansStockOnSave({
        stockSaisie: true,
        existing: null,
      }),
    ).toBe(true);
  });

  it("conserve le forçage stock hors saisie", () => {
    expect(
      mergeVentesSansStockOnSave({
        stockSaisie: false,
        existing: { ventesSansStock: false },
      }),
    ).toBe(false);
    expect(
      mergeVentesSansStockOnSave({
        existing: { ventesSansStock: true },
      }),
    ).toBe(true);
    expect(mergeVentesSansStockOnSave({ existing: null })).toBe(true);
  });
});

describe("stockTracked produit × site", () => {
  it("n’enforce que le produit suivi quand la journée est libre", () => {
    expect(
      shouldEnforceProductStock({ dayFreeSale: true, productTracked: false }),
    ).toBe(false);
    expect(
      shouldEnforceProductStock({ dayFreeSale: true, productTracked: true }),
    ).toBe(true);
  });

  it("enforce tout si forçage admin journée", () => {
    expect(
      shouldEnforceProductStock({ dayFreeSale: false, productTracked: false }),
    ).toBe(true);
  });

  it("sépare le suivi boisson Zogbo / Gbégamey", () => {
    const line = {
      stockTrackedZogbo: true,
      stockTrackedGbegamey: false,
      countedZogbo: null,
      countedGbegamey: null,
    } as BoissonsLine;
    expect(isDrinkStockTracked(line, "zogbo")).toBe(true);
    expect(isDrinkStockTracked(line, "gbegamey")).toBe(false);
    expect(isLineStockTracked({ stockTracked: true })).toBe(true);
    expect(isLineStockTracked({})).toBe(false);
  });
});
