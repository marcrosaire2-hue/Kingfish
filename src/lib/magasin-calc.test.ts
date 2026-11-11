import { describe, expect, it } from "vitest";
import { boissonsLibres } from "@/lib/ventes-sans-stock";
import {
  baseVersRecette,
  choisirComptages,
  computeConsommationVente,
  computeProduction,
  consommationNette,
  ficheId,
  magasinActif,
  normalizeAjustements,
  normalizeFiche,
  recetteVersBase,
  statutPlatCaisse,
  syntheseManquants,
  uniteRecette,
  type Fiche,
  type MagasinArticle,
} from "@/lib/magasin-calc";

const commande: Fiche = {
  id: ficheId("gbegamey", "plat", "tilapia"),
  site: "gbegamey",
  productKind: "plat",
  productId: "tilapia",
  productName: "Tilapia braisé",
  mode: "commande",
  portions: 0,
  lines: [
    { articleId: "poisson", qty: 1, supplement: false },
    { articleId: "huile", qty: 0.02, supplement: false },
    { articleId: "piment", qty: 0.01, supplement: true },
  ],
  updatedAt: null,
};

const lot: Fiche = {
  ...commande,
  id: ficheId("gbegamey", "plat", "sauce"),
  productId: "sauce",
  productName: "Sauce graine",
  mode: "lot",
  portions: 20,
  lines: [
    { articleId: "graine", qty: 2, supplement: false },
    { articleId: "huile", qty: 0.5, supplement: false },
    { articleId: "piment", qty: 0.01, supplement: true },
  ],
};

const article = (id: string, over: Partial<MagasinArticle> = {}): MagasinArticle => ({
  id,
  site: "gbegamey",
  name: id,
  unit: "kg",
  unitPrice: 1000,
  threshold: 0,
  active: true,
  ...over,
});

describe("périmètre et unités", () => {
  it("n'active le magasin qu'à Gbégamey", () => {
    expect(magasinActif("gbegamey")).toBe(true);
    expect(magasinActif("zogbo")).toBe(false);
  });

  it("convertit les grammes et millilitres vers l'unité d'achat", () => {
    expect(recetteVersBase(20, "kg")).toBe(0.02);
    expect(recetteVersBase(500, "L")).toBe(0.5);
    expect(recetteVersBase(2, "u")).toBe(2);
    expect(baseVersRecette(0.02, "kg")).toBe(20);
  });

  it("garde les grammes tels quels pour un article suivi en grammes", () => {
    expect(uniteRecette("g")).toBe("g");
    expect(recetteVersBase(1.75, "g")).toBe(1.75);
    expect(baseVersRecette(2.5, "g")).toBe(2.5);
  });
});

describe("fiche de composition", () => {
  const articles = [{ id: "huile" }, { id: "sel" }];
  const base = {
    site: "gbegamey" as const,
    productKind: "plat",
    productId: "p1",
    productName: "Plat",
    mode: "commande",
    lines: [{ articleId: "huile", qty: 0.02 }],
  };

  it("construit l'identifiant par site et produit", () => {
    const fiche = normalizeFiche(base, articles);
    expect(fiche.id).toBe("gbegamey:plat:p1");
    expect(fiche.lines[0]).toEqual({ articleId: "huile", qty: 0.02, supplement: false });
  });

  it("exige les portions d'un lot", () => {
    expect(() => normalizeFiche({ ...base, mode: "lot" }, articles)).toThrow(/portions/);
  });

  it("refuse un ingrédient inconnu, en double ou sans quantité", () => {
    expect(() =>
      normalizeFiche({ ...base, lines: [{ articleId: "x", qty: 1 }] }, articles),
    ).toThrow(/inconnu/);
    expect(() =>
      normalizeFiche(
        { ...base, lines: [{ articleId: "huile", qty: 1 }, { articleId: "huile", qty: 2 }] },
        articles,
      ),
    ).toThrow(/qu'une fois/);
    expect(() =>
      normalizeFiche({ ...base, lines: [{ articleId: "huile", qty: 0 }] }, articles),
    ).toThrow(/quantité/);
  });
});

describe("vente à la commande", () => {
  it("retire les ingrédients fixes sans geste, pas les suppléments", () => {
    const { lignes, manquants } = computeConsommationVente({ fiche: commande, qty: 3 });
    expect(lignes).toEqual([
      { family: "magasin", itemId: "poisson", qty: 3 },
      { family: "magasin", itemId: "huile", qty: 0.06 },
    ]);
    expect(manquants).toEqual([]);
  });

  it("n'applique un manque qu'aux plats indiqués", () => {
    const { lignes, manquants } = computeConsommationVente({
      fiche: commande,
      qty: 3,
      ajustements: { manquants: [{ articleId: "huile", qty: 1 }] },
    });
    expect(lignes[1]).toEqual({ family: "magasin", itemId: "huile", qty: 0.04 });
    expect(manquants).toEqual([{ family: "magasin", itemId: "huile", qty: 1 }]);
  });

  it("ne retire rien quand l'ingrédient manque sur tous les plats", () => {
    const { lignes } = computeConsommationVente({
      fiche: commande,
      qty: 2,
      ajustements: { manquants: [{ articleId: "poisson", qty: 2 }] },
    });
    expect(lignes.map((l) => l.itemId)).toEqual(["huile"]);
  });

  it("retire un supplément coché sur le nombre de plats indiqué", () => {
    const { lignes } = computeConsommationVente({
      fiche: commande,
      qty: 3,
      ajustements: { supplements: [{ articleId: "piment", qty: 2 }] },
    });
    expect(lignes).toContainEqual({ family: "magasin", itemId: "piment", qty: 0.02 });
  });

  it("borne un envoi incohérent au nombre de plats vendus", () => {
    const { lignes, manquants } = computeConsommationVente({
      fiche: commande,
      qty: 2,
      ajustements: {
        manquants: [{ articleId: "huile", qty: 99 }],
        supplements: [{ articleId: "piment", qty: 99 }],
      },
    });
    expect(lignes.map((l) => l.itemId)).toEqual(["poisson", "piment"]);
    expect(manquants[0]!.qty).toBe(2);
  });

  it("ignore un ingrédient qui n'est pas dans la fiche", () => {
    const { lignes } = computeConsommationVente({
      fiche: commande,
      qty: 1,
      ajustements: { supplements: [{ articleId: "inconnu", qty: 1 }] },
    });
    expect(lignes.some((l) => l.itemId === "inconnu")).toBe(false);
  });
});

describe("supplément du catalogue (piment)", () => {
  const supplementsCatalogue = [{ id: "pili", dose: 0.005 }];

  it("ne retire rien s'il n'est pas coché", () => {
    const { lignes } = computeConsommationVente({ fiche: null, qty: 2, supplementsCatalogue });
    expect(lignes).toEqual([]);
  });

  it("se retire même sur un plat sans fiche, selon le nombre de plats", () => {
    const { lignes } = computeConsommationVente({
      fiche: null,
      qty: 3,
      supplementsCatalogue,
      ajustements: { supplements: [{ articleId: "pili", qty: 2 }] },
    });
    expect(lignes).toEqual([{ family: "magasin", itemId: "pili", qty: 0.01 }]);
  });

  it("s'ajoute aux ingrédients d'une fiche et reste borné aux plats vendus", () => {
    const { lignes } = computeConsommationVente({
      fiche: commande,
      qty: 2,
      supplementsCatalogue,
      ajustements: { supplements: [{ articleId: "pili", qty: 99 }] },
    });
    expect(lignes).toContainEqual({ family: "magasin", itemId: "pili", qty: 0.01 });
    expect(lignes).toContainEqual({ family: "magasin", itemId: "poisson", qty: 2 });
  });

  it("additionne s'il est aussi ingrédient, sans perdre de ligne", () => {
    const { lignes } = computeConsommationVente({
      fiche: commande,
      qty: 1,
      supplementsCatalogue: [{ id: "huile", dose: 0.01 }],
      ajustements: { supplements: [{ articleId: "huile", qty: 1 }] },
    });
    expect(lignes.filter((l) => l.itemId === "huile")).toEqual([
      { family: "magasin", itemId: "huile", qty: 0.03 },
    ]);
  });
});

describe("vente d'une fiche en lot", () => {
  it("retire des portions, jamais les ingrédients", () => {
    const { lignes } = computeConsommationVente({ fiche: lot, qty: 4 });
    expect(lignes).toEqual([{ family: "portion", itemId: lot.id, qty: 4 }]);
  });

  it("enlève les portions non servies", () => {
    const { lignes, manquants } = computeConsommationVente({
      fiche: lot,
      qty: 4,
      ajustements: { portionsManquantes: 1 },
    });
    expect(lignes[0]!.qty).toBe(3);
    expect(manquants).toEqual([{ family: "portion", itemId: lot.id, qty: 1 }]);
  });

  it("retire quand même un supplément coché à la vente", () => {
    const { lignes } = computeConsommationVente({
      fiche: lot,
      qty: 1,
      ajustements: { supplements: [{ articleId: "piment", qty: 1 }] },
    });
    expect(lignes).toContainEqual({ family: "magasin", itemId: "piment", qty: 0.01 });
  });
});

describe("boissons selon le stock", () => {
  it("plafonne les boissons dès que leur réglage est actif", () => {
    expect(boissonsLibres(true, false)).toBe(true);
    expect(boissonsLibres(true, true)).toBe(false);
    expect(boissonsLibres(false, false)).toBe(false);
    expect(boissonsLibres(false, true)).toBe(false);
  });
});

describe("plat à la caisse", () => {
  it("laisse libre un plat sans préparation, même en vente selon le stock", () => {
    expect(statutPlatCaisse({ preparation: undefined, venteLibre: false })).toEqual({
      stockLeft: null,
      hint: "Vente libre",
      blockReason: null,
    });
  });

  it("affiche le reste sans bloquer en vente libre", () => {
    const s = statutPlatCaisse({ preparation: { stock: -2, production: 5 }, venteLibre: true });
    expect(s).toMatchObject({ stockLeft: null, portionsRestantes: -2, blockReason: null });
  });

  it("plafonne au reste en vente selon le stock", () => {
    const s = statutPlatCaisse({ preparation: { stock: 7, production: 10 }, venteLibre: false });
    expect(s).toMatchObject({ stockLeft: 7, portionsRestantes: 7, blockReason: null });
  });

  it("explique le blocage selon qu'il y a eu une préparation ou non", () => {
    expect(
      statutPlatCaisse({ preparation: { stock: 0, production: 0 }, venteLibre: false }).blockReason,
    ).toBe("Pas encore préparé");
    expect(
      statutPlatCaisse({ preparation: { stock: 0, production: 4 }, venteLibre: false }).blockReason,
    ).toBe("Stock épuisé");
  });
});

describe("normalisation des exceptions de caisse", () => {
  it("renvoie rien quand il n'y a aucune exception", () => {
    expect(normalizeAjustements(undefined)).toBeUndefined();
    expect(normalizeAjustements({ manquants: [{ articleId: "a", qty: 0 }] })).toBeUndefined();
  });

  it("garde les seules exceptions valides", () => {
    expect(
      normalizeAjustements({
        manquants: [{ articleId: "a", qty: 2 }, { articleId: "", qty: 3 }],
        portionsManquantes: "1",
      }),
    ).toEqual({ manquants: [{ articleId: "a", qty: 2 }], portionsManquantes: 1 });
  });
});

describe("production en lot", () => {
  it("sort les quantités prévues et compte les portions attendues", () => {
    const p = computeProduction({ fiche: lot, lots: 2 });
    expect(p.lignes).toEqual([
      { articleId: "graine", prevu: 4, reel: 4, manquant: false },
      { articleId: "huile", prevu: 1, reel: 1, manquant: false },
    ]);
    expect(p.portions).toBe(40);
    expect(p.ecartPortions).toBe(0);
  });

  it("ne sort pas un ingrédient manquant et applique les quantités réelles", () => {
    const p = computeProduction({
      fiche: lot,
      lots: 1,
      saisies: [
        { articleId: "huile", manquant: true },
        { articleId: "graine", reel: 1.5 },
      ],
    });
    expect(p.lignes[0]!.reel).toBe(1.5);
    expect(p.lignes[1]).toEqual({ articleId: "huile", prevu: 0.5, reel: 0, manquant: true });
  });

  it("mesure le rendement réel", () => {
    expect(computeProduction({ fiche: lot, lots: 1, portions: 18 }).ecartPortions).toBe(-2);
  });

  it("refuse une fiche à la commande ou un lot nul", () => {
    expect(() => computeProduction({ fiche: commande, lots: 1 })).toThrow(/commande/);
    expect(() => computeProduction({ fiche: lot, lots: 0 })).toThrow(/lots/);
  });
});

describe("consommation nette d'une vente", () => {
  it("déduit les annulations", () => {
    const net = consommationNette([
      { family: "magasin", productId: "huile", type: "consommation", qty: 0.06 },
      { family: "magasin", productId: "huile", type: "annulation", qty: 0.02 },
      { family: "portion", productId: "sauce", type: "vente", qty: 2 },
    ]);
    expect(net.get("magasin|huile")!.net).toBe(0.04);
    expect(net.get("portion|sauce")!.net).toBe(2);
  });
});

describe("articles à compter", () => {
  const balances = new Map([
    ["vu", { stock: 10, lastEcart: 0, lastCountAt: "2026-11-09T10:00:00.000Z" }],
    ["jour", { stock: 10, lastEcart: 0, lastCountAt: "2026-11-10T08:00:00.000Z" }],
  ]);

  it("priorise le jamais compté et sort le compté du jour", () => {
    const ids = choisirComptages({
      articles: [article("vu"), article("jour"), article("neuf")],
      balances,
      today: "2026-11-10",
    });
    expect(ids).toEqual(["neuf", "vu"]);
  });

  it("limite la liste et ignore les articles inactifs", () => {
    const ids = choisirComptages({
      articles: [article("a"), article("b"), article("c", { active: false })],
      balances: new Map(),
      today: "2026-11-10",
      limit: 1,
    });
    expect(ids).toHaveLength(1);
    expect(ids).not.toContain("c");
  });
});

describe("rapport des manquants", () => {
  const row = (stockAuMoment: number) => ({
    family: "magasin" as const,
    itemId: "huile",
    name: "Huile",
    qty: 1,
    stockAuMoment,
  });

  it("additionne les déclarations", () => {
    const [s] = syntheseManquants([row(0), row(0)]);
    expect(s).toMatchObject({ declarations: 2, qty: 2, avecStock: 0, alerte: false });
  });

  it("alerte quand le manque est répété alors que le stock existe", () => {
    expect(syntheseManquants([row(5), row(5), row(5)])[0]!.alerte).toBe(true);
    expect(syntheseManquants([row(5), row(5), row(0)])[0]!.alerte).toBe(false);
  });
});
