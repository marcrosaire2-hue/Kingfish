import { describe, expect, it } from "vitest";
import {
  parametresConsolides,
  parametresPourSite,
  resolveCatalogueSite,
  type ParametresStockes,
} from "@/lib/catalogue-sites";
import {
  computeBoissonsLine,
  emptyBoissonsLine,
  leftoverFromBoissonsLines,
} from "@/lib/boissons-calc";
import type { Drink, SiteCatalogue } from "@/lib/types";

const boisson = (id: string, name: string, upc: number, prix = 600): Drink => ({
  id,
  name,
  purchasePrice: 250,
  salePrice: prix,
  unitsPerCasier: upc,
  alertThreshold: 0,
});

const catalogue = (drinks: Drink[]): SiteCatalogue => ({
  baseDishes: [],
  localDishes: [],
  drinks,
  combos: [],
  categories: [],
  categoryProducts: [],
  updatedAt: null,
});

const commun = boisson("d1", "Commun", 24);
const aquabelle = boisson("fifa-pb", "AQUABELLE", 12);
const fifaPb = boisson("fifa-pb", "FIFA PB", 24, 300);

const separe: ParametresStockes = {
  ...catalogue([commun]),
  rawMaterials: [],
  recipes: [],
  catalogues: {
    zogbo: catalogue([aquabelle]),
    gbegamey: catalogue([fifaPb, boisson("g-seul", "Gbé seul", 12)]),
  },
};

describe("catalogue par site", () => {
  it("donne à chaque site sa propre fiche", () => {
    expect(parametresPourSite(separe, "zogbo").drinks).toEqual([aquabelle]);
    expect(parametresPourSite(separe, "gbegamey").drinks[0]).toEqual(fifaPb);
  });

  it("garde les listes communes tant que la séparation n'a pas eu lieu", () => {
    const avant: ParametresStockes = { ...catalogue([commun]) };
    expect(parametresPourSite(avant, "zogbo").drinks).toEqual([commun]);
    expect(parametresPourSite(avant, "gbegamey").drinks).toEqual([commun]);
  });

  it("consolide sans doublon et conserve le conditionnement Gbégamey", () => {
    const vue = parametresConsolides(separe);
    expect(vue.drinks.map((d) => d.id)).toEqual(["fifa-pb", "g-seul"]);
    expect(vue.drinks[0]!.name).toBe("AQUABELLE");
    expect(vue.drinksGbegamey?.[0]).toEqual(fifaPb);
  });
});

describe("droits sur le catalogue d'un site", () => {
  it("limite un compte à son site", () => {
    expect(resolveCatalogueSite(null, "gbegamey")).toEqual({
      ok: true,
      site: "gbegamey",
    });
    expect(resolveCatalogueSite("zogbo", "gbegamey")).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it("laisse un compte multi-sites choisir", () => {
    expect(resolveCatalogueSite(null, "tous")).toEqual({ ok: true, site: null });
    expect(resolveCatalogueSite("zogbo", "tous")).toEqual({
      ok: true,
      site: "zogbo",
    });
    expect(resolveCatalogueSite("autre", "tous")).toMatchObject({
      ok: false,
      status: 400,
    });
  });
});

describe("stock de boissons avec conditionnements différents", () => {
  const ligne = {
    ...emptyBoissonsLine(aquabelle),
    initialStockZogbo: 1,
    initialStockGbegamey: 118 / 24,
    soldZogbo: 3,
    soldGbegamey: 2,
  };

  it("convertit chaque site avec son propre nombre par casier", () => {
    const c = computeBoissonsLine(ligne, aquabelle, fifaPb);
    expect(c.stockBottlesZogbo).toBe(9);
    expect(c.stockBottlesGbegamey).toBe(116);
    expect(c.soldAmountZogbo).toBe(1800);
    expect(c.soldAmountGbegamey).toBe(600);
    expect(c.margin).toBe(3 * 350 + 2 * 50);
  });

  it("reporte le reste de chaque site avec son conditionnement", () => {
    const reste = leftoverFromBoissonsLines([ligne], [aquabelle], [fifaPb]);
    expect(reste.zogbo.get("fifa-pb")).toBeCloseTo(1 - 3 / 12, 6);
    expect(reste.gbegamey.get("fifa-pb")).toBeCloseTo(116 / 24, 6);
  });
});
