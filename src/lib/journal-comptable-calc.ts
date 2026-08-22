import {
  COMPTES,
  COMPTE_CHARGE_MANUELLE,
  compteCaisse,
  compteDepense,
  compteVente,
  type CaisseKeySimple,
} from "@/lib/plan-comptable";
import type { CaisseMouvement } from "@/lib/types";

export type EcritureComptable = {
  date: string;
  piece: string;
  libelle: string;
  compte: string;
  compteLibelle: string;
  debit: number;
  credit: number;
  /** false = classement automatique incertain, à vérifier avant validation. */
  confiant: boolean;
};

function round(n: number): number {
  return Math.round(n);
}

/**
 * Vente validée : la caisse encaisse le net, une remise éventuelle est
 * constatée séparément (compte 709) pour que le crédit du compte de vente
 * reste le montant brut facturé — traitement SYSCOHADA standard des rabais
 * accordés après coup, plutôt qu'une simple compensation silencieuse.
 *
 * Le crédit est ventilé par nature de produit (plat/boisson/accompagnement/
 * autre), une même vente pouvant mélanger plusieurs catégories — la réduction,
 * elle, reste une ligne unique au niveau du ticket : rien dans les données ne
 * dit sur quelle catégorie elle a porté, la répartir serait une hypothèse.
 */
export function ecrituresVente(input: {
  date: string;
  numero: string;
  caisse: CaisseKeySimple;
  reduction: number;
  lignes: { kind?: string; montant: number }[];
}): EcritureComptable[] {
  const parCategorie = new Map<string, number>();
  for (const l of input.lignes) {
    const montant = round(l.montant);
    if (montant <= 0) continue;
    const compte = compteVente(l.kind);
    parCategorie.set(compte.numero, (parCategorie.get(compte.numero) ?? 0) + montant);
  }
  const brut = round(
    [...parCategorie.values()].reduce((s, v) => s + v, 0),
  );
  if (brut <= 0) return [];

  const reduction = round(Math.max(0, input.reduction));
  const montant = brut - reduction;
  const caisseCompte = compteCaisse(input.caisse);

  const ecritures: EcritureComptable[] = [
    {
      date: input.date,
      piece: input.numero,
      libelle: `Vente ${input.numero}`,
      compte: caisseCompte.numero,
      compteLibelle: caisseCompte.libelle,
      debit: montant,
      credit: 0,
      confiant: true,
    },
  ];
  if (reduction > 0) {
    ecritures.push({
      date: input.date,
      piece: input.numero,
      libelle: `Réduction commerciale ${input.numero}`,
      compte: COMPTES.RABAIS_REMISES.numero,
      compteLibelle: COMPTES.RABAIS_REMISES.libelle,
      debit: reduction,
      credit: 0,
      confiant: true,
    });
  }
  for (const [numero, montantCategorie] of parCategorie) {
    const compte = [
      COMPTES.VENTES_PLATS,
      COMPTES.VENTES_BOISSONS,
      COMPTES.VENTES_ACCOMPAGNEMENTS,
      COMPTES.VENTES_AUTRES,
    ].find((c) => c.numero === numero)!;
    ecritures.push({
      date: input.date,
      piece: input.numero,
      libelle: `Vente ${input.numero}`,
      compte: compte.numero,
      compteLibelle: compte.libelle,
      debit: 0,
      credit: montantCategorie,
      confiant: true,
    });
  }
  return ecritures;
}

/** Dépense ou recette de caisse — hors versements, traités séparément. */
export function ecrituresMouvement(input: {
  date: string;
  caisse: CaisseKeySimple;
  mouvement: CaisseMouvement;
}): EcritureComptable[] {
  const { mouvement } = input;
  if (mouvement.cancelledAt) return [];
  const montant = round(mouvement.montant);
  if (montant <= 0) return [];
  const caisseCompte = compteCaisse(input.caisse);
  const piece = mouvement.id;

  if (mouvement.kind === "depense") {
    const { compte, confiant } = compteDepense(mouvement.nature);
    return [
      {
        date: input.date,
        piece,
        libelle: mouvement.nature,
        compte: compte.numero,
        compteLibelle: compte.libelle,
        debit: montant,
        credit: 0,
        confiant,
      },
      {
        date: input.date,
        piece,
        libelle: mouvement.nature,
        compte: caisseCompte.numero,
        compteLibelle: caisseCompte.libelle,
        debit: 0,
        credit: montant,
        confiant: true,
      },
    ];
  }

  if (mouvement.kind === "recette") {
    return [
      {
        date: input.date,
        piece,
        libelle: mouvement.nature,
        compte: caisseCompte.numero,
        compteLibelle: caisseCompte.libelle,
        debit: montant,
        credit: 0,
        confiant: true,
      },
      {
        date: input.date,
        piece,
        libelle: mouvement.nature,
        compte: COMPTES.PRODUITS_DIVERS_A_RECLASSER.numero,
        compteLibelle: COMPTES.PRODUITS_DIVERS_A_RECLASSER.libelle,
        debit: 0,
        credit: montant,
        confiant: false,
      },
    ];
  }

  // "versement-sortie" / "versement-entree" : traités par ecrituresVersement,
  // à partir de la seule jambe sortie — ignorés ici pour ne pas les compter
  // deux fois.
  return [];
}

/**
 * Versement entre caisses : un pur mouvement de trésorerie, construit à
 * partir de la jambe « sortie » uniquement (elle porte la caisse de
 * destination dans `contrepartie`) — la jambe « entree » est son miroir et
 * ne doit pas générer une deuxième écriture.
 */
export function ecrituresVersement(input: {
  date: string;
  source: CaisseKeySimple;
  destination: CaisseKeySimple;
  mouvement: CaisseMouvement;
}): EcritureComptable[] {
  const { mouvement } = input;
  if (mouvement.cancelledAt) return [];
  const montant = round(mouvement.montant);
  if (montant <= 0) return [];
  const compteSource = compteCaisse(input.source);
  const compteDestination = compteCaisse(input.destination);
  const piece = mouvement.transfertId ?? mouvement.id;
  return [
    {
      date: input.date,
      piece,
      libelle: `Versement ${input.source} → ${input.destination}`,
      compte: compteDestination.numero,
      compteLibelle: compteDestination.libelle,
      debit: montant,
      credit: 0,
      confiant: true,
    },
    {
      date: input.date,
      piece,
      libelle: `Versement ${input.source} → ${input.destination}`,
      compte: compteSource.numero,
      compteLibelle: compteSource.libelle,
      debit: 0,
      credit: montant,
      confiant: true,
    },
  ];
}

/**
 * Charge fixe saisie à la main (Synthèse) : loyer, salaires, électricité...
 * Aucun mouvement de caisse n'y est lié dans l'application — le mode de
 * règlement réel n'est pas tracé, donc la contrepartie va au compte
 * d'attente plutôt que d'inventer une caisse ou un compte fournisseur.
 */
export function ecrituresChargeManuelle(input: {
  date: string;
  poste: keyof typeof COMPTE_CHARGE_MANUELLE;
  montant: number;
}): EcritureComptable[] {
  const montant = round(input.montant);
  if (montant <= 0) return [];
  const compte = COMPTE_CHARGE_MANUELLE[input.poste];
  const piece = `charge-${input.date}-${input.poste}`;
  return [
    {
      date: input.date,
      piece,
      libelle: `Charge ${input.poste} (saisie manuelle)`,
      compte: compte.numero,
      compteLibelle: compte.libelle,
      debit: montant,
      credit: 0,
      confiant: true,
    },
    {
      date: input.date,
      piece,
      libelle: `Charge ${input.poste} (saisie manuelle) — contrepartie non tracée`,
      compte: COMPTES.COMPTE_ATTENTE.numero,
      compteLibelle: COMPTES.COMPTE_ATTENTE.libelle,
      debit: 0,
      credit: montant,
      confiant: false,
    },
  ];
}

export function totaux(ecritures: EcritureComptable[]): {
  debit: number;
  credit: number;
  equilibre: boolean;
} {
  let debit = 0;
  let credit = 0;
  for (const e of ecritures) {
    debit += e.debit;
    credit += e.credit;
  }
  debit = round(debit);
  credit = round(credit);
  return { debit, credit, equilibre: debit === credit };
}

export type MouvementGrandLivre = {
  date: string;
  piece: string;
  libelle: string;
  debit: number;
  credit: number;
  /** Cumulé dans l'ordre chronologique, à l'intérieur de ce seul compte. */
  solde: number;
};

export type CompteGrandLivre = {
  compte: string;
  compteLibelle: string;
  mouvements: MouvementGrandLivre[];
  totalDebit: number;
  totalCredit: number;
  soldeFinal: number;
};

/**
 * Grand livre : mêmes écritures que le journal, regroupées par compte plutôt
 * que par date, avec un solde qui s'accumule au fil des mouvements du compte.
 * Un compte de charge/actif est débiteur par nature (solde = débit − crédit),
 * mais l'affichage garde ce signe pour tous les comptes : un compte de
 * produit apparaît alors avec un solde négatif, ce qui est la convention
 * usuelle (le lecteur applique le signe attendu selon la classe du compte).
 */
export function grandLivre(ecritures: EcritureComptable[]): CompteGrandLivre[] {
  const parCompte = new Map<
    string,
    { compteLibelle: string; mouvements: EcritureComptable[] }
  >();
  for (const e of ecritures) {
    const entry = parCompte.get(e.compte);
    if (entry) entry.mouvements.push(e);
    else parCompte.set(e.compte, { compteLibelle: e.compteLibelle, mouvements: [e] });
  }

  const comptes: CompteGrandLivre[] = [];
  for (const [compte, { compteLibelle, mouvements }] of parCompte) {
    const tries = [...mouvements].sort((a, b) =>
      a.date === b.date ? 0 : a.date < b.date ? -1 : 1,
    );
    let solde = 0;
    let totalDebit = 0;
    let totalCredit = 0;
    const lignes: MouvementGrandLivre[] = tries.map((m) => {
      solde = round(solde + m.debit - m.credit);
      totalDebit = round(totalDebit + m.debit);
      totalCredit = round(totalCredit + m.credit);
      return {
        date: m.date,
        piece: m.piece,
        libelle: m.libelle,
        debit: m.debit,
        credit: m.credit,
        solde,
      };
    });
    comptes.push({
      compte,
      compteLibelle,
      mouvements: lignes,
      totalDebit,
      totalCredit,
      soldeFinal: solde,
    });
  }
  return comptes.sort((a, b) => (a.compte < b.compte ? -1 : 1));
}

export type LigneBalance = {
  compte: string;
  compteLibelle: string;
  debit: number;
  credit: number;
  soldeDebiteur: number;
  soldeCrediteur: number;
};

/** Balance générale : un total par compte, à partir du même grand livre. */
export function balanceGenerale(ecritures: EcritureComptable[]): LigneBalance[] {
  return grandLivre(ecritures).map((c) => ({
    compte: c.compte,
    compteLibelle: c.compteLibelle,
    debit: c.totalDebit,
    credit: c.totalCredit,
    soldeDebiteur: c.soldeFinal > 0 ? c.soldeFinal : 0,
    soldeCrediteur: c.soldeFinal < 0 ? -c.soldeFinal : 0,
  }));
}

/**
 * Résultat net déduit de la balance elle-même (classes 6 et 7), plutôt que
 * recalculé séparément : le bilan doit toujours correspondre exactement à ce
 * que dit le grand livre, jamais à un second calcul qui pourrait diverger.
 */
export function resultatNetDeBalance(balance: LigneBalance[]): number {
  let resultat = 0;
  for (const l of balance) {
    if (l.compte.startsWith("7")) resultat += l.soldeCrediteur - l.soldeDebiteur;
    else if (l.compte.startsWith("6")) resultat -= l.soldeDebiteur - l.soldeCrediteur;
  }
  return round(resultat);
}
