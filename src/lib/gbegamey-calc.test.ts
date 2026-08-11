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
    counted: null,
    observations: "",
    ...patch,
  };
}

describe("computeTransferLine", () => {
  it("fait confiance à l'envoi déclaré par Zogbo tant que rien n'est vérifié", () => {
    const c = computeTransferLine(transfert({ initialStock: 2 }), 10, 1000);
    expect(c.received).toBeNull();
    expect(c.theoreticalRemaining).toBe(12);
  });

  it("le reçu constaté prend le dessus sur l'envoi déclaré", () => {
    // Zogbo déclare 10 envoyés, Gbégamey n'en constate que 8 : 2 perdus.
    const c = computeTransferLine(
      transfert({ initialStock: 0, received: 8 }),
      10,
      1000,
    );
    expect(c.theoreticalRemaining).toBe(8);
    expect(c.transportVariance).toBe(2);
  });

  it("ne signale aucun écart de transport quand rien n'est vérifié", () => {
    expect(
      computeTransferLine(transfert(), 10, 1000).transportVariance,
    ).toBeNull();
  });

  it("retranche les ventes du solde disponible", () => {
    const c = computeTransferLine(
      transfert({ initialStock: 3, received: 7, sold: 4 }),
      7,
      1000,
    );
    expect(c.theoreticalRemaining).toBe(6);
  });

  it("mesure l'écart avec le comptage de fin de service", () => {
    const c = computeTransferLine(
      transfert({ initialStock: 0, received: 10, sold: 4, counted: 5 }),
      10,
      1000,
    );
    // 10 reçus − 4 vendus = 6 attendus, 5 comptés : 1 manquant.
    expect(c.variance).toBe(1);
  });

  it("valorise les ventes au prix unitaire", () => {
    const c = computeTransferLine(
      transfert({ initialStock: 0, received: 10, sold: 3 }),
      10,
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
});

describe("reports au lendemain", () => {
  it("reporte le reste des plats reçus, comptage prioritaire", () => {
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
      new Map([
        ["a", 10],
        ["b", 10],
      ]),
    );
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
