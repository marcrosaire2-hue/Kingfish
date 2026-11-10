import { describe, expect, it } from "vitest";
import {
  cleProduitGrise,
  estKindGrisable,
  marquerProduitsGrises,
  MOTIF_GRISE,
} from "@/lib/produits-grises-calc";
import type { VenteProduct } from "@/lib/types";

const produit = (productId: string): VenteProduct => ({
  kind: "plat",
  productId,
  name: productId,
  unitPrice: 1000,
  soldToday: 0,
});

describe("articles grisés par l'admin", () => {
  it("ne marque que l'article grisé, sur son site", () => {
    const grises = new Set([cleProduitGrise("gbegamey", "plat", "a")]);
    const [a, b] = marquerProduitsGrises([produit("a"), produit("b")], "gbegamey", grises);
    expect(a).toMatchObject({ griseAdmin: true, blockReason: MOTIF_GRISE });
    expect(b!.griseAdmin).toBeUndefined();
  });

  it("n'étend pas le grisage à l'autre site", () => {
    const grises = new Set([cleProduitGrise("gbegamey", "plat", "a")]);
    const [a] = marquerProduitsGrises([produit("a")], "zogbo", grises);
    expect(a!.griseAdmin).toBeUndefined();
  });

  it("limite le grisage aux plats, accompagnements et boissons", () => {
    expect(estKindGrisable("plat")).toBe(true);
    expect(estKindGrisable("local")).toBe(true);
    expect(estKindGrisable("boisson")).toBe(true);
    expect(estKindGrisable("extra")).toBe(false);
    expect(estKindGrisable("combo")).toBe(false);
  });
});
