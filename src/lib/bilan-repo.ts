import { physicalBoissonsStock, unitsPerCasierOf } from "@/lib/boissons-calc";
import { getBoissonsDayPayload } from "@/lib/boissons-repo";
import { getCaissesOverview } from "@/lib/caisse-repo";
import { listImmobilisations } from "@/lib/immobilisations-repo";
import {
  balanceGenerale,
  resultatNetDeBalance,
  type LigneBalance,
} from "@/lib/journal-comptable-calc";
import { buildJournalComptable } from "@/lib/journal-comptable-repo";
import { stockOf } from "@/lib/matieres-calc";
import { getMatieresDayPayload } from "@/lib/matieres-repo";
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
 * Valeur du stock physique restant (matières premières + boissons), au prix
 * d'achat catalogue. Les plats et accompagnements préparés en sont exclus :
 * denrées périssables à faible valeur résiduelle, déjà couvertes côté risque
 * par le suivi des Pertes — les capitaliser ajouterait une hypothèse fragile
 * pour un montant qui reste marginal.
 *
 * Les emballages sont ajoutés à part par l'appelant (`buildBilan`) : ce sont
 * des fiches Immobilisations, pas des lignes matières/boissons.
 */
async function valeurStockMatieresBoissons(asOf: string): Promise<number> {
  const [matieres, boissons] = await Promise.all([
    getMatieresDayPayload(asOf),
    getBoissonsDayPayload(asOf),
  ]);

  const materialById = new Map(matieres.materials.map((m) => [m.id, m]));
  const valeurMatieres = matieres.day.lines.reduce((s, line) => {
    const materiau = materialById.get(line.productId);
    if (!materiau) return s;
    return s + stockOf(line) * materiau.purchasePrice;
  }, 0);

  const drinkById = new Map(boissons.drinks.map((d) => [d.id, d]));
  const valeurBoissons = boissons.day.lines.reduce((s, line) => {
    const boisson = drinkById.get(line.productId);
    if (!boisson) return s;
    const stockBouteilles = physicalBoissonsStock(
      line,
      unitsPerCasierOf(boisson),
    );
    return s + stockBouteilles * boisson.purchasePrice;
  }, 0);

  return valeurMatieres + valeurBoissons;
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
  const resultatAvantStock = resultatNetDeBalance(balance);

  // Les emballages sont un stock consommable (quantité qui baisse à la vente
  // ou à la perte), pas un actif durable amortissable comme les « actifs »
  // (matériel, mobilier) — ils rejoignent donc la valorisation du stock au
  // lieu de la ligne Immobilisations. Toujours en valeur brute : un
  // emballage ne s'amortit pas, il se consomme.
  const actifsImmobilises = immobilisations.filter((i) => i.kind === "actif");
  const emballages = immobilisations.filter((i) => i.kind === "emballage");
  const valeurEmballages = emballages.reduce((s, i) => s + i.qty * i.cost, 0);

  // Variation de stock : les achats de matières (et d'emballages) sont déjà
  // passés en charge à 100% dès l'achat. Sans correction, capitaliser le
  // stock restant à l'actif surestimerait le patrimoine sans alléger la
  // charge en face. `ORIGINE` étant antérieure à toute donnée réelle de
  // l'application, le stock à cette date est nécessairement nul — la
  // variation cumulée depuis l'origine est donc exactement la valeur du
  // stock actuel, ajoutée au résultat (elle réduit d'autant la charge
  // réellement consommée sur la période).
  const stockValorise = parametres.modules.stock
    ? (await valeurStockMatieresBoissons(input.asOf)) + valeurEmballages
    : 0;
  const resultat = resultatAvantStock + Math.round(stockValorise);

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
    const sansDuree = actifsImmobilises.filter((i) => !i.dureeUtiliteAnnees);
    const valeurNetteTotale = actifsImmobilises.reduce(
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
          : "Emballages exclus de cette ligne : comptés en Stocks (consommables, non amortissables).",
    });
  } else {
    const immobilisationsBrutes = actifsImmobilises.reduce(
      (s, i) => s + i.qty * i.cost,
      0,
    );
    actif.push({
      libelle: "Immobilisations (valeur brute — amortissements non activés)",
      montant: Math.round(immobilisationsBrutes),
      fiable: false,
      note: "Module Amortissements désactivé : à activer par le compte direction (marc) pour une valeur nette. Emballages exclus de cette ligne : comptés en Stocks.",
    });
  }

  actif.push(
    parametres.modules.stock
      ? {
          libelle: "Stocks (matières premières, boissons, emballages)",
          montant: Math.round(stockValorise),
          fiable: true,
          note: `Plats et accompagnements préparés exclus (denrées périssables, valeur résiduelle marginale, déjà couverte par le suivi des Pertes). Inclut les emballages (${Math.round(valeurEmballages)} FCFA) : consommables liés au stock, pas des immobilisations amortissables. Résultat ajusté de la variation de stock en contrepartie (compte 603).`,
        }
      : {
          libelle: "Stocks (matières, boissons, emballages)",
          montant: 0,
          fiable: false,
          note: "Module Stock désactivé : à activer par le compte direction (marc). Les achats (dont les emballages) restent alors passés en charge intégralement à l'acquisition, sans capitalisation du stock restant.",
        },
  );

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
      note:
        parametres.modules.stock && stockValorise > 0
          ? `Inclut +${Math.round(stockValorise)} FCFA de variation de stock (module Stock activé).`
          : undefined,
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
