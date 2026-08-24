import { describe, expect, it } from "vitest";
import {
  chargesTotal,
  computeDayRevenue,
  emptyCharges,
  emptyVenteTotals,
} from "@/lib/synthese-calc";

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
    const base = { ...emptyCharges("2026-08-12"), matieresPremieres: 10000 };
    expect(chargesTotal(base)).toBe(10000);
    expect(chargesTotal({ ...base, pertes: 4500 })).toBe(14500);
  });

  it("ignore une valeur de perte absente ou aberrante", () => {
    const base = emptyCharges("2026-08-12");
    expect(chargesTotal({ ...base, pertes: undefined })).toBe(0);
    expect(chargesTotal({ ...base, pertes: -500 })).toBe(0);
  });

  it("compte les matières consommées (CMV) et ignore les achats encore en stock", () => {
    const base = emptyCharges("2026-08-12");
    expect(chargesTotal({ ...base, matieresConsommees: 8000 })).toBe(8000);
    expect(
      chargesTotal({
        ...base,
        achatsStock: 113850,
        matieresConsommees: 8000,
      }),
    ).toBe(8000);
  });

  it("compte la dotation d’amortissement, pas l’acquisition d’immobilisation", () => {
    const base = emptyCharges("2026-08-12");
    expect(chargesTotal({ ...base, immobilisations: 250000 })).toBe(0);
    expect(chargesTotal({ ...base, amortissements: 1200 })).toBe(1200);
  });

  it("une journée vierge ne coûte rien", () => {
    expect(chargesTotal(emptyCharges("2026-08-12"))).toBe(0);
  });
});

describe("computeDayRevenue — étanchéité des comptes verrouillés sur une zone", () => {
  const ventes = {
    ...emptyVenteTotals(),
    platsZogbo: 2000,
    localZogbo: 1000,
    boissonsZogbo: 3350,
    count: 8,
  };
  const base = {
    baseDishes: [],
    localDishes: [],
    drinksCatalog: [],
    zogbo: null,
    gbegamey: null,
    boissons: null,
    ventes,
  };

  it("sans verrou de zone, montre le CA réel des deux zones", () => {
    const r = computeDayRevenue(base);
    expect(r.caZogbo).toBe(6350);
    expect(r.caGbegamey).toBe(0);
    expect(r.caTotal).toBe(6350);
  });

  it("verrouillé sur Gbégamey, aucune catégorie ne laisse passer Zogbo", () => {
    const r = computeDayRevenue({ ...base, scopeSite: "gbegamey" });
    expect(r.caZogboPlats).toBe(0);
    expect(r.caAccompagnementsZogbo).toBe(0);
    expect(r.caBoissonsZogbo).toBe(0);
    expect(r.caZogbo).toBe(0);
    expect(r.caGbegamey).toBe(0);
    expect(r.caTotal).toBe(0);
  });

  it("verrouillé sur Zogbo, le CA de Zogbo reste entier", () => {
    const r = computeDayRevenue({ ...base, scopeSite: "zogbo" });
    expect(r.caZogboPlats).toBe(2000);
    expect(r.caAccompagnementsZogbo).toBe(1000);
    expect(r.caBoissonsZogbo).toBe(3350);
    expect(r.caZogbo).toBe(6350);
    expect(r.caGbegamey).toBe(0);
    expect(r.caTotal).toBe(6350);
  });

  it("soustrait les réductions POS du CA net", () => {
    const r = computeDayRevenue({
      ...base,
      ventes: { ...ventes, reductionsZogbo: 350 },
    });
    expect(r.caZogbo).toBe(6000);
    expect(r.caTotal).toBe(6000);
  });

  it("n’invente plus de CA depuis le catalogue si le journal est vide", () => {
    const r = computeDayRevenue({
      ...base,
      ventes: emptyVenteTotals(),
      baseDishes: [{ id: "p1", name: "POISSON", unitPrice: 2500 }],
      zogbo: {
        date: "2026-08-12",
        status: "ouverte",
        lines: [
          {
            productId: "p1",
            name: "POISSON",
            stock: 10,
            prepared: 10,
            sentToGbegamey: 0,
            sold: 10,
            pertes: 0,
            counted: null,
            observations: "",
          },
        ],
        movements: [],
        updatedAt: "2026-08-12T12:00:00.000Z",
      },
    });
    expect(r.caZogboPlats).toBe(0);
    expect(r.caTotal).toBe(0);
  });
});
