import { describe, expect, it } from "vitest";
import {
  dayVentesSansStock,
  mergeVentesSansStockOnSave,
} from "@/lib/ventes-sans-stock";

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

  it("coupe la vente libre après saisie de stock", () => {
    expect(
      mergeVentesSansStockOnSave({
        stockSaisie: true,
        existing: { ventesSansStock: true },
      }),
    ).toBe(false);
    expect(
      mergeVentesSansStockOnSave({
        stockSaisie: true,
        existing: null,
      }),
    ).toBe(false);
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
