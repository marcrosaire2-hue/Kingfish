import { getCaissesOverview } from "@/lib/caisse-repo";
import { listImmobilisations } from "@/lib/immobilisations-repo";
import {
  balanceGenerale,
  resultatNetDeBalance,
  type LigneBalance,
} from "@/lib/journal-comptable-calc";
import { buildJournalComptable } from "@/lib/journal-comptable-repo";
import { getParametresComptables } from "@/lib/parametres-comptables-repo";
import { COMPTES } from "@/lib/plan-comptable";
import type { Immobilisation, VenteSite } from "@/lib/types";

/**
 * Origine retenue pour cumuler le résultat depuis le début — même convention
 * que les exports « historique complet » déjà utilisés ailleurs (Achats,
 * Pertes) : une borne large plutôt qu'une vraie date de création de
 * l'entreprise, qui n'est pas connue de l'application.
 */
const ORIGINE = "2020-01-01";

export type LigneBilan = {
  libelle: string;
  montant: number;
  /** false = poste que l'application ne peut pas établir de façon fiable. */
  fiable: boolean;
  note?: string;
};

export type Bilan = {
  asOf: string;
  actif: LigneBilan[];
  passif: LigneBilan[];
  totalActif: number;
  totalPassif: number;
  ecart: number;
  equilibre: boolean;
  balance: LigneBalance[];
};

function joursEntre(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  return Math.max(0, (b - a) / (1000 * 60 * 60 * 24));
}

/**
 * Valeur nette comptable d'une fiche, méthode linéaire. Une fiche sans durée
 * d'utilité renseignée reste à sa valeur brute — l'app ne devine pas une
 * durée qui n'a pas été saisie.
 */
function valeurNette(item: Immobilisation, asOf: string): number {
  const brut = item.qty * item.cost;
  if (!item.dureeUtiliteAnnees || item.dureeUtiliteAnnees <= 0) return brut;
  const anneesEcoulees = joursEntre(item.date, asOf) / 365;
  const dotationAnnuelle = brut / item.dureeUtiliteAnnees;
  const amortissementCumule = Math.min(
    brut,
    dotationAnnuelle * Math.max(0, anneesEcoulees),
  );
  return Math.max(0, brut - amortissementCumule);
}

/**
 * Bilan simplifié établi à partir des données que l'application tient
 * réellement : trésorerie des caisses, immobilisations (valeur nette si le
 * module Amortissements est activé, brute sinon), résultat cumulé depuis
 * `ORIGINE` et solde du compte d'attente. Capital, stocks valorisés et
 * comptes tiers restent à 0 tant que le compte direction (marc) n'a pas
 * activé le module correspondant et renseigné le montant — jamais devinés.
 */
export async function buildBilan(input: {
  asOf: string;
  scopeSite?: VenteSite | null;
}): Promise<Bilan> {
  const [journal, caisses, immobilisations, parametres] = await Promise.all([
    buildJournalComptable({
      from: ORIGINE,
      to: input.asOf,
      scopeSite: input.scopeSite,
    }),
    getCaissesOverview(),
    listImmobilisations({ active: true }),
    getParametresComptables(),
  ]);

  const balance = balanceGenerale(journal.ecritures);
  const resultat = resultatNetDeBalance(balance);

  const tresorerie = caisses.reduce((s, c) => s + c.soldeTheorique, 0);
  const compteAttente = balance.find(
    (l) => l.compte === COMPTES.COMPTE_ATTENTE.numero,
  );
  const soldeCompteAttente = compteAttente
    ? compteAttente.soldeCrediteur - compteAttente.soldeDebiteur
    : 0;

  const actif: LigneBilan[] = [
    {
      libelle: "Trésorerie (caisses)",
      montant: Math.round(tresorerie),
      fiable: true,
    },
  ];

  if (parametres.modules.amortissements) {
    const sansDuree = immobilisations.filter((i) => !i.dureeUtiliteAnnees);
    const valeurNetteTotale = immobilisations.reduce(
      (s, i) => s + valeurNette(i, input.asOf),
      0,
    );
    actif.push({
      libelle: "Immobilisations (valeur nette, amortissement linéaire)",
      montant: Math.round(valeurNetteTotale),
      fiable: sansDuree.length === 0,
      note:
        sansDuree.length > 0
          ? `${sansDuree.length} fiche(s) sans durée d'utilité renseignée, comptée(s) en valeur brute : ${sansDuree.map((i) => i.name).join(", ")}.`
          : undefined,
    });
  } else {
    const immobilisationsBrutes = immobilisations.reduce(
      (s, i) => s + i.qty * i.cost,
      0,
    );
    actif.push({
      libelle: "Immobilisations (valeur brute — amortissements non activés)",
      montant: Math.round(immobilisationsBrutes),
      fiable: false,
      note: "Module Amortissements désactivé : à activer par le compte direction (marc) pour une valeur nette.",
    });
  }

  actif.push({
    libelle: "Stocks (matières, emballages)",
    montant: 0,
    fiable: false,
    note: "Aucun stock valorisé au bilan : les achats sont passés en charge intégralement à l'acquisition, pas capitalisés.",
  });

  actif.push({
    libelle: "Créances clients",
    montant: parametres.modules.comptesTiers ? parametres.creancesClients : 0,
    fiable: parametres.modules.comptesTiers,
    note: parametres.modules.comptesTiers
      ? "Montant saisi manuellement — l'application ne suit pas les ventes à crédit une par une."
      : "Module Comptes tiers désactivé : à activer par le compte direction (marc).",
  });

  const passif: LigneBilan[] = [
    {
      libelle: "Capital",
      montant: parametres.modules.capital ? parametres.capital : 0,
      fiable: parametres.modules.capital,
      note: parametres.modules.capital
        ? undefined
        : "Module Capital désactivé : à activer et renseigner par le compte direction (marc) pour équilibrer ce bilan.",
    },
    {
      libelle: `Résultat cumulé depuis ${ORIGINE}`,
      montant: resultat,
      fiable: true,
    },
    {
      libelle: "Dettes fournisseurs",
      montant: parametres.modules.comptesTiers
        ? parametres.dettesFournisseurs
        : 0,
      fiable: parametres.modules.comptesTiers,
      note: parametres.modules.comptesTiers
        ? "Montant saisi manuellement — l'application ne suit pas les achats à crédit un par un."
        : "Module Comptes tiers désactivé : à activer par le compte direction (marc).",
    },
    {
      libelle: "Compte d'attente (charges sans règlement tracé)",
      montant: Math.round(soldeCompteAttente),
      fiable: false,
      note: "Regroupe les charges manuelles (loyer, salaires…) dont l'application ne sait pas par quelle caisse elles ont été réglées.",
    },
  ];

  const totalActif = Math.round(actif.reduce((s, l) => s + l.montant, 0));
  const totalPassif = Math.round(passif.reduce((s, l) => s + l.montant, 0));

  return {
    asOf: input.asOf,
    actif,
    passif,
    totalActif,
    totalPassif,
    ecart: Math.round(totalActif - totalPassif),
    equilibre: totalActif === totalPassif,
    balance,
  };
}
