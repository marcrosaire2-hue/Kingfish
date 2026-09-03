import { describe, expect, it } from "vitest";
import { dayVentesSansStock } from "@/lib/ventes-sans-stock";

describe("ventes sans stock", () => {
  it("n’active la vente libre que si le flag est explicitement true", () => {
    expect(dayVentesSansStock(null)).toBe(false);
    expect(dayVentesSansStock(undefined)).toBe(false);
    expect(dayVentesSansStock({})).toBe(false);
    expect(dayVentesSansStock({ ventesSansStock: false })).toBe(false);
    expect(dayVentesSansStock({ ventesSansStock: true })).toBe(true);
  });
});
