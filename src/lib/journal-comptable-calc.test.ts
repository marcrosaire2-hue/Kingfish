import { describe, expect, it } from "vitest";
import {
  balanceGenerale,
  ecrituresChargeManuelle,
  ecrituresMouvement,
  ecrituresVente,
  ecrituresVersement,
  grandLivre,
  resultatNetDeBalance,
  totaux,
  type EcritureComptable,
} from "@/lib/journal-comptable-calc";
import { COMPTES } from "@/lib/plan-comptable";
import type { CaisseMouvement } from "@/lib/types";

function mouvement(over: Partial<CaisseMouvement>): CaisseMouvement {
  return {
    id: "mvt1",
    caisseId: "c1",
    kind: "depense",
    nature: "Divers",
    beneficiaire: "",
    montant: 1000,
    at: "2026-08-01T10:00:00.000Z",
    cancelledAt: null,
    ...over,
  };
}

describe("ecrituresVente", () => {
  it("équilibre une vente d'une seule catégorie sans réduction", () => {
    const lignes = ecrituresVente({
      date: "2026-08-01",
      numero: "T-1",
      caisse: "zogbo",
      reduction: 0,
      lignes: [{ kind: "plat", montant: 5000 }],
    });
    expect(totaux(lignes)).toEqual({ debit: 5000, credit: 5000, equilibre: true });
    // Le crédit va au sous-compte Plats, le débit à la caisse Zogbo.
    const credit = lignes.find((l) => l.credit > 0)!;
    expect(credit.compte).toBe(COMPTES.VENTES_PLATS.numero);
  });

  it("ventile le crédit par catégorie quand le ticket mélange plat et boisson", () => {
    const lignes = ecrituresVente({
      date: "2026-08-01",
      numero: "T-2",
      caisse: "zogbo",
      reduction: 0,
      lignes: [
        { kind: "plat", montant: 3000 },
        { kind: "boisson", montant: 500 },
      ],
    });
    expect(totaux(lignes)).toEqual({ debit: 3500, credit: 3500, equilibre: true });
    const plats = lignes.find((l) => l.compte === COMPTES.VENTES_PLATS.numero);
    expect(plats?.credit).toBe(3000);
    const boissons = lignes.find((l) => l.compte === COMPTES.VENTES_BOISSONS.numero);
    expect(boissons?.credit).toBe(500);
  });

  it("route un article sans catégorie (import, ex-combo) vers « Autres »", () => {
    const lignes = ecrituresVente({
      date: "2026-08-01",
      numero: "T-2b",
      caisse: "gbegamey",
      reduction: 0,
      lignes: [{ kind: undefined, montant: 1200 }],
    });
    const autres = lignes.find((l) => l.compte === COMPTES.VENTES_AUTRES.numero);
    expect(autres?.credit).toBe(1200);
  });

  it("constate la réduction séparément (compte 709) et équilibre sur le brut", () => {
    const lignes = ecrituresVente({
      date: "2026-08-01",
      numero: "T-3",
      caisse: "gbegamey",
      reduction: 500,
      lignes: [{ kind: "boisson", montant: 4500 }],
    });
    expect(totaux(lignes)).toEqual({ debit: 4500, credit: 4500, equilibre: true });
    const rabais = lignes.find((l) => l.compte === COMPTES.RABAIS_REMISES.numero);
    expect(rabais?.debit).toBe(500);
    const ventes = lignes.find((l) => l.compte === COMPTES.VENTES_BOISSONS.numero);
    expect(ventes?.credit).toBe(4500);
  });

  it("ne produit rien pour un montant nul", () => {
    expect(
      ecrituresVente({
        date: "2026-08-01",
        numero: "T-4",
        caisse: "zogbo",
        reduction: 0,
        lignes: [{ kind: "plat", montant: 0 }],
      }),
    ).toHaveLength(0);
  });
});

describe("ecrituresMouvement", () => {
  it("route une dépense d'immobilisation vers le compte immobilisations, avec confiance", () => {
    const lignes = ecrituresMouvement({
      date: "2026-08-01",
      caisse: "zogbo",
      mouvement: mouvement({ nature: "Immobilisation · Boîte emporté +5" }),
    });
    expect(totaux(lignes).equilibre).toBe(true);
    const charge = lignes.find((l) => l.debit > 0)!;
    expect(charge.compte).toBe(COMPTES.IMMOBILISATIONS.numero);
    expect(charge.confiant).toBe(true);
  });

  it("route une dépense de nature libre non reconnue vers « à reclasser », non confiant", () => {
    const lignes = ecrituresMouvement({
      date: "2026-08-01",
      caisse: "zogbo",
      mouvement: mouvement({ nature: "Réparation frigo" }),
    });
    const charge = lignes.find((l) => l.debit > 0)!;
    expect(charge.compte).toBe(COMPTES.ENTRETIEN_REPARATIONS.numero);
    expect(charge.confiant).toBe(false);
  });

  it("ignore un mouvement annulé", () => {
    const lignes = ecrituresMouvement({
      date: "2026-08-01",
      caisse: "zogbo",
      mouvement: mouvement({ cancelledAt: "2026-08-02T00:00:00.000Z" }),
    });
    expect(lignes).toHaveLength(0);
  });

  it("équilibre une recette", () => {
    const lignes = ecrituresMouvement({
      date: "2026-08-01",
      caisse: "gbegamey",
      mouvement: mouvement({ kind: "recette", montant: 2000, nature: "Remboursement" }),
    });
    expect(totaux(lignes)).toEqual({ debit: 2000, credit: 2000, equilibre: true });
  });

  it("ne produit aucune écriture pour un versement (traité à part)", () => {
    const lignes = ecrituresMouvement({
      date: "2026-08-01",
      caisse: "zogbo",
      mouvement: mouvement({ kind: "versement-sortie", contrepartie: "centrale" }),
    });
    expect(lignes).toHaveLength(0);
  });
});

describe("ecrituresVersement", () => {
  it("équilibre un versement entre deux caisses sans toucher au résultat", () => {
    const lignes = ecrituresVersement({
      date: "2026-08-01",
      source: "zogbo",
      destination: "centrale",
      mouvement: mouvement({ kind: "versement-sortie", montant: 15000 }),
    });
    expect(totaux(lignes)).toEqual({ debit: 15000, credit: 15000, equilibre: true });
    expect(lignes.every((l) => l.compte.startsWith("57"))).toBe(true);
  });
});

describe("ecrituresChargeManuelle", () => {
  it("équilibre une charge manuelle avec le compte d'attente, marqué non confiant", () => {
    const lignes = ecrituresChargeManuelle({
      date: "2026-08-01",
      poste: "loyer",
      montant: 60000,
    });
    expect(totaux(lignes)).toEqual({ debit: 60000, credit: 60000, equilibre: true });
    const contrepartie = lignes.find((l) => l.credit > 0)!;
    expect(contrepartie.compte).toBe(COMPTES.COMPTE_ATTENTE.numero);
    expect(contrepartie.confiant).toBe(false);
  });
});

describe("totaux", () => {
  it("détecte un déséquilibre", () => {
    const result = totaux([
      {
        date: "2026-08-01",
        piece: "x",
        libelle: "x",
        compte: "1",
        compteLibelle: "x",
        debit: 100,
        credit: 0,
        confiant: true,
      },
    ]);
    expect(result.equilibre).toBe(false);
  });
});

const ecrituresExemple: EcritureComptable[] = [
  ...ecrituresVente({
    date: "2026-08-01",
    numero: "T-1",
    caisse: "zogbo",
    reduction: 0,
    lignes: [{ kind: "plat", montant: 10000 }],
  }),
  ...ecrituresVente({
    date: "2026-08-02",
    numero: "T-2",
    caisse: "zogbo",
    reduction: 0,
    lignes: [{ kind: "boisson", montant: 2000 }],
  }),
  ...ecrituresMouvement({
    date: "2026-08-02",
    caisse: "zogbo",
    mouvement: mouvement({ nature: "Achat stock · Farine +5", montant: 3000 }),
  }),
];

describe("grandLivre", () => {
  it("cumule le solde du compte caisse au fil des mouvements, dans l'ordre chronologique", () => {
    const comptes = grandLivre(ecrituresExemple);
    const caisse = comptes.find((c) => c.compte === COMPTES.CAISSE_ZOGBO.numero)!;
    // +10000 (vente), +2000 (vente), -3000 (achat) → solde 9000.
    expect(caisse.mouvements.map((m) => m.solde)).toEqual([10000, 12000, 9000]);
    expect(caisse.soldeFinal).toBe(9000);
    expect(caisse.totalDebit).toBe(12000);
    expect(caisse.totalCredit).toBe(3000);
  });

  it("trie les comptes par numéro", () => {
    const comptes = grandLivre(ecrituresExemple);
    const numeros = comptes.map((c) => c.compte);
    expect(numeros).toEqual([...numeros].sort());
  });
});

describe("balanceGenerale et resultatNetDeBalance", () => {
  it("équilibre la balance dans son ensemble", () => {
    const balance = balanceGenerale(ecrituresExemple);
    const totalDebit = balance.reduce((s, l) => s + l.debit, 0);
    const totalCredit = balance.reduce((s, l) => s + l.credit, 0);
    expect(totalDebit).toBe(totalCredit);
  });

  it("calcule le résultat net (produits − charges) depuis la balance", () => {
    const balance = balanceGenerale(ecrituresExemple);
    // Ventes 12000 (classe 7, crédit) − achat 3000 (classe 6, débit) = 9000.
    expect(resultatNetDeBalance(balance)).toBe(9000);
  });
});
