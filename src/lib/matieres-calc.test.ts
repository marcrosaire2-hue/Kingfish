import { describe, expect, it } from "vitest";
import { applyMatieresPurchaseToState } from "@/lib/matieres-calc";
import type { MatieresLine } from "@/lib/types";

function ligne(patch: Partial<MatieresLine> = {}): MatieresLine {
  return {
    productId: "mat-riz",
    name: "RIZ",
    initialStock: 0,
    purchases: 0,
    consumed: 0,
    pertes: 0,
    counted: null,
    observations: "",
    ...patch,
  };
}

describe("applyMatieresPurchaseToState", () => {
  it("ajoute la quantité achetée au stock", () => {
    const { lines, movement } = applyMatieresPurchaseToState([ligne()], [], {
      productId: "mat-riz",
      qty: 25,
      unitPrice: 700,
    });
    expect(lines[0]!.purchases).toBe(25);
    expect(movement.qty).toBe(25);
    expect(movement.unitPrice).toBe(700);
  });

  it("rattache l'achat au fournisseur, nom figé à la saisie", () => {
    // Renommer un fournisseur plus tard ne doit pas réécrire l'historique.
    const { movement } = applyMatieresPurchaseToState([ligne()], [], {
      productId: "mat-riz",
      qty: 10,
      unitPrice: 700,
      fournisseurId: "frn-1",
      fournisseurNom: "Marché Dantokpa",
    });
    expect(movement.fournisseurId).toBe("frn-1");
    expect(movement.fournisseurNom).toBe("Marché Dantokpa");
  });

  it("accepte un achat sans fournisseur précisé", () => {
    const { movement } = applyMatieresPurchaseToState([ligne()], [], {
      productId: "mat-riz",
      qty: 5,
      unitPrice: 700,
    });
    expect(movement.fournisseurId).toBeNull();
    expect(movement.fournisseurNom).toBeNull();
  });

  it("refuse un achat sans prix unitaire", () => {
    expect(() =>
      applyMatieresPurchaseToState([ligne()], [], {
        productId: "mat-riz",
        qty: 5,
      }),
    ).toThrow(/Prix d'achat obligatoire/);
  });

  it("refuse une quantité nulle ou négative", () => {
    for (const qty of [0, -3]) {
      expect(() =>
        applyMatieresPurchaseToState([ligne()], [], {
          productId: "mat-riz",
          qty,
          unitPrice: 700,
        }),
      ).toThrow(/Quantité invalide/);
    }
  });

  it("refuse une matière absente de la journée", () => {
    expect(() =>
      applyMatieresPurchaseToState([ligne()], [], {
        productId: "inconnu",
        qty: 5,
        unitPrice: 700,
      }),
    ).toThrow(/introuvable/);
  });

  it("empile les mouvements du plus récent au plus ancien", () => {
    const un = applyMatieresPurchaseToState([ligne()], [], {
      productId: "mat-riz",
      qty: 5,
      unitPrice: 700,
    });
    const deux = applyMatieresPurchaseToState(un.lines, un.movements, {
      productId: "mat-riz",
      qty: 7,
      unitPrice: 700,
    });
    expect(deux.movements[0]!.qty).toBe(7);
    expect(deux.lines[0]!.purchases).toBe(12);
  });
});
