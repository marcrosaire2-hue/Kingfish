import { describe, expect, it } from "vitest";
import { calculStock } from "@/lib/stock-formule";

describe("Règle de stock", () => {
  it("premier jour : SI + Entrées − Vendus, écart = comptage − théorique", () => {
    // SI 10 saisi (arrive en entrée le premier jour) + 5 entrées, 3 vendus.
    const j1 = calculStock({ ouverture: 0, entrees: 15, vendus: 3, compte: 11 });
    expect(j1.disponible).toBe(15);
    expect(j1.theorique).toBe(12);
    expect(j1.ecart).toBe(-1);
    // Le lendemain repart du comptage de la veille.
    expect(j1.report).toBe(11);
  });

  it("lendemain : disponible = comptage de la veille + entrées", () => {
    const j2 = calculStock({ ouverture: 11, entrees: 4, vendus: 6, compte: null });
    expect(j2.disponible).toBe(15);
    expect(j2.theorique).toBe(9);
    expect(j2.ecart).toBeNull();
    // Sans comptage, le lendemain repart du théorique.
    expect(j2.report).toBe(9);
  });

  it("le comptage ne change jamais le stock disponible", () => {
    const sans = calculStock({ ouverture: 8, entrees: 0, vendus: 2, compte: null });
    const avec = calculStock({ ouverture: 8, entrees: 0, vendus: 2, compte: 3 });
    expect(avec.disponible).toBe(sans.disponible);
    expect(avec.theorique).toBe(sans.theorique);
    expect(avec.ecart).toBe(-3);
  });

  it("les pertes sortent du théorique", () => {
    expect(calculStock({ ouverture: 10, entrees: 0, vendus: 2, pertes: 1, compte: null }).theorique).toBe(7);
  });
});
