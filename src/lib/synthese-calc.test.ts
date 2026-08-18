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

  it("compte les achats du registre comme une charge", () => {
    // Un achat saisi sur la page Achats pèse sur le résultat sans que le
    // gérant ait à le retaper dans « matières premières ».
    const base = emptyCharges("2026-08-12");
    expect(chargesTotal({ ...base, achatsStock: 113850 })).toBe(113850);
    expect(
      chargesTotal({ ...base, matieresPremieres: 10000, achatsStock: 5000 }),
    ).toBe(15000);
  });

  it("ignore un total d'achats absent ou aberrant", () => {
    const base = emptyCharges("2026-08-12");
    expect(chargesTotal({ ...base, achatsStock: undefined })).toBe(0);
    expect(chargesTotal({ ...base, achatsStock: -500 })).toBe(0);
  });

  it("une journée vierge ne coûte rien", () => {
    expect(chargesTotal(emptyCharges("2026-08-12"))).toBe(0);
  });
});

describe("computeDayRevenue — étanchéité des comptes verrouillés sur une zone", () => {
  // Journée où seul Zogbo a vendu (plats, accompagnements, boissons) ;
  // Gbégamey n'a rien vendu ce jour-là — exactement le cas qui a révélé le
  // bug : un compte verrouillé sur Gbégamey voyait le CA boissons de Zogbo
  // pendant que ses plats/accompagnements Zogbo étaient déjà à zéro, un
  // mélange incohérent selon la catégorie de produit.
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
    combosCatalog: [],
    drinksCatalog: [],
    zogbo: null,
    gbegamey: null,
    combos: null,
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
});
