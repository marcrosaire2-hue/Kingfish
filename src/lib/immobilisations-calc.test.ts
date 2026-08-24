import { describe, expect, it } from "vitest";
import {
  brutAmortissable,
  dotationJour,
  valeurNette,
} from "@/lib/immobilisations-repo";
import type { Immobilisation } from "@/lib/types";

function immo(over: Partial<Immobilisation> = {}): Immobilisation {
  return {
    id: "immo-1",
    name: "Frigo",
    kind: "actif",
    qty: 1,
    unit: "pièce",
    cost: 250000,
    salePrice: null,
    date: "2026-01-01",
    site: "zogbo",
    notes: "",
    active: true,
    depenseId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    dureeUtiliteAnnees: 5,
    acquisitionQty: 1,
    acquisitionAmount: 250000,
    ...over,
  };
}

describe("brutAmortissable / valeurNette", () => {
  it("garde le brut d’acquisition figé, même si qty = 0", () => {
    const perdu = immo({ qty: 0 });
    expect(brutAmortissable(perdu)).toBe(250000);
  });

  it("une perte totale (qty 0) annule VNC et dotation, sans réécrire le brut", () => {
    const perdu = immo({ qty: 0 });
    expect(valeurNette(perdu, "2026-01-01")).toBe(0);
    expect(dotationJour(perdu, "2026-01-01")).toBe(0);
  });

  it("après un an, la VNC d’un actif 5 ans est les 4/5 du brut", () => {
    expect(valeurNette(immo(), "2027-01-01")).toBe(200000);
  });

  it("un emballage reste en qty × coût, sans amortissement", () => {
    const carton = immo({
      kind: "emballage",
      qty: 12,
      cost: 100,
      acquisitionAmount: 2000,
      dureeUtiliteAnnees: 5,
    });
    expect(valeurNette(carton, "2027-01-01")).toBe(1200);
  });
});

describe("dotationJour", () => {
  it("constate 1/365 de la dotation annuelle, bornée par la VNC", () => {
    expect(dotationJour(immo(), "2026-01-01")).toBe(137);
  });

  it("n’amortit pas avant la mise en service ni un emballage", () => {
    expect(dotationJour(immo(), "2025-12-31")).toBe(0);
    expect(dotationJour(immo({ kind: "emballage" }), "2026-06-01")).toBe(0);
  });

  it("conserve la dotation historique avant inactiveSince, puis s’arrête", () => {
    const fiche = immo({ inactiveSince: "2026-07-01" });
    expect(dotationJour(fiche, "2026-06-30")).toBeGreaterThan(0);
    expect(dotationJour(fiche, "2026-07-01")).toBe(0);
  });

  it("gèle la VNC à inactiveSince : plus d’amortissement après la sortie", () => {
    const fiche = immo({ inactiveSince: "2026-07-01" });
    const vncSortie = valeurNette(fiche, "2026-06-30");
    expect(valeurNette(fiche, "2026-07-01")).toBe(vncSortie);
    expect(valeurNette(fiche, "2026-12-31")).toBe(vncSortie);
    expect(vncSortie).toBeGreaterThan(0);
    expect(vncSortie).toBeLessThan(250000);
  });
});
