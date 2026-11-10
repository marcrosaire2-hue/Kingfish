import { beforeEach, describe, expect, it, vi } from "vitest";

/** Base en mémoire, juste assez pour le report entre journées. */
type Doc = Record<string, unknown> & { _id: string; rev?: number };
const { base } = vi.hoisted(() => ({ base: new Map<string, Map<string, Doc>>() }));

function correspond(doc: Doc, filtre: Record<string, unknown>): boolean {
  return Object.entries(filtre).every(([cle, attendu]) => {
    const valeur = doc[cle];
    if (attendu && typeof attendu === "object") {
      const o = attendu as Record<string, unknown>;
      if ("$gt" in o && !(String(valeur) > String(o.$gt))) return false;
      if ("$lte" in o && !(String(valeur) <= String(o.$lte))) return false;
      if ("$lt" in o && !(String(valeur) < String(o.$lt))) return false;
      if ("$gte" in o && !(String(valeur) >= String(o.$gte))) return false;
      if ("$exists" in o) return (valeur !== undefined) === o.$exists;
      return true;
    }
    return valeur === attendu;
  });
}

function collection(nom: string) {
  if (!base.has(nom)) base.set(nom, new Map());
  const docs = base.get(nom)!;
  const tous = () => [...docs.values()];
  return {
    findOne: async (f: Record<string, unknown>) =>
      structuredClone(tous().sort((a, b) => a._id.localeCompare(b._id)).find((d) => correspond(d, f)) ?? null),
    find: (f: Record<string, unknown> = {}) => {
      let liste = tous().filter((d) => correspond(d, f));
      const curseur = {
        sort: (s: Record<string, number>) => {
          const sens = s._id ?? 1;
          liste = liste.sort((a, b) => a._id.localeCompare(b._id) * sens);
          return curseur;
        },
        limit: (n: number) => ((liste = liste.slice(0, n)), curseur),
        project: () => curseur,
        toArray: async () => structuredClone(liste),
        next: async () => structuredClone(liste[0] ?? null),
      };
      return curseur;
    },
    updateOne: async (
      f: Record<string, unknown>,
      u: { $set?: Record<string, unknown>; $inc?: { rev?: number } },
    ) => {
      const d = tous().find((x) => correspond(x, f));
      if (!d) return { matchedCount: 0 };
      Object.assign(d, u.$set ?? {});
      if (u.$inc?.rev) d.rev = (d.rev ?? 0) + u.$inc.rev;
      return { matchedCount: 1 };
    },
    insertOne: async (d: Doc) => {
      if (docs.has(d._id)) {
        const error = new Error("duplicate key") as Error & { code?: number };
        error.code = 11000;
        throw error;
      }
      docs.set(d._id, d);
    },
    findOneAndUpdate: async (
      f: Record<string, unknown>,
      u: { $set?: Record<string, unknown> },
    ) => {
      const d = tous().find((x) => correspond(x, f));
      if (!d) return null;
      Object.assign(d, u.$set ?? {});
      return structuredClone(d);
    },
    deleteOne: async (f: Record<string, unknown>) => {
      const d = tous().find((x) => correspond(x, f));
      if (d) docs.delete(d._id);
      return { deletedCount: d ? 1 : 0 };
    },
    bulkWrite: async (
      ops: Array<{ updateOne: { filter: { _id: string }; update: { $setOnInsert: object } } }>,
    ) => {
      for (const { updateOne: o } of ops) {
        if (!docs.has(o.filter._id)) {
          docs.set(o.filter._id, { _id: o.filter._id, ...o.update.$setOnInsert });
        }
      }
    },
  };
}

vi.mock("@/lib/mongodb", () => ({
  getDb: async () => ({ databaseName: `t${base.size >= 0 ? "" : ""}`, collection }),
}));
const boisson = {
  id: "b1",
  name: "Boisson",
  purchasePrice: 100,
  salePrice: 200,
  unitsPerCasier: 12,
  alertThreshold: 0,
};
vi.mock("@/lib/parametres-repo", () => ({
  getParametres: async () => ({
    baseDishes: [{ id: "p1", name: "Plat", unitPrice: 1000 }],
    localDishes: [],
    drinks: [boisson],
    rawMaterials: [],
    recipes: [],
    combos: [],
    categories: [],
    categoryProducts: [],
    drinksGbegamey: [boisson],
    updatedAt: null,
  }),
}));

import { boissonsScope, withStockCarry } from "@/lib/stock-carry";
import { COLLECTION_BOISSONS } from "@/lib/site-collections";

const ligneBoisson = (over: object) => ({
  productId: "b1",
  name: "Boisson",
  initialStockZogbo: 0,
  purchasesZogbo: 0,
  soldZogbo: 0,
  pertesZogbo: 0,
  countedZogbo: null,
  initialStockGbegamey: 0,
  purchasesGbegamey: 0,
  soldGbegamey: 0,
  pertesGbegamey: 0,
  countedGbegamey: null,
  observations: "",
  ...over,
});

const plat = (over: object) => ({
  productId: "p1",
  name: "Plat",
  stock: 0,
  prepared: 0,
  sentToGbegamey: 0,
  sold: 0,
  pertes: 0,
  counted: null,
  observations: "",
  ...over,
});

function poser(nom: string, _id: string, lines: object[]) {
  collection(nom);
  base.get(nom)!.set(_id, {
    _id,
    status: "ouverte",
    lines,
    accompanimentLines: [],
    movements: [],
    updatedAt: "x",
  });
}
const lignes = (nom: string, id: string) =>
  base.get(nom)!.get(id)!.lines as Array<Record<string, number>>;

describe("vente saisie après l'ouverture du lendemain", () => {
  beforeEach(() => base.clear());

  it("plat Zogbo : l'ouverture du lendemain baisse d'autant", async () => {
    poser("zogbo_jours", "2026-11-08", [plat({ stock: 6 })]);
    poser("zogbo_jours", "2026-11-09", [plat({ stock: 6 })]);
    await withStockCarry("zogbo", "2026-11-08", async () => {
      lignes("zogbo_jours", "2026-11-08")[0]!.sold = 5;
    });
    expect(lignes("zogbo_jours", "2026-11-09")[0]!.stock).toBe(1);
  });

  it("boisson : l'ouverture suit, sur le seul site concerné", async () => {
    const zogbo = COLLECTION_BOISSONS.zogbo;
    const gbe = COLLECTION_BOISSONS.gbegamey;
    poser(zogbo, "2026-11-08", [ligneBoisson({ initialStockZogbo: 2 })]);
    poser(zogbo, "2026-11-09", [ligneBoisson({ initialStockZogbo: 2 })]);
    poser(gbe, "2026-11-09", [ligneBoisson({ initialStockGbegamey: 3 })]);
    await withStockCarry(boissonsScope("zogbo"), "2026-11-08", async () => {
      lignes(zogbo, "2026-11-08")[0]!.soldZogbo = 12;
    });
    expect(lignes(zogbo, "2026-11-09")[0]!.initialStockZogbo).toBe(1);
    expect(lignes(gbe, "2026-11-09")[0]!.initialStockGbegamey).toBe(3);
  });

  it("un comptage du lendemain reste vrai : son stock ne bouge pas", async () => {
    const comptage = { theorique: 6, vendu: 0, pertes: 0 };
    poser("zogbo_jours", "2026-11-08", [plat({ stock: 6 })]);
    poser("zogbo_jours", "2026-11-09", [plat({ stock: 6, counted: 10, comptage })]);
    poser("zogbo_jours", "2026-11-10", [plat({ stock: 10 })]);
    await withStockCarry("zogbo", "2026-11-08", async () => {
      lignes("zogbo_jours", "2026-11-08")[0]!.sold = 2;
    });
    const j9 = lignes("zogbo_jours", "2026-11-09")[0]! as unknown as {
      stock: number;
      comptage: { theorique: number };
    };
    expect(j9.stock).toBe(4);
    expect(j9.comptage.theorique).toBe(4);
    expect(lignes("zogbo_jours", "2026-11-10")[0]!.stock).toBe(10);
  });
});
