import { describe, expect, it } from "vitest";
import { chargesTotal, emptyCharges } from "@/lib/synthese-calc";

describe("chargesTotal", () => {
  it("additionne toutes les charges saisies", () => {
    expect(
      chargesTotal({
        date: "2026-08-12",
        matieresPremieres: 10000,
        loyer: 5000,
        salaires: 20000,
        electricite: 3000,
        carburant: 2000,
        reparations: 1000,
        updatedAt: null,
      }),
    ).toBe(41000);
  });

  it("compte les pertes comme une charge", () => {
    // Un produit gâté coûte aussi cher qu'un achat : il doit peser sur le
    // résultat, sinon la marge affichée est fausse.
    const base = { ...emptyCharges("2026-08-12"), matieresPremieres: 10000 };
    expect(chargesTotal(base)).toBe(10000);
    expect(chargesTotal({ ...base, pertes: 4500 })).toBe(14500);
  });

  it("ignore une valeur de perte absente ou aberrante", () => {
    const base = emptyCharges("2026-08-12");
    expect(chargesTotal({ ...base, pertes: undefined })).toBe(0);
    expect(chargesTotal({ ...base, pertes: -500 })).toBe(0);
  });

  it("une journée vierge ne coûte rien", () => {
    expect(chargesTotal(emptyCharges("2026-08-12"))).toBe(0);
  });
});
