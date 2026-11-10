import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Base en mémoire, juste assez pour les flux du magasin. */
type Doc = Record<string, unknown> & { _id: unknown };
const { base } = vi.hoisted(() => ({ base: new Map<string, Doc[]>() }));

function correspond(doc: Doc, filtre: Record<string, unknown>): boolean {
  return Object.entries(filtre).every(([cle, attendu]) => {
    const valeur = doc[cle];
    if (attendu && typeof attendu === "object") {
      const o = attendu as Record<string, string>;
      if ("$regex" in o) return new RegExp(o.$regex).test(String(valeur));
      if ("$gte" in o) return String(valeur) >= o.$gte;
      return false;
    }
    if (attendu === null) return valeur === null || valeur === undefined;
    return valeur === attendu;
  });
}

function collection(nom: string) {
  if (!base.has(nom)) base.set(nom, []);
  const docs = base.get(nom)!;
  const appliquer = (
    filter: Record<string, unknown>,
    update: { $set?: object; $setOnInsert?: object },
    upsert?: boolean,
  ) => {
    const trouve = docs.find((d) => correspond(d, filter));
    if (trouve) {
      Object.assign(trouve, update.$set ?? {});
      return { matchedCount: 1, upsertedCount: 0 };
    }
    if (!upsert) return { matchedCount: 0, upsertedCount: 0 };
    docs.push({
      _id: new ObjectId(),
      ...filter,
      ...(update.$set ?? {}),
      ...(update.$setOnInsert ?? {}),
    });
    return { matchedCount: 0, upsertedCount: 1 };
  };
  return {
    findOne: async (f: Record<string, unknown>) =>
      structuredClone(docs.find((d) => correspond(d, f)) ?? null),
    find: (f: Record<string, unknown> = {}) => {
      let liste = docs.filter((d) => correspond(d, f));
      const curseur = {
        sort: (s: Record<string, number>) => {
          const cle = Object.keys(s)[0]!;
          const sens = s[cle]!;
          liste = [...liste].sort(
            (a, b) => String(a[cle]).localeCompare(String(b[cle])) * sens,
          );
          return curseur;
        },
        limit: (n: number) => ((liste = liste.slice(0, n)), curseur),
        toArray: async () => liste.map((d) => ({ ...d })),
      };
      return curseur;
    },
    updateOne: async (
      f: Record<string, unknown>,
      u: { $set?: object; $setOnInsert?: object },
      o?: { upsert?: boolean },
    ) => appliquer(f, u, o?.upsert),
    updateMany: async (f: Record<string, unknown>, u: { $set?: object }) => {
      docs.filter((d) => correspond(d, f)).forEach((d) => Object.assign(d, u.$set));
      return {};
    },
    insertOne: async (d: Doc) => {
      docs.push(d);
    },
    insertMany: async (list: Doc[]) => {
      docs.push(...list);
    },
    deleteOne: async (f: Record<string, unknown>) => {
      const i = docs.findIndex((d) => correspond(d, f));
      if (i >= 0) docs.splice(i, 1);
      return { deletedCount: i >= 0 ? 1 : 0 };
    },
    deleteMany: async (f: Record<string, unknown>) => {
      base.set(nom, docs.filter((d) => !correspond(d, f)));
      return {};
    },
    findOneAndUpdate: async (f: Record<string, unknown>, u: { $set?: object }) => {
      const d = docs.find((x) => correspond(x, f));
      if (!d) return null;
      Object.assign(d, u.$set);
      return { ...d };
    },
    bulkWrite: async (
      ops: Array<{ updateOne: { filter: Record<string, unknown>; update: { $setOnInsert: object } } }>,
    ) => {
      let upsertedCount = 0;
      for (const { updateOne } of ops) {
        upsertedCount += appliquer(updateOne.filter, updateOne.update, true).upsertedCount;
      }
      return { upsertedCount, matchedCount: ops.length - upsertedCount };
    },
  };
}

vi.mock("@/lib/mongodb", () => ({
  getDb: async () => ({ databaseName: "test", collection }),
}));

import {
  ajusterConsommationVente,
  annulerConsommationVente,
  annulerProduction,
  declarerProduction,
  enregistrerComptage,
  enregistrerConsommationVente,
  enregistrerEntree,
  etatMagasin,
  lireConsommationVente,
  preparationPlat,
  preparationsPlats,
  saveArticle,
  saveFiche,
  transfererConsommationVente,
} from "@/lib/magasin-repo";

const site = "gbegamey" as const;
const actor = { id: "u1", name: "Gérant" };

async function stock(id: string): Promise<number> {
  const etat = await etatMagasin(site);
  return [...etat.stock, ...etat.portions].find((l) => l.id === id)?.stock ?? 0;
}

const vente = (venteId: string, productId: string, qty: number) => ({
  venteId,
  site,
  date: "2026-11-10",
  at: `2026-11-10T12:00:0${venteId.length % 10}.000Z`,
  kind: "plat" as const,
  productId,
  qty,
  actor,
});

describe("flux du magasin", () => {
  let huile: string;
  let graine: string;
  let piment: string;

  beforeEach(async () => {
    base.clear();
    huile = (await saveArticle({ site, name: "Huile", unit: "L", unitPrice: 1200 })).id;
    graine = (await saveArticle({ site, name: "Graine", unit: "kg", unitPrice: 800 })).id;
    piment = (await saveArticle({ site, name: "Piment", unit: "kg", unitPrice: 2000 })).id;
    await enregistrerEntree({ site, articleId: huile, qty: 10, actor });
    await enregistrerEntree({ site, articleId: graine, qty: 10, actor });
    await enregistrerEntree({ site, articleId: piment, qty: 1, actor });
    await saveFiche({
      site,
      productKind: "plat",
      productId: "tilapia",
      productName: "Tilapia",
      mode: "commande",
      lines: [
        { articleId: huile, qty: 0.05 },
        { articleId: piment, qty: 0.01, supplement: true },
      ],
    });
    await saveFiche({
      site,
      productKind: "plat",
      productId: "sauce",
      productName: "Sauce graine",
      mode: "lot",
      portions: 20,
      lines: [
        { articleId: graine, qty: 2 },
        { articleId: huile, qty: 0.5 },
      ],
    });
  });

  it("une vente retire les ingrédients, son annulation les rend exactement", async () => {
    await enregistrerConsommationVente({
      ...vente("v1", "tilapia", 2),
      ajustements: { supplements: [{ articleId: piment, qty: 1 }] },
    });
    expect(await stock(huile)).toBe(9.9);
    expect(await stock(piment)).toBe(0.99);

    await annulerConsommationVente({ venteId: "v1", site, date: "2026-11-10" });
    expect(await stock(huile)).toBe(10);
    expect(await stock(piment)).toBe(1);
  });

  it("un manque n'est pas retiré et apparaît au rapport, jusqu'à l'annulation", async () => {
    await enregistrerConsommationVente({
      ...vente("v1", "tilapia", 3),
      ajustements: { manquants: [{ articleId: huile, qty: 1 }] },
    });
    expect(await stock(huile)).toBe(9.9);
    let etat = await etatMagasin(site);
    expect(etat.manquants[0]).toMatchObject({ name: "Huile", declarations: 1, avecStock: 1 });

    await annulerConsommationVente({ venteId: "v1", site, date: "2026-11-10" });
    etat = await etatMagasin(site);
    expect(etat.manquants).toEqual([]);
  });

  it("une correction de quantité garde la proportion", async () => {
    await enregistrerConsommationVente(vente("v1", "tilapia", 2));
    await ajusterConsommationVente({
      venteId: "v1",
      site,
      date: "2026-11-10",
      ancienneQty: 2,
      nouvelleQty: 4,
    });
    expect(await stock(huile)).toBe(9.8);
    await ajusterConsommationVente({
      venteId: "v1",
      site,
      date: "2026-11-10",
      ancienneQty: 4,
      nouvelleQty: 1,
    });
    expect(await stock(huile)).toBe(9.95);
  });

  it("changer la fiche après la vente ne réécrit pas le passé", async () => {
    await enregistrerConsommationVente(vente("v1", "tilapia", 2));
    await saveFiche({
      site,
      productKind: "plat",
      productId: "tilapia",
      productName: "Tilapia",
      mode: "commande",
      lines: [{ articleId: huile, qty: 0.5 }],
    });
    await annulerConsommationVente({ venteId: "v1", site, date: "2026-11-10" });
    expect(await stock(huile)).toBe(10);
  });

  it("une production sort les ingrédients et crée les portions vendues ensuite", async () => {
    const etat = await etatMagasin(site);
    const fiche = etat.fichesLot[0]!;
    const production = await declarerProduction({ site, ficheId: fiche.id, lots: 1, actor });
    expect(await stock(graine)).toBe(8);
    expect(await stock(huile)).toBe(9.5);
    expect(await stock(fiche.id)).toBe(20);

    await enregistrerConsommationVente(vente("v2", "sauce", 3));
    expect(await stock(fiche.id)).toBe(17);
    expect(await stock(graine)).toBe(8);

    await annulerProduction({ site, id: production.id, actor });
    expect(await stock(graine)).toBe(10);
    expect(await stock(huile)).toBe(10);
    expect(await stock(fiche.id)).toBe(-3);
  });

  it("un ingrédient absent à la production n'est pas sorti", async () => {
    const fiche = (await etatMagasin(site)).fichesLot[0]!;
    await declarerProduction({
      site,
      ficheId: fiche.id,
      lots: 1,
      portions: 18,
      saisies: [{ articleId: huile, manquant: true }],
      actor,
    });
    expect(await stock(huile)).toBe(10);
    expect(await stock(fiche.id)).toBe(18);
    const etat = await etatMagasin(site);
    expect(etat.productions[0]!.ecartPortions).toBe(-2);
    expect(etat.manquants[0]!.name).toBe("Huile");
  });

  it("un comptage écrit le stock et fige l'écart", async () => {
    await enregistrerConsommationVente(vente("v1", "tilapia", 2));
    await enregistrerComptage({ site, family: "magasin", itemId: huile, qty: 9, actor });
    const ligne = (await etatMagasin(site)).stock.find((l) => l.id === huile)!;
    expect(ligne.stock).toBe(9);
    expect(ligne.lastEcart).toBe(-0.9);
  });

  it("une vente déplacée garde sa consommation et ses manques", async () => {
    await enregistrerConsommationVente({
      ...vente("v1", "tilapia", 3),
      ajustements: { manquants: [{ articleId: huile, qty: 1 }] },
    });
    const consommation = await lireConsommationVente({ venteId: "v1", site });
    await annulerConsommationVente({ venteId: "v1", site, date: "2026-11-10" });
    expect(await stock(huile)).toBe(10);

    await transfererConsommationVente({
      consommation: consommation!,
      ancienId: "v1",
      nouvelId: "v9",
      site,
      date: "2026-11-11",
      at: "2026-11-11T12:00:00.000Z",
      facteur: 1,
    });
    expect(await stock(huile)).toBe(9.9);
    expect((await etatMagasin(site)).manquants[0]).toMatchObject({ name: "Huile", declarations: 1 });

    await annulerConsommationVente({ venteId: "v9", site, date: "2026-11-11" });
    expect(await stock(huile)).toBe(10);
  });

  it("une entrée liée à un achat ne compte qu'une fois et garde le dernier prix", async () => {
    await enregistrerEntree({ site, articleId: piment, qty: 2, reference: "achat-1", unitPrice: 2500, actor });
    await enregistrerEntree({ site, articleId: piment, qty: 2, reference: "achat-1", unitPrice: 2500, actor });
    expect(await stock(piment)).toBe(3);
    expect((await etatMagasin(site)).articles.find((a) => a.id === piment)!.unitPrice).toBe(2500);
  });

  it("donne à la caisse les portions restantes des seuls plats préparés", async () => {
    const fiche = (await etatMagasin(site)).fichesLot[0]!;
    expect(await preparationPlat(site, "sauce")).toBe(0);
    expect(await preparationPlat(site, "tilapia")).toBeNull();
    expect(await preparationPlat(site, "inconnu")).toBeNull();

    await declarerProduction({ site, ficheId: fiche.id, lots: 1, actor });
    await enregistrerConsommationVente(vente("v1", "sauce", 3));

    expect(await preparationPlat(site, "sauce")).toBe(17);
    const preparations = await preparationsPlats(site);
    expect(preparations.get("sauce")).toEqual({ stock: 17, production: 20 });
    expect(preparations.has("tilapia")).toBe(false);
  });

  it("le piment coché sort du stock, même sur un plat sans fiche", async () => {
    const pili = await saveArticle({ site, name: "Piment rouge", unit: "kg", supplement: true, dose: 0.005 });
    await enregistrerEntree({ site, articleId: pili.id, qty: 1, actor });

    await enregistrerConsommationVente(vente("v1", "sans-fiche", 2));
    expect(await stock(pili.id)).toBe(1);

    await enregistrerConsommationVente({
      ...vente("v2", "sans-fiche", 2),
      ajustements: { supplements: [{ articleId: pili.id, qty: 1 }] },
    });
    expect(await stock(pili.id)).toBe(0.995);

    await annulerConsommationVente({ venteId: "v2", site, date: "2026-11-10" });
    expect(await stock(pili.id)).toBe(1);
  });

  it("refuse un supplément sans quantité par plat", async () => {
    await expect(
      saveArticle({ site, name: "Mayonnaise", unit: "kg", supplement: true }),
    ).rejects.toThrow(/quantité/);
  });

  it("ne touche à rien sans fiche, ni pour Zogbo", async () => {
    await enregistrerConsommationVente(vente("v1", "inconnu", 2));
    await enregistrerConsommationVente({ ...vente("v2", "tilapia", 2), site: "zogbo" });
    expect(await stock(huile)).toBe(10);
  });
});
