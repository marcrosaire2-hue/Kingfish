import { describe, expect, it } from "vitest";
import {
  estJourFuturVide,
  fusionnerLignesBoissons,
  projeterJourBoissons,
  projeterJourMatieres,
  projeterLigneBoisson,
} from "@/lib/site-collections-calc";
import { formatTicketNumero } from "@/lib/pos-repo";
import type { BoissonsLine } from "@/lib/types";

const ligne: BoissonsLine = {
  productId: "p1",
  name: "Produit",
  initialStockZogbo: 2,
  purchasesZogbo: 1,
  soldZogbo: 3,
  pertesZogbo: 1,
  countedZogbo: 10,
  initialStockGbegamey: 5,
  purchasesGbegamey: 4,
  soldGbegamey: 6,
  pertesGbegamey: 2,
  countedGbegamey: null,
  observations: "",
  stockTrackedGbegamey: true,
};

describe("séparation des journées par site", () => {
  it("ne laisse à Zogbo aucune donnée de Gbégamey", () => {
    const z = projeterLigneBoisson(ligne, "zogbo");
    expect(z.soldZogbo).toBe(3);
    expect(z.countedZogbo).toBe(10);
    expect(z.initialStockGbegamey).toBe(0);
    expect(z.soldGbegamey).toBe(0);
    expect(z.stockTrackedGbegamey).toBeUndefined();
  });

  it("ne laisse à Gbégamey aucune donnée de Zogbo", () => {
    const g = projeterLigneBoisson(ligne, "gbegamey");
    expect(g.initialStockGbegamey).toBe(5);
    expect(g.stockTrackedGbegamey).toBe(true);
    expect(g.soldZogbo).toBe(0);
    expect(g.countedZogbo).toBeNull();
  });

  it("répartit les achats selon leur site", () => {
    const doc = {
      _id: "2026-11-02",
      lines: [ligne],
      movements: [{ site: "zogbo" }, { site: "gbegamey" }, {}],
    };
    expect(projeterJourBoissons(doc, "zogbo").movements).toHaveLength(2);
    expect(projeterJourBoissons(doc, "gbegamey").movements).toHaveLength(1);
  });

  it("démarre les matières de Gbégamey au 02/11 sans rien retirer à Zogbo", () => {
    const ancien = { _id: "2026-10-31", lines: [], movements: [] };
    const nouveau = { _id: "2026-11-02", lines: [], movements: [] };
    expect(projeterJourMatieres(ancien, "gbegamey")).toBeNull();
    expect(projeterJourMatieres(ancien, "zogbo")).not.toBeNull();
    expect(projeterJourMatieres(nouveau, "gbegamey")).not.toBeNull();
  });

  it("ignore seulement les journées futures sans aucune activité", () => {
    const vide = {
      ...ligne,
      initialStockZogbo: 1.5,
      purchasesZogbo: 0,
      soldZogbo: 0,
      pertesZogbo: 0,
      countedZogbo: null,
      initialStockGbegamey: 0,
      purchasesGbegamey: 0,
      soldGbegamey: 0,
      pertesGbegamey: 0,
    };
    const jour = { _id: "2026-12-05", lines: [vide], movements: [] };
    expect(estJourFuturVide(jour, "2026-11-09")).toBe(true);
    expect(estJourFuturVide({ ...jour, lines: [ligne] }, "2026-11-09")).toBe(false);
    expect(estJourFuturVide({ ...jour, _id: "2026-11-09" }, "2026-11-09")).toBe(false);
  });

  it("reconstitue le total direction sans mélanger les sites", () => {
    const [f] = fusionnerLignesBoissons(
      [projeterLigneBoisson(ligne, "zogbo")],
      [projeterLigneBoisson(ligne, "gbegamey")],
    );
    expect(f!.soldZogbo).toBe(3);
    expect(f!.soldGbegamey).toBe(6);
    expect(f!.countedZogbo).toBe(10);
    expect(f!.stockTrackedGbegamey).toBe(true);
  });
});

describe("numéros de tickets par site", () => {
  it("sépare les numéros des deux sites", () => {
    expect(formatTicketNumero("2026-11-09", 1, "zogbo")).toBe("Z-261109-001");
    expect(formatTicketNumero("2026-11-09", 1, "gbegamey")).toBe("G-261109-001");
  });
});
