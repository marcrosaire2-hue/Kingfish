import { describe, expect, it } from "vitest";
import {
  allocatedReductionsByProduct,
  allocatedReductionsBySite,
  netAfterProrate,
  productNetKey,
} from "@/lib/ca-allocation";
import {
  brutAmortissable,
  dotationJour,
  remainingAmortizableBase,
  valeurNette,
} from "@/lib/immobilisations-repo";
import {
  balanceGenerale,
  ecrituresChargeManuelle,
  ecrituresMouvement,
  ecrituresPartieDouble,
  ecrituresReglementCharge,
  ecrituresVente,
  resultatNetDeBalance,
  splitCaisseDepenseAgainstManual,
  totaux,
} from "@/lib/journal-comptable-calc";
import {
  applyMatieresPurchaseToState,
  valueMatieresConsumed,
} from "@/lib/matieres-calc";
import { COMPTES, compteDepense } from "@/lib/plan-comptable";
import { caCumulWindows } from "@/lib/synthese-repo";
import {
  chargesTotal,
  computeDayRevenue,
  emptyCharges,
  emptyVenteTotals,
} from "@/lib/synthese-calc";
import type {
  CaisseMouvement,
  DayCharges,
  Immobilisation,
  MatieresLine,
} from "@/lib/types";
import { applyShiftReductions } from "@/lib/vente-repo";
import { shouldSkipAquaproDuplicate } from "@/lib/ventes-history-repo";
import type { UserShift } from "@/lib/auth-types";

function mouvement(over: Partial<CaisseMouvement>): CaisseMouvement {
  return {
    id: "m1",
    caisseId: "c1",
    kind: "depense",
    nature: "Loyer magasin",
    beneficiaire: "",
    montant: 50000,
    at: "2026-08-01T10:00:00.000Z",
    cancelledAt: null,
    ...over,
  };
}

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

describe("F1 — réconciliation résultat applicatif / journal", () => {
  it("fait converger CA net − charges et le résultat de balance", () => {
    const ventes = ecrituresVente({
      date: "2026-08-01",
      numero: "T-1",
      caisse: "zogbo",
      reduction: 10000,
      lignes: [{ kind: "plat", montant: 100000 }],
    });
    const cmvMat = ecrituresPartieDouble({
      date: "2026-08-01",
      piece: "cmv-m",
      libelle: "CMV matières",
      debitCompte: COMPTES.ACHATS_MATIERES,
      creditCompte: COMPTES.STOCK_MATIERES,
      montant: 20000,
    });
    const cmvB = ecrituresPartieDouble({
      date: "2026-08-01",
      piece: "cmv-b",
      libelle: "CMV boissons",
      debitCompte: COMPTES.ACHATS_BOISSONS,
      creditCompte: COMPTES.STOCK_BOISSONS,
      montant: 5000,
    });
    const cmvE = ecrituresPartieDouble({
      date: "2026-08-01",
      piece: "cmv-e",
      libelle: "CMV emballages",
      debitCompte: COMPTES.ACHATS_EMBALLAGES,
      creditCompte: COMPTES.STOCK_EMBALLAGES,
      montant: 400,
    });
    const loyer = ecrituresChargeManuelle({
      date: "2026-08-01",
      poste: "loyer",
      montant: 10000,
    });
    const amort = ecrituresPartieDouble({
      date: "2026-08-01",
      piece: "amort",
      libelle: "Dotation",
      debitCompte: COMPTES.DOTATIONS_AMORT,
      creditCompte: COMPTES.AMORTISSEMENTS_CUMULES,
      montant: 1000,
    });
    const pertes = ecrituresPartieDouble({
      date: "2026-08-01",
      piece: "perte",
      libelle: "Pertes",
      debitCompte: COMPTES.PERTES_STOCK,
      creditCompte: COMPTES.COMPTE_ATTENTE,
      montant: 2000,
    });
    const journal = [
      ...ventes,
      ...cmvMat,
      ...cmvB,
      ...cmvE,
      ...loyer,
      ...amort,
      ...pertes,
    ];
    expect(totaux(journal).equilibre).toBe(true);

    const applicatif =
      90000 -
      chargesTotal({
        ...emptyCharges("2026-08-01"),
        matieresConsommees: 20000,
        cmvBoissons: 5000,
        cmvEmballages: 400,
        loyer: 10000,
        amortissements: 1000,
        pertes: 2000,
      });
    expect(resultatNetDeBalance(balanceGenerale(journal))).toBe(applicatif);
    expect(applicatif).toBe(51600);
  });
});

describe("F2 — lignes de CA et total net", () => {
  it("le prorata ticket conserve la somme nette", () => {
    const nets = netAfterProrate([2000, 1000, 3350, 0], 350);
    expect(nets.reduce((s, n) => s + n, 0)).toBe(6000);
  });

  it("les natures affichées somment au CA net, pas au brut", () => {
    const r = computeDayRevenue({
      baseDishes: [],
      localDishes: [],
      drinksCatalog: [],
      zogbo: null,
      gbegamey: null,
      boissons: null,
      ventes: {
        ...emptyVenteTotals(),
        platsZogbo: 2000,
        localZogbo: 1000,
        boissonsZogbo: 3350,
        reductionsZogbo: 350,
      },
    });
    expect(r.caTotal).toBe(6000);
    expect(
      r.caZogboPlats +
        r.caAccompagnementsZogbo +
        r.caBoissonsZogbo +
        r.caExtraZogbo,
    ).toBe(r.caTotal);
  });
});

describe("F3 / F4 — CMV boissons et emballages (kind extra) dans le résultat", () => {
  it("une vente de boisson et d’emballage (extra) diminuent le résultat via le CMV", () => {
    const charges: DayCharges = {
      ...emptyCharges("2026-08-01"),
      cmvBoissons: 1500,
      cmvEmballages: 400,
    };
    expect(chargesTotal(charges)).toBe(1900);
    expect(chargesTotal({ ...charges, achatsStock: 80000 })).toBe(1900);
  });
});

describe("F5 — résultat de zone réconciliable", () => {
  const ventes = {
    ...emptyVenteTotals(),
    platsZogbo: 4000,
    platsGbegamey: 2500,
    reductionsZogbo: 400,
    reductionsGbegamey: 100,
  };
  const base = {
    baseDishes: [] as never[],
    localDishes: [] as never[],
    drinksCatalog: [] as never[],
    zogbo: null,
    gbegamey: null,
    boissons: null,
    ventes,
  };

  it("CA maison = CA Zogbo verrouillé + CA Gbégamey verrouillé", () => {
    const maison = computeDayRevenue(base);
    const z = computeDayRevenue({ ...base, scopeSite: "zogbo" });
    const g = computeDayRevenue({ ...base, scopeSite: "gbegamey" });
    expect(z.caTotal + g.caTotal).toBe(maison.caTotal);
    expect(maison.caTotal).toBe(6000);
  });

  it("loyer / salaires restent hors vue zone ; CMV zoné reste dans la zone", () => {
    const maison = chargesTotal({
      ...emptyCharges("2026-08-01"),
      loyer: 10000,
      salaires: 20000,
      cmvBoissons: 1500,
    });
    const zone = chargesTotal({
      ...emptyCharges("2026-08-01"),
      loyer: 0,
      salaires: 0,
      cmvBoissons: 1500,
    });
    expect(maison).toBe(31500);
    expect(zone).toBe(1500);
    expect(maison - zone).toBe(30000);
  });
});

describe("F6 — pas de double comptage matières", () => {
  it("ignore la saisie manuelle dès que le CMV stock est présent", () => {
    expect(
      chargesTotal({
        ...emptyCharges("2026-08-01"),
        matieresPremieres: 10000,
        matieresConsommees: 8000,
      }),
    ).toBe(8000);
  });
});

describe("F7 — dépense caisse + charge manuelle", () => {
  it("ne double pas la classe 6 : l’overlap est un règlement 4711", () => {
    const split = splitCaisseDepenseAgainstManual({
      montant: 50000,
      alreadyCharged: 50000,
    });
    expect(split).toEqual({ reglement: 50000, charge: 0 });
    const reglement = ecrituresReglementCharge({
      date: "2026-08-01",
      piece: "m1",
      libelle: "Règlement loyer",
      caisse: "zogbo",
      montant: 50000,
    });
    const manuelle = ecrituresChargeManuelle({
      date: "2026-08-01",
      poste: "loyer",
      montant: 50000,
    });
    const all = [...manuelle, ...reglement];
    const classe6 = all.filter((e) => e.compte.startsWith("6") && e.debit > 0);
    expect(classe6.reduce((s, e) => s + e.debit, 0)).toBe(50000);
    expect(
      all.some((e) => e.compte === COMPTES.COMPTE_ATTENTE.numero && e.debit > 0),
    ).toBe(true);
  });

  it("le surplus de caisse au-delà du manuel reste une charge 6", () => {
    expect(
      splitCaisseDepenseAgainstManual({
        montant: 70000,
        alreadyCharged: 50000,
      }),
    ).toEqual({ reglement: 50000, charge: 20000 });
  });

  it("caractérisation : deux dépenses distinctes même date|compte partagent un seul budget manuel", () => {
    const budgetManuel = 50000;
    const a = splitCaisseDepenseAgainstManual({
      montant: 30000,
      alreadyCharged: budgetManuel,
    });
    expect(a).toEqual({ reglement: 30000, charge: 0 });
    const b = splitCaisseDepenseAgainstManual({
      montant: 40000,
      alreadyCharged: budgetManuel - a.reglement,
    });
    expect(b).toEqual({ reglement: 20000, charge: 20000 });
  });
});

describe("F8 — CA par équipe net", () => {
  it("une remise de 10 000 sur 100 000 donne 90 000 à l’équipe", () => {
    const byDate = new Map<string, Record<UserShift, number>>([
      ["2026-08-01", { jour: 100000, soir: 0, nuit: 0, aucune: 0 }],
    ]);
    const reductions = new Map<string, Record<UserShift, number>>([
      ["2026-08-01", { jour: 10000, soir: 0, nuit: 0, aucune: 0 }],
    ]);
    applyShiftReductions(byDate, reductions);
    expect(byDate.get("2026-08-01")!.jour).toBe(90000);
  });
});

describe("F9 — remise ticket par ticket", () => {
  it("n’applique pas un ratio global à tout le catalogue", () => {
    const red = allocatedReductionsByProduct([
      {
        reduction: 1000,
        lines: [
          { productId: "a", kind: "plat", amount: 4000 },
          { productId: "b", kind: "plat", amount: 1000 },
        ],
      },
    ]);
    expect(red.get(productNetKey("plat", "a"))).toBe(800);
    expect(red.get(productNetKey("plat", "b"))).toBe(200);
    expect(red.get(productNetKey("plat", "c"))).toBeUndefined();
  });

  it("impute la remise au site du ticket", () => {
    const bySite = allocatedReductionsBySite([
      { site: "zogbo", reduction: 10000 },
      { site: "gbegamey", reduction: 0 },
    ]);
    expect(bySite.get("zogbo")).toBe(10000);
    expect(bySite.get("gbegamey")).toBeUndefined();
  });
});

describe("F10 — CMV au coût historique", () => {
  it("une conso reste valorisée au CUMP d’achat après hausse du catalogue", () => {
    const ligne: MatieresLine = {
      productId: "mat-riz",
      name: "RIZ",
      initialStock: 0,
      purchases: 0,
      consumed: 0,
      pertes: 0,
      counted: null,
      observations: "",
    };
    const { lines } = applyMatieresPurchaseToState([ligne], [], {
      productId: "mat-riz",
      qty: 10,
      unitPrice: 1000,
    });
    const consumed = { ...lines[0]!, consumed: 2 };
    const catalog = new Map([["mat-riz", 1500]]);
    expect(valueMatieresConsumed([consumed], [], catalog)).toBe(2000);
  });

  it("valorise au CUMP réel après deux achats à coûts différents", () => {
    const ligne: MatieresLine = {
      productId: "mat-riz",
      name: "RIZ",
      initialStock: 0,
      purchases: 0,
      consumed: 0,
      pertes: 0,
      counted: null,
      observations: "",
    };
    const first = applyMatieresPurchaseToState([ligne], [], {
      productId: "mat-riz",
      qty: 10,
      unitPrice: 1000,
    });
    const second = applyMatieresPurchaseToState(first.lines, first.movements, {
      productId: "mat-riz",
      qty: 10,
      unitPrice: 2000,
    });
    expect(second.lines[0]!.unitCost).toBe(1500);
    const consumed = { ...second.lines[0]!, consumed: 2 };
    expect(
      valueMatieresConsumed([consumed], second.movements, new Map([["mat-riz", 9999]])),
    ).toBe(3000);
  });
});

describe("F11 / F15 — perte d’actif et fiche inactive", () => {
  it("qty 0 annule la base restante et la dotation, brut d’acquisition figé", () => {
    const perdu = immo({ qty: 0 });
    expect(brutAmortissable(perdu)).toBe(250000);
    expect(remainingAmortizableBase(perdu)).toBe(0);
    expect(valeurNette(perdu, "2026-06-01")).toBe(0);
    expect(dotationJour(perdu, "2026-06-01")).toBe(0);
  });

  it("conserve la dotation avant inactiveSince, puis s’arrête", () => {
    const fiche = immo({ inactiveSince: "2026-07-01" });
    expect(dotationJour(fiche, "2026-06-30")).toBeGreaterThan(0);
    expect(dotationJour(fiche, "2026-07-01")).toBe(0);
  });

  it("une perte partielle réduit la base restante, brut d’acquisition inchangé", () => {
    const partiel = immo({ qty: 1, acquisitionQty: 2, acquisitionAmount: 250000 });
    expect(brutAmortissable(partiel)).toBe(250000);
    expect(remainingAmortizableBase(partiel)).toBe(125000);
  });

  it("gèle la VNC à la date de sortie, sans continuer l’amortissement", () => {
    const fiche = immo({ inactiveSince: "2026-07-01" });
    const vnc = valeurNette(fiche, "2026-06-30");
    expect(valeurNette(fiche, "2026-12-31")).toBe(vnc);
  });
});

describe("F12 — cumuls calés sur la date de vue", () => {
  it("une vue de mars 2025 ne prend pas août 2026 (aujourd’hui)", () => {
    const w = caCumulWindows("2025-03-15");
    expect(w.monthStart).toBe("2025-03-01");
    expect(w.monthEnd).toBe("2025-03-31");
    expect(w.yearStart).toBe("2025-01-01");
    expect(w.yearEnd).toBe("2025-12-31");
  });

  it("ancre décembre 2025, janvier 2026 et août 2026 sur leur propre période", () => {
    expect(caCumulWindows("2025-12-20")).toEqual({
      monthStart: "2025-12-01",
      monthEnd: "2025-12-31",
      yearStart: "2025-01-01",
      yearEnd: "2025-12-31",
    });
    expect(caCumulWindows("2026-01-05")).toEqual({
      monthStart: "2026-01-01",
      monthEnd: "2026-01-31",
      yearStart: "2026-01-01",
      yearEnd: "2026-12-31",
    });
    expect(caCumulWindows("2026-08-24")).toEqual({
      monthStart: "2026-08-01",
      monthEnd: "2026-08-31",
      yearStart: "2026-01-01",
      yearEnd: "2026-12-31",
    });
  });

  it("utilise le vrai dernier jour de février (bissextile ou non)", () => {
    expect(caCumulWindows("2026-02-10").monthEnd).toBe("2026-02-28");
    expect(caCumulWindows("2024-02-29").monthEnd).toBe("2024-02-29");
  });
});

describe("F13 — pas de double CA AquaPro", () => {
  it("ignore un ticket AquaPro déjà présent côté King Fish", () => {
    const keys = new Set(["2026-08-01|A-12"]);
    expect(shouldSkipAquaproDuplicate(keys, "2026-08-01", "A-12")).toBe(true);
    expect(shouldSkipAquaproDuplicate(keys, "2026-08-01", "A-99")).toBe(false);
    expect(shouldSkipAquaproDuplicate(keys, "2026-08-01", "")).toBe(false);
  });

  it("ne confond pas le même numéro à deux dates, ni un numéro vide", () => {
    const keys = new Set(["2026-08-01|A-12"]);
    expect(shouldSkipAquaproDuplicate(keys, "2026-08-02", "A-12")).toBe(false);
    expect(shouldSkipAquaproDuplicate(keys, "2026-08-01", "  ")).toBe(false);
  });
});

describe("F14 — acquisition immo ≠ charge d’exploitation", () => {
  it("route la dépense caisse vers 2181 et l’exclut du résultat", () => {
    const { compte, confiant } = compteDepense("Immobilisation · Frigo +1");
    expect(compte.numero).toBe(COMPTES.IMMOBILISATIONS.numero);
    expect(confiant).toBe(true);
    expect(
      chargesTotal({
        ...emptyCharges("2026-08-01"),
        immobilisations: 250000,
        amortissements: 137,
      }),
    ).toBe(137);
  });
});

describe("F16 — recette de caisse en 7588, non confiante", () => {
  it("crédite les produits divers à reclasser", () => {
    const lignes = ecrituresMouvement({
      date: "2026-08-01",
      caisse: "zogbo",
      mouvement: mouvement({
        kind: "recette",
        nature: "Remboursement",
        montant: 2000,
      }),
    });
    const credit = lignes.find((l) => l.credit > 0)!;
    expect(credit.compte).toBe(COMPTES.PRODUITS_DIVERS_A_RECLASSER.numero);
    expect(credit.compte.startsWith("707")).toBe(false);
    expect(credit.confiant).toBe(false);
  });
});

describe("périmètres caisse vs CdR — caractérisation volontaire", () => {
  it("une dépense caisse sans charge manuelle n’entre pas dans chargesTotal", () => {
    const synthese = chargesTotal(emptyCharges("2026-08-01"));
    const journal = splitCaisseDepenseAgainstManual({
      montant: 40000,
      alreadyCharged: 0,
    });
    expect(synthese).toBe(0);
    expect(journal).toEqual({ reglement: 0, charge: 40000 });
  });

  it("une extra sans coût figé n’invente pas de CMV emballages", () => {
    expect(
      chargesTotal({ ...emptyCharges("2026-08-01"), cmvEmballages: 0 }),
    ).toBe(0);
  });
});
