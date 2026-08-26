import { describe, expect, it } from "vitest";
import {
  comboEconomie,
  comboPrixNormal,
  comboStockLeft,
  normalizeComboDish,
} from "@/lib/combos-model";
import type { Parametres, VenteProduct } from "@/lib/types";

const parametres = {
  baseDishes: [{ id: "p1", name: "Poisson", unitPrice: 2000 }],
  localDishes: [{ id: "a1", name: "Riz", unitPrice: 500 }],
  drinks: [],
  combos: [],
  updatedAt: null,
} as Parametres;

describe("combos-model", () => {
  it("calcule prix normal et économie", () => {
    const combo = normalizeComboDish({
      id: "c1",
      name: "Menu riz",
      unitPrice: 2200,
      components: [
        { kind: "plat", productId: "p1", qty: 1 },
        { kind: "local", productId: "a1", qty: 1 },
      ],
      active: true,
    });
    expect(comboPrixNormal(combo, parametres)).toBe(2500);
    expect(comboEconomie(combo, parametres)).toBe(300);
  });

  it("borne le stock au composant le plus rare", () => {
    const combo = normalizeComboDish({
      id: "c1",
      name: "Menu",
      unitPrice: 2000,
      components: [
        { kind: "plat", productId: "p1", qty: 1 },
        { kind: "local", productId: "a1", qty: 2 },
      ],
      active: true,
    });
    const products = [
      {
        kind: "plat",
        productId: "p1",
        name: "Poisson",
        unitPrice: 2000,
        soldToday: 0,
        stockLeft: 5,
      },
      {
        kind: "local",
        productId: "a1",
        name: "Riz",
        unitPrice: 500,
        soldToday: 0,
        stockLeft: 3,
      },
    ] as VenteProduct[];
    expect(comboStockLeft(combo, products)).toBe(1);
  });
});
