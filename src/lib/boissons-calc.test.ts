import { describe, expect, it } from "vitest";
import {
  applyBoissonsCarryToDay,
  applyBoissonsPurchaseToState,
  boissonsLeftoverDelta,
  bouteillesAcheteesParBoisson,
  cancelBoissonsMovementInState,
  computeBoissonsLine,
  formatCasiers,
  guessUnitsPerCasier,
  leftoverFromBoissonsLines,
  normalizeBoissonsLine,
  physicalBoissonsStockForSite,
  unitsPerCasierOf,
} from "@/lib/boissons-calc";
import type { BoissonsLine, Drink } from "@/lib/types";

function ligne(patch: Partial<BoissonsLine> = {}): BoissonsLine {
  return {
    productId: "drink-beaufort",
    name: "Beaufort",
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
    ...patch,
  };
}

function boisson(patch: Partial<Drink> = {}): Drink {
  return {
    id: "drink-beaufort",
    name: "Beaufort",
    purchasePrice: 400,
    salePrice: 600,
    unitsPerCasier: 12,
    ...patch,
  } as Drink;
}

describe("physicalBoissonsStockForSite", () => {
  it("convertit les casiers en bouteilles avant de retirer les ventes", () => {
    // 3 casiers de 12 = 36 bouteilles, moins 5 vendues à Zogbo.
    expect(
      physicalBoissonsStockForSite(
        ligne({ initialStockZogbo: 2, purchasesZogbo: 1, soldZogbo: 5 }),
        "zogbo",
        12,
      ),
    ).toBe(31);
  });

  it("les deux sites sont indépendants : vendre à Zogbo ne touche pas Gbégamey", () => {
    const l = ligne({
      initialStockZogbo: 3,
      soldZogbo: 5,
      initialStockGbegamey: 3,
      soldGbegamey: 4,
    });
    expect(physicalBoissonsStockForSite(l, "zogbo", 12)).toBe(31);
    expect(physicalBoissonsStockForSite(l, "gbegamey", 12)).toBe(32);
  });

  it("conserve le négatif comme signal de survente", () => {
    expect(
      physicalBoissonsStockForSite(
        ligne({ initialStockZogbo: 1, soldZogbo: 50 }),
        "zogbo",
        12,
      ),
    ).toBe(-38);
  });

  it("les ventes faites après un comptage partent du stock compté", () => {
    // Compté 24 bt alors que le calcul donnait 3 casiers, puis 5 ventes.
    expect(
      physicalBoissonsStockForSite(
        ligne({
          initialStockZogbo: 3,
          soldZogbo: 5,
          countedZogbo: 24,
          comptageZogbo: { theorique: 3, vendu: 0, pertes: 0 },
        }),
        "zogbo",
        12,
      ),
    ).toBe(19);
  });

  it("un comptage sans repère vaut stock restant", () => {
    expect(
      physicalBoissonsStockForSite(
        ligne({
          initialStockZogbo: 2,
          purchasesZogbo: 1,
          soldZogbo: 5,
          countedZogbo: 24,
        }),
        "zogbo",
        12,
      ),
    ).toBe(24);
  });

  it("un comptage à zéro vide le stock vendable", () => {
    expect(
      physicalBoissonsStockForSite(
        ligne({
          initialStockZogbo: 2,
          purchasesZogbo: 1,
          soldZogbo: 1,
          countedZogbo: 0,
        }),
        "zogbo",
        12,
      ),
    ).toBe(0);
  });

  it("retombe sur le conditionnement par défaut si la valeur est absurde", () => {
    const l = ligne({ initialStockZogbo: 1 });
    expect(physicalBoissonsStockForSite(l, "zogbo", 0)).toBe(
      physicalBoissonsStockForSite(l, "zogbo", 12),
    );
    expect(physicalBoissonsStockForSite(l, "zogbo", -3)).toBeGreaterThan(0);
  });
});

describe("achat après comptage", () => {
  it("Zogbo : ajoute les bouteilles achetées au stock compté, et les retire à l'annulation", () => {
    // Comptage 10 bt à Zogbo, puis achat de 24 bt (2 casiers de 12).
    const achat = applyBoissonsPurchaseToState(
      [ligne({ initialStockZogbo: 1, countedZogbo: 10 })],
      [],
      { productId: "drink-beaufort", site: "zogbo", qty: 2, unitsPerCasier: 12 },
    );
    // Comptage sans repère : il suit l'achat pour ne pas le perdre.
    expect(achat.lines[0]!.countedZogbo).toBe(34);
    expect(physicalBoissonsStockForSite(achat.lines[0]!, "zogbo", 12)).toBe(34);

    const annule = cancelBoissonsMovementInState(
      achat.lines,
      achat.movements,
      achat.movement.id,
      12,
    );
    expect(annule.lines[0]!.countedZogbo).toBe(10);
  });

  it("Zogbo : laisse le comptage vide s'il n'a pas été saisi", () => {
    const achat = applyBoissonsPurchaseToState([ligne()], [], {
      productId: "drink-beaufort",
      site: "zogbo",
      qty: 2,
      unitsPerCasier: 12,
    });
    expect(achat.lines[0]!.countedZogbo).toBeNull();
    expect(physicalBoissonsStockForSite(achat.lines[0]!, "zogbo", 12)).toBe(24);
  });

  it("Gbégamey : l'achat s'ajoute au stock compté, sans réécrire le comptage", () => {
    const achat = applyBoissonsPurchaseToState(
      [
        ligne({
          countedGbegamey: 10,
          comptageGbegamey: { theorique: 0, vendu: 0, pertes: 0 },
        }),
      ],
      [],
      { productId: "drink-beaufort", site: "gbegamey", qty: 2, unitsPerCasier: 12 },
    );
    expect(achat.lines[0]!.countedGbegamey).toBe(10);
    expect(physicalBoissonsStockForSite(achat.lines[0]!, "gbegamey", 12)).toBe(34);
  });
});

describe("unitsPerCasierOf / guessUnitsPerCasier", () => {
  it("utilise le conditionnement déclaré du produit", () => {
    expect(unitsPerCasierOf(boisson({ unitsPerCasier: 24 }))).toBe(24);
  });

  it("devine un conditionnement quand rien n'est déclaré", () => {
    expect(guessUnitsPerCasier("Beaufort GB")).toBeGreaterThan(0);
  });

  it("ne renvoie jamais zéro, qui provoquerait une division par zéro", () => {
    expect(unitsPerCasierOf(undefined)).toBeGreaterThan(0);
    expect(unitsPerCasierOf(null)).toBeGreaterThan(0);
  });
});

describe("computeBoissonsLine", () => {
  it("calcule la marge sur le total vendu (deux sites)", () => {
    const c = computeBoissonsLine(
      ligne({ initialStockZogbo: 5, soldZogbo: 10, soldGbegamey: 2 }),
      boisson(),
    );
    expect(c.soldTotal).toBe(12);
    expect(c.soldAmount).toBe(12 * 600);
    expect(c.margin).toBe(12 * (600 - 400));
  });

  it("laisse la marge indéterminée sans prix de vente", () => {
    const c = computeBoissonsLine(
      ligne({ initialStockZogbo: 5, soldZogbo: 3 }),
      boisson({ salePrice: null }),
    );
    expect(c.margin).toBeNull();
    // Sans prix, aucun chiffre d'affaires ne doit être inventé.
    expect(c.soldAmount).toBe(0);
  });

  it("sépare le chiffre d'affaires des deux points de vente", () => {
    const c = computeBoissonsLine(
      ligne({ initialStockZogbo: 5, soldZogbo: 4, soldGbegamey: 6 }),
      boisson(),
    );
    expect(c.soldAmountZogbo).toBe(4 * 600);
    expect(c.soldAmountGbegamey).toBe(6 * 600);
    expect(c.soldAmount).toBe(c.soldAmountZogbo + c.soldAmountGbegamey);
  });

  it("mesure l'écart entre théorique et comptage physique, par site", () => {
    const c = computeBoissonsLine(
      ligne({
        initialStockZogbo: 10,
        soldZogbo: 12,
        countedZogbo: 96,
        initialStockGbegamey: 5,
        soldGbegamey: 6,
        countedGbegamey: 48,
      }),
      boisson(),
    );
    // Écart = comptage − théorique. 9 calculés, 8 comptés → −1, reste 8.
    expect(c.theoreticalRemainingZogbo).toBe(8);
    expect(c.varianceZogbo).toBe(-1);
    // 4,5 calculés, 4 comptés → −0,5, reste 4.
    expect(c.theoreticalRemainingGbegamey).toBe(4);
    expect(c.varianceGbegamey).toBe(-0.5);
  });

  it("reporte le comptage en casiers pour le jour suivant, par site", () => {
    const { zogbo, gbegamey } = leftoverFromBoissonsLines(
      [ligne({ initialStockZogbo: 3, countedZogbo: 25, countedGbegamey: 13 })],
      [boisson()],
    );
    // 25 bouteilles comptées = 2,08 casiers reportés.
    expect(zogbo.get("drink-beaufort")).toBeCloseTo(25 / 12, 2);
    expect(gbegamey.get("drink-beaufort")).toBeCloseTo(13 / 12, 2);
  });

  it("ne calcule aucun écart tant que rien n'est compté", () => {
    const c = computeBoissonsLine(ligne({ initialStockZogbo: 3 }), boisson());
    expect(c.varianceZogbo).toBeNull();
    expect(c.varianceGbegamey).toBeNull();
  });
});

describe("normalizeBoissonsLine", () => {
  it("garde l'ouverture négative, borne les mouvements", () => {
    const l = normalizeBoissonsLine(
      ligne({ initialStockZogbo: -4, purchasesZogbo: -1, soldZogbo: -9 }),
    );
    expect(l.initialStockZogbo).toBe(-4);
    expect(l.purchasesZogbo).toBe(0);
    expect(l.soldZogbo).toBe(0);
  });

  it("ramène un comptage à virgule à un nombre entier de bouteilles", () => {
    // Résidu de conversion casiers → bouteilles trouvé en base (« 1.92 bt ») :
    // une bouteille ne se compte pas en fractions.
    expect(
      normalizeBoissonsLine(ligne({ countedZogbo: 1.92 })).countedZogbo,
    ).toBe(2);
    expect(
      normalizeBoissonsLine(ligne({ countedZogbo: 23.04 })).countedZogbo,
    ).toBe(23);
    expect(normalizeBoissonsLine(ligne({ countedZogbo: 0 })).countedZogbo).toBe(
      0,
    );
    expect(
      normalizeBoissonsLine(ligne({ countedZogbo: null })).countedZogbo,
    ).toBeNull();
  });

  it("le report d'un jour sur l'autre ne fabrique plus de décimales", () => {
    // Le report sort en casiers arrondis à 2 décimales ; reconverti en
    // bouteilles il doit retomber sur un entier, jour après jour.
    const upc = 12;
    const veille = ligne({ countedZogbo: 23 });
    const casiers = leftoverFromBoissonsLines(
      [veille],
      [boisson({ unitsPerCasier: upc })],
    ).zogbo.get("drink-beaufort")!;
    const ouverture = normalizeBoissonsLine(
      ligne({ countedZogbo: Math.round(casiers * upc) }),
    );
    expect(Number.isInteger(ouverture.countedZogbo!)).toBe(true);
    expect(ouverture.countedZogbo).toBe(23);
  });

  it("une donnée héritée (avant séparation par site) est reflétée sur les deux sites, pas fabriquée à zéro pour l'un d'eux", () => {
    const legacy = {
      productId: "drink-beaufort",
      name: "Beaufort",
      initialStock: 4,
      purchases: 1,
      soldZogbo: 2,
      soldGbegamey: 1,
      pertes: 0,
      counted: 30,
      observations: "",
    };
    const l = normalizeBoissonsLine(legacy);
    expect(l.initialStockZogbo).toBe(4);
    expect(l.initialStockGbegamey).toBe(4);
    expect(l.countedZogbo).toBe(30);
    expect(l.countedGbegamey).toBe(30);
    // Les ventes déjà réparties par site restent inchangées.
    expect(l.soldZogbo).toBe(2);
    expect(l.soldGbegamey).toBe(1);
  });

  it("préserve un stockTracked explicitement à false, pas seulement à true", () => {
    // Un comptage périmé (ex. 0 saisi à l'ouverture) plaque sinon la vente
    // au stock même en mode vente libre : la seule échappatoire est de
    // dé-suivre le produit explicitement, et ce `false` ne doit pas
    // disparaître à la relecture.
    expect(
      normalizeBoissonsLine(ligne({ stockTrackedGbegamey: true }))
        .stockTrackedGbegamey,
    ).toBe(true);
    expect(
      normalizeBoissonsLine(ligne({ stockTrackedGbegamey: false }))
        .stockTrackedGbegamey,
    ).toBe(false);
    expect(
      normalizeBoissonsLine(ligne({})).stockTrackedGbegamey,
    ).toBeUndefined();
    expect(
      normalizeBoissonsLine(ligne({ stockTrackedZogbo: false }))
        .stockTrackedZogbo,
    ).toBe(false);
  });
});

describe("formatCasiers", () => {
  it("affiche les casiers sans décimale superflue", () => {
    expect(formatCasiers(3)).toBe("3");
  });

  it("garde la fraction quand elle existe", () => {
    expect(formatCasiers(2.5)).toContain("2");
  });
});

describe("report d'une correction sur les jours suivants", () => {
  const drinks = [boisson()];

  it("une vente saisie en retard réduit l'ouverture du lendemain", () => {
    // Jour J : 2 casiers ouverts, 0 vendu → reste 2 casiers (24 bt).
    const avant = leftoverFromBoissonsLines(
      [ligne({ initialStockZogbo: 2 })],
      drinks,
    );
    // Saisie après coup : 6 bouteilles vendues le jour J.
    const apres = leftoverFromBoissonsLines(
      [ligne({ initialStockZogbo: 2, soldZogbo: 6 })],
      drinks,
    );
    const delta = boissonsLeftoverDelta(avant, apres);
    expect(delta.zogbo.get("drink-beaufort")).toBeCloseTo(-0.5);
    expect(delta.gbegamey.size).toBe(0);

    // Lendemain ouvert plus tôt avec l'ancien reste (2 casiers).
    const { lines, next, changed } = applyBoissonsCarryToDay(
      [ligne({ initialStockZogbo: 2 })],
      delta,
    );
    expect(changed).toBe(true);
    expect(lines[0]!.initialStockZogbo).toBeCloseTo(1.5);
    expect(physicalBoissonsStockForSite(lines[0]!, "zogbo", 12)).toBe(18);
    // Pas de comptage le lendemain : l'écart continue vers J+2.
    expect(next.zogbo.get("drink-beaufort")).toBeCloseTo(-0.5);
  });

  it("garde une ouverture corrigée à la main et ajoute seulement l'écart", () => {
    const delta = {
      zogbo: new Map([["drink-beaufort", -0.25]]),
      gbegamey: new Map<string, number>(),
    };
    const { lines } = applyBoissonsCarryToDay(
      [ligne({ initialStockZogbo: 3 })],
      delta,
    );
    expect(lines[0]!.initialStockZogbo).toBeCloseTo(2.75);
  });

  it("s'arrête au jour qui porte un comptage pour ce site", () => {
    const delta = {
      zogbo: new Map([["drink-beaufort", -0.5]]),
      gbegamey: new Map([["drink-beaufort", 1]]),
    };
    const { lines, next } = applyBoissonsCarryToDay(
      [ligne({ initialStockZogbo: 2, countedZogbo: 20, initialStockGbegamey: 1 })],
      delta,
    );
    expect(lines[0]!.initialStockZogbo).toBeCloseTo(1.5);
    expect(lines[0]!.initialStockGbegamey).toBeCloseTo(2);
    expect(next.zogbo.has("drink-beaufort")).toBe(false);
    expect(next.gbegamey.get("drink-beaufort")).toBeCloseTo(1);
  });

  it("conserve le négatif et ne touche pas l'autre site", () => {
    const delta = {
      zogbo: new Map([["drink-beaufort", -5]]),
      gbegamey: new Map<string, number>(),
    };
    const { lines } = applyBoissonsCarryToDay(
      [ligne({ initialStockZogbo: 1, initialStockGbegamey: 4 })],
      delta,
    );
    expect(lines[0]!.initialStockZogbo).toBe(-4);
    expect(lines[0]!.initialStockGbegamey).toBe(4);
  });

  it("aucun écart : rien ne change", () => {
    const l = leftoverFromBoissonsLines([ligne({ initialStockZogbo: 2 })], drinks);
    const delta = boissonsLeftoverDelta(l, l);
    const { changed } = applyBoissonsCarryToDay([ligne({ initialStockZogbo: 2 })], delta);
    expect(changed).toBe(false);
  });
});

describe("caisse restée sur un jour passé", () => {
  const drinks = [boisson({ unitsPerCasier: 12 })];

  it("compte les bouteilles achetées sur les jours suivants, par site", () => {
    const achats = bouteillesAcheteesParBoisson(
      [
        [ligne({ purchasesZogbo: 3.08, purchasesGbegamey: 1 })],
        [ligne({ purchasesZogbo: 0.25 })],
      ],
      "zogbo",
      drinks,
    );
    // (3,08 + 0,25) casiers × 12 = 39,96 → 40 bouteilles.
    expect(achats.get("drink-beaufort")).toBe(40);
    const g = bouteillesAcheteesParBoisson([[ligne({ purchasesGbegamey: 1 })]], "gbegamey", drinks);
    expect(g.get("drink-beaufort")).toBe(12);
  });

  it("retire les ventes et pertes déjà portées sur les jours suivants", () => {
    // Lendemain : 3 casiers achetés (36 bt), 5 vendues, 2 cassées → 29 bt.
    const net = bouteillesAcheteesParBoisson(
      [[ligne({ purchasesZogbo: 3, soldZogbo: 5, pertesZogbo: 2 })]],
      "zogbo",
      drinks,
    );
    expect(net.get("drink-beaufort")).toBe(29);
  });

  it("garde un reste négatif pour le report quand on le demande", () => {
    // 1 casier (12 bt) ouvert, 20 vendues grâce à un achat du lendemain.
    const lignes = [ligne({ initialStockZogbo: 1, soldZogbo: 20 })];
    expect(leftoverFromBoissonsLines(lignes, drinks).zogbo.get("drink-beaufort")).toBe(0);
    const brut = leftoverFromBoissonsLines(lignes, drinks, drinks, { plancher: false });
    expect(brut.zogbo.get("drink-beaufort")).toBeCloseTo(-8 / 12, 5);
  });

  it("une survente du jour de caisse retire les bouteilles du lendemain", () => {
    // Jour J : 8 bt (0,67 casier), lendemain ouvert avec ce reste + 37 bt achetées.
    const avant = leftoverFromBoissonsLines(
      [ligne({ initialStockZogbo: 8 / 12 })],
      drinks,
      drinks,
      { plancher: false },
    );
    // La caisse du jour J vend 20 bt (8 du jour + 12 achetées le lendemain).
    const apres = leftoverFromBoissonsLines(
      [ligne({ initialStockZogbo: 8 / 12, soldZogbo: 20 })],
      drinks,
      drinks,
      { plancher: false },
    );
    const delta = boissonsLeftoverDelta(avant, apres);
    const { lines } = applyBoissonsCarryToDay(
      [ligne({ initialStockZogbo: 8 / 12, purchasesZogbo: 37 / 12 })],
      delta,
    );
    // Lendemain : 8 + 37 − 20 = 25 bouteilles, pas 37 (bouteilles fantômes).
    expect(physicalBoissonsStockForSite(lines[0]!, "zogbo", 12)).toBe(25);
  });
});

describe("scénario Béninoise GB : caisse au 10/11, régularisation au 11/11", () => {
  const drinks = [boisson({ unitsPerCasier: 12 })];
  const brut = (lignes: BoissonsLine[]) =>
    leftoverFromBoissonsLines(lignes, drinks, drinks, { plancher: false });

  it("stock vendable, sortie, reste et lendemain restent justes", () => {
    // 10/11 : 12 bt ouvertes, 4 déjà vendues. 11/11 : ouvert avec 8 bt, 37 achetées.
    let jour10 = ligne({ initialStockZogbo: 1, soldZogbo: 4 });
    let jour11 = ligne({ initialStockZogbo: 8 / 12, purchasesZogbo: 37 / 12 });

    // Vente (caisse au 10/11) : 8 du jour + 37 achetées le 11 = 45 vendables.
    const vendable = () =>
      physicalBoissonsStockForSite(jour10, "zogbo", 12) +
      (bouteillesAcheteesParBoisson([[jour11]], "zogbo", drinks).get("drink-beaufort") ?? 0);
    expect(vendable()).toBe(45);

    // La caisse vend 20 bt le 10/11 : sortie sur le 10, report sur le 11.
    const avant = brut([jour10]);
    jour10 = ligne({ ...jour10, soldZogbo: 24 });
    const delta = boissonsLeftoverDelta(avant, brut([jour10]));
    jour11 = applyBoissonsCarryToDay([jour11], delta).lines[0]!;

    // Reste vendable après la vente : 45 − 20 = 25.
    expect(vendable()).toBe(25);
    // Le 10/11 passe à −12 (8 − 20), couvert par l'achat du 11.
    expect(physicalBoissonsStockForSite(jour10, "zogbo", 12)).toBe(-12);
    // Le 11/11 (après bascule de la caisse) : −12 + 37 = 25, pas de bouteille fantôme.
    expect(physicalBoissonsStockForSite(jour11, "zogbo", 12)).toBe(25);
  });
});
