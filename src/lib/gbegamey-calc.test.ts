import { describe, expect, it } from "vitest";
import {
  computeLocalLine,
  computeTransferLine,
  leftoverFromLocalLines,
  leftoverFromTransferLines,
  normalizeTransferLine,
} from "@/lib/gbegamey-calc";
import type { GbegameyLocalLine, GbegameyTransferLine } from "@/lib/types";

function transfert(
  patch: Partial<GbegameyTransferLine> = {},
): GbegameyTransferLine {
  return {
    productId: "base-poisson",
    name: "POISSON BRAISÉ",
    initialStock: 0,
    received: null,
    sold: 0,
    pertes: 0,
    counted: null,
    observations: "",
    ...patch,
  };
}

function local(patch: Partial<GbegameyLocalLine> = {}): GbegameyLocalLine {
  return {
    productId: "local-attieke",
    name: "ATTIÉKÉ",
    initialStock: 0,
    prepared: 0,
    sold: 0,
    pertes: 0,
    counted: null,
    observations: "",
    ...patch,
  };
}

describe("computeTransferLine", () => {
  it("n'utilise que le stock saisi sur Gbégamey", () => {
    const c = computeTransferLine(transfert({ initialStock: 2 }), 1000);
    expect(c.received).toBeNull();
    expect(c.theoreticalRemaining).toBe(2);
  });

  it("le constaté est la seule entrée : plus d'envoi Zogbo", () => {
    const c = computeTransferLine(
      transfert({ initialStock: 0, received: 8 }),
      1000,
    );
    expect(c.available).toBe(8);
    expect(c.theoreticalRemaining).toBe(8);
    expect(c.transportVariance).toBeNull();
  });

  it("les entrées s'additionnent au stock du site", () => {
    const c = computeTransferLine(
      transfert({ initialStock: 0, received: 15, sold: 4 }),
      1000,
    );
    expect(c.available).toBe(15);
    expect(c.theoreticalRemaining).toBe(11);
  });

  it("ne signale aucun écart de transport quand rien n'est vérifié", () => {
    expect(
      computeTransferLine(transfert(), 1000).transportVariance,
    ).toBeNull();
  });

  it("retranche les ventes du solde disponible", () => {
    const c = computeTransferLine(
      transfert({ initialStock: 3, received: 7, sold: 4 }),
      1000,
    );
    expect(c.theoreticalRemaining).toBe(6);
  });

  it("le comptage remplace le stock et mesure l'écart", () => {
    // Entrées 10, 4 vendus → calcul 6 ; comptage 5 → écart −1, reste 5.
    const c = computeTransferLine(
      transfert({ initialStock: 0, received: 10, sold: 4, counted: 5 }),
      1000,
    );
    expect(c.available).toBe(10);
    expect(c.theoreticalRemaining).toBe(5);
    expect(c.variance).toBe(-1);
  });

  it("le comptage fixe le plafond de vente et le restant", () => {
    const c = computeTransferLine(
      transfert({ initialStock: 0, received: 10, sold: 2, counted: 5 }),
      1000,
    );
    expect(c.prevalentMaxSold).toBe(7);
    expect(c.prevalentRemaining).toBe(5);
  });

  it("le restant est le théorique", () => {
    const c = computeTransferLine(
      transfert({ initialStock: 2, received: 8, sold: 3, pertes: 1 }),
      1000,
    );
    expect(c.theoreticalRemaining).toBe(6);
    expect(c.prevalentRemaining).toBe(c.theoreticalRemaining);
    expect(c.prevalentMaxSold).toBe(9);
  });

  it("un comptage à zéro vide le stock et donne l'écart", () => {
    const c = computeTransferLine(
      transfert({ initialStock: 0, received: 10, sold: 2, counted: 0 }),
      1000,
    );
    expect(c.theoreticalRemaining).toBe(0);
    expect(c.variance).toBe(-8);
  });

  it("valorise les ventes au prix unitaire", () => {
    const c = computeTransferLine(
      transfert({ initialStock: 0, received: 10, sold: 3 }),
      1500,
    );
    expect(c.soldAmount).toBe(4500);
  });
});

describe("computeLocalLine", () => {
  it("le disponible cumule le reste de la veille et le préparé du jour", () => {
    const c = computeLocalLine(local({ initialStock: 4, prepared: 6 }), 1000);
    expect(c.available).toBe(10);
  });

  it("retranche les ventes du disponible", () => {
    const c = computeLocalLine(
      local({ initialStock: 4, prepared: 6, sold: 7 }),
      1000,
    );
    expect(c.theoreticalRemaining).toBe(3);
  });

  it("le comptage remplace le stock et mesure l'écart", () => {
    // Ouverture 4 + préparé 6 = 10, rien vendu ; comptage 2 → écart −8, reste 2.
    const c = computeLocalLine(
      local({ initialStock: 4, prepared: 6, sold: 0, counted: 2 }),
      1000,
    );
    expect(c.available).toBe(10);
    expect(c.theoreticalRemaining).toBe(2);
    expect(c.variance).toBe(-8);
  });

  it("les ventes après le comptage sortent du stock compté, l'écart reste fixe", () => {
    const c = computeLocalLine(
      local({
        initialStock: 4,
        prepared: 6,
        sold: 1,
        counted: 2,
        comptage: { theorique: 10, vendu: 0, pertes: 0 },
      }),
      1000,
    );
    expect(c.prevalentRemaining).toBe(1);
    expect(c.variance).toBe(-8);
  });
});

describe("reports au lendemain", () => {
  it("reporte le reste des plats reçus, à partir du compté si saisi", () => {
    const map = leftoverFromTransferLines(
      [
        transfert({ productId: "a", initialStock: 0, received: 10, sold: 4 }),
        transfert({
          productId: "b",
          initialStock: 0,
          received: 10,
          sold: 4,
          counted: 5,
        }),
      ],
    );
    // "a" : sans comptage, théorique 10 − 4 ; "b" : comptage de la veille 5.
    expect(map.get("a")).toBe(6);
    expect(map.get("b")).toBe(5);
  });

  it("reporte le reste des plats préparés sur place", () => {
    const map = leftoverFromLocalLines([
      local({ productId: "x", initialStock: 2, prepared: 8, sold: 5 }),
    ]);
    expect(map.get("x")).toBe(5);
  });
});

describe("normalizeTransferLine", () => {
  it("distingue un reçu nul d'un reçu non vérifié", () => {
    expect(normalizeTransferLine(transfert({ received: 0 })).received).toBe(0);
    expect(normalizeTransferLine(transfert({ received: null })).received)
      .toBeNull();
  });
});
