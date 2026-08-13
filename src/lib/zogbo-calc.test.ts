import { describe, expect, it } from "vitest";
import {
  applyZogboMovementToState,
  cancelZogboMovementInState,
  emptyZogboLine,
  leftoverFromZogboLines,
  leftoverMapHasStock,
  normalizeZogboLine,
  physicalStock,
  previousIsoDate,
  shiftIsoDate,
  zogboDayHasCarryStock,
} from "@/lib/zogbo-calc";
import type { ZogboLine } from "@/lib/types";

function ligne(patch: Partial<ZogboLine> = {}): ZogboLine {
  return {
    productId: "base-poisson",
    name: "POISSON BRAISÉ",
    stock: 0,
    prepared: 0,
    sentToGbegamey: 0,
    sold: 0,
    pertes: 0,
    counted: null,
    observations: "",
    ...patch,
  };
}

describe("physicalStock", () => {
  it("retranche les ventes du stock préparé", () => {
    expect(physicalStock({ stock: 10, sold: 4 })).toBe(6);
  });

  it("peut devenir négatif si le compteur de ventes dépasse le stock", () => {
    // Cas anormal, mais la fonction ne doit pas le masquer : une valeur
    // négative signale une incohérence à corriger, pas un stock nul.
    expect(physicalStock({ stock: 2, sold: 5 })).toBe(-3);
  });
});

describe("normalizeZogboLine", () => {
  it("ramène les quantités négatives à zéro", () => {
    const l = normalizeZogboLine(ligne({ stock: -5, sold: -2 }));
    expect(l.stock).toBe(0);
    expect(l.sold).toBe(0);
  });

  it("conserve un comptage nul distinct d'une absence de comptage", () => {
    expect(normalizeZogboLine(ligne({ counted: 0 })).counted).toBe(0);
    expect(normalizeZogboLine(ligne({ counted: null })).counted).toBeNull();
  });
});

describe("applyZogboMovementToState", () => {
  it("une préparation augmente le stock et le cumul préparé", () => {
    const { lines } = applyZogboMovementToState([ligne()], [], {
      type: "prepare",
      productId: "base-poisson",
      qty: 12,
    });
    expect(lines[0]!.stock).toBe(12);
    expect(lines[0]!.prepared).toBe(12);
  });

  it("un envoi retire du stock et alimente le cumul envoyé", () => {
    const { lines } = applyZogboMovementToState(
      [ligne({ stock: 12, prepared: 12 })],
      [],
      { type: "send", productId: "base-poisson", qty: 5 },
    );
    expect(lines[0]!.stock).toBe(7);
    expect(lines[0]!.sentToGbegamey).toBe(5);
  });

  it("refuse d'envoyer plus que ce qui est physiquement en main", () => {
    // 10 préparés dont 8 déjà vendus sur place : 2 seulement peuvent partir.
    expect(() =>
      applyZogboMovementToState([ligne({ stock: 10, sold: 8 })], [], {
        type: "send",
        productId: "base-poisson",
        qty: 3,
      }),
    ).toThrow(/Stock insuffisant/);
  });

  it("refuse une quantité nulle ou négative", () => {
    for (const qty of [0, -4]) {
      expect(() =>
        applyZogboMovementToState([ligne({ stock: 5 })], [], {
          type: "prepare",
          productId: "base-poisson",
          qty,
        }),
      ).toThrow(/Quantité invalide/);
    }
  });

  it("refuse un produit absent de la journée", () => {
    expect(() =>
      applyZogboMovementToState([ligne()], [], {
        type: "prepare",
        productId: "inconnu",
        qty: 1,
      }),
    ).toThrow(/introuvable/);
  });
});

describe("cancelZogboMovementInState", () => {
  it("reprend l'effet d'une préparation sans effacer la trace", () => {
    const apres = applyZogboMovementToState([ligne()], [], {
      type: "prepare",
      productId: "base-poisson",
      qty: 10,
    });
    const annule = cancelZogboMovementInState(
      apres.lines,
      apres.movements,
      apres.movement.id,
    );
    expect(annule.lines[0]!.stock).toBe(0);
    expect(annule.lines[0]!.prepared).toBe(0);
    // Le mouvement reste au registre, marqué annulé.
    expect(annule.movements).toHaveLength(1);
    expect(annule.movements[0]!.cancelledAt).not.toBeNull();
  });

  it("reprend l'effet d'un envoi", () => {
    const apres = applyZogboMovementToState(
      [ligne({ stock: 20, prepared: 20 })],
      [],
      { type: "send", productId: "base-poisson", qty: 6 },
    );
    const annule = cancelZogboMovementInState(
      apres.lines,
      apres.movements,
      apres.movement.id,
    );
    expect(annule.lines[0]!.stock).toBe(20);
    expect(annule.lines[0]!.sentToGbegamey).toBe(0);
  });
});

describe("leftoverFromZogboLines", () => {
  it("reporte le reste théorique, comptage prioritaire", () => {
    const map = leftoverFromZogboLines([
      ligne({ productId: "a", stock: 10, sold: 3 }),
      ligne({ productId: "b", stock: 10, sold: 3, counted: 5 }),
    ]);
    expect(map.get("a")).toBe(7);
    // Le comptage étant le stock initial, il est aussi le reste du jour :
    // compté − vendu.
    expect(map.get("b")).toBe(2);
  });

  it("détecte une journée vide vs une journée reportable", () => {
    expect(
      zogboDayHasCarryStock([ligne({ productId: "a", stock: 0, sold: 0 })]),
    ).toBe(false);
    expect(
      zogboDayHasCarryStock([ligne({ productId: "a", stock: 10, sold: 3 })]),
    ).toBe(true);
    expect(
      leftoverMapHasStock(new Map([["x", 0], ["y", 2]])),
    ).toBe(true);
  });
});

describe("dates", () => {
  it("previousIsoDate recule d'un jour, changement de mois compris", () => {
    expect(previousIsoDate("2026-08-01")).toBe("2026-07-31");
  });

  it("shiftIsoDate gère les années bissextiles", () => {
    expect(shiftIsoDate("2028-03-01", -1)).toBe("2028-02-29");
  });

  it("rejette une date mal formée", () => {
    expect(shiftIsoDate("pas-une-date", -1)).toBeNull();
  });
});

describe("emptyZogboLine", () => {
  it("part d'une ligne entièrement à zéro", () => {
    const l = emptyZogboLine({
      id: "base-x",
      name: "X",
      unitPrice: 1000,
    } as never);
    expect(l.stock).toBe(0);
    expect(l.sold).toBe(0);
    expect(l.counted).toBeNull();
  });
});
