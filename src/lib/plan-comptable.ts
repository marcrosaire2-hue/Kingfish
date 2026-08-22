/**
 * Plan comptable SYSCOHADA — mapping par défaut entre les catégories
 * existantes de l'application et des comptes numérotés.
 *
 * Ce mapping est une PROPOSITION, pas une vérité comptable établie : il doit
 * être validé par un expert-comptable avant tout usage fiscal ou légal.
 * Notamment, la ventilation 706/707 des ventes et le classement des charges
 * diverses (nature en texte libre) reposent sur des conventions raisonnables
 * mais non certifiées.
 */

export type CompteComptable = {
  numero: string;
  libelle: string;
};

export const COMPTES = {
  // Classe 2 — Actif immobilisé
  IMMOBILISATIONS: { numero: "2181", libelle: "Matériel et mobilier" },

  // Classe 4 — Tiers
  COMPTE_ATTENTE: {
    numero: "4711",
    libelle: "Compte d'attente (contrepartie non tracée par l'application)",
  },

  // Classe 5 — Trésorerie
  CAISSE_ZOGBO: { numero: "5711", libelle: "Caisse Zogbo" },
  CAISSE_GBEGAMEY: { numero: "5712", libelle: "Caisse Gbégamey" },
  CAISSE_CENTRALE: { numero: "5713", libelle: "Caisse centrale" },

  // Classe 6 — Charges des activités ordinaires
  ACHATS_MATIERES: { numero: "601", libelle: "Achats de matières premières" },
  CARBURANT: { numero: "6051", libelle: "Fournitures — carburant" },
  ELECTRICITE: { numero: "6052", libelle: "Fournitures — électricité" },
  LOYER: { numero: "622", libelle: "Locations" },
  ENTRETIEN_REPARATIONS: {
    numero: "624",
    libelle: "Entretien, réparations et maintenance",
  },
  SALAIRES: {
    numero: "661",
    libelle: "Rémunérations directes versées au personnel",
  },
  CHARGES_DIVERSES_A_RECLASSER: {
    numero: "6588",
    libelle: "Charges diverses — à reclasser",
  },

  // Classe 7 — Produits des activités ordinaires, sous-comptes de 707 par
  // catégorie de produit (plutôt qu'un compte 707 unique) : lisibilité du CA
  // par nature directement dans le grand livre, sans repasser par un export
  // opérationnel séparé.
  VENTES_PLATS: { numero: "7071", libelle: "Ventes — Plats" },
  VENTES_BOISSONS: { numero: "7072", libelle: "Ventes — Boissons" },
  VENTES_ACCOMPAGNEMENTS: {
    numero: "7073",
    libelle: "Ventes — Accompagnements",
  },
  VENTES_AUTRES: {
    numero: "7074",
    libelle: "Ventes — Autres (hors catalogue, non catégorisé)",
  },
  RABAIS_REMISES: {
    numero: "709",
    libelle: "Rabais, remises et ristournes accordés",
  },
  PRODUITS_DIVERS_A_RECLASSER: {
    numero: "7588",
    libelle: "Produits divers — à reclasser",
  },
} as const satisfies Record<string, CompteComptable>;

/**
 * Sous-compte de vente selon la nature du produit — `kind` absent (imports
 * AquaPro non catégorisés) ou non reconnu ("combo", catalogue retiré) va en
 * « Autres » plutôt que d'être deviné.
 */
export function compteVente(kind: string | undefined): CompteComptable {
  if (kind === "plat") return COMPTES.VENTES_PLATS;
  if (kind === "boisson") return COMPTES.VENTES_BOISSONS;
  if (kind === "local") return COMPTES.VENTES_ACCOMPAGNEMENTS;
  return COMPTES.VENTES_AUTRES;
}

export type CaisseKeySimple = "zogbo" | "gbegamey" | "centrale";

export function compteCaisse(caisse: CaisseKeySimple): CompteComptable {
  if (caisse === "zogbo") return COMPTES.CAISSE_ZOGBO;
  if (caisse === "gbegamey") return COMPTES.CAISSE_GBEGAMEY;
  return COMPTES.CAISSE_CENTRALE;
}

/**
 * Classe une dépense de caisse à partir du préfixe posé automatiquement par
 * l'application ("Immobilisation · ...", "Achat stock · ..."), puis par mots
 * clés sur le texte libre saisi par l'utilisateur pour les autres cas.
 * Renvoie `null` si aucune correspondance fiable n'est trouvée : mieux vaut
 * marquer « à reclasser » que deviner.
 */
export function compteDepense(nature: string): {
  compte: CompteComptable;
  confiant: boolean;
} {
  const n = nature.toLowerCase();
  if (n.startsWith("immobilisation ·") || n.startsWith("immobilisation :")) {
    return { compte: COMPTES.IMMOBILISATIONS, confiant: true };
  }
  if (n.startsWith("achat stock ·") || n.startsWith("achat stock :")) {
    return { compte: COMPTES.ACHATS_MATIERES, confiant: true };
  }
  if (/\bloyer\b/.test(n)) return { compte: COMPTES.LOYER, confiant: false };
  if (/\bsalaire|\bprime\b/.test(n))
    return { compte: COMPTES.SALAIRES, confiant: false };
  if (/électric|electricit/.test(n))
    return { compte: COMPTES.ELECTRICITE, confiant: false };
  if (/carburant|essence|gasoil/.test(n))
    return { compte: COMPTES.CARBURANT, confiant: false };
  if (/répar|entretien|reparation/.test(n))
    return { compte: COMPTES.ENTRETIEN_REPARATIONS, confiant: false };
  return { compte: COMPTES.CHARGES_DIVERSES_A_RECLASSER, confiant: false };
}

/** Poste de charge manuelle (Synthèse) → compte correspondant. */
export const COMPTE_CHARGE_MANUELLE = {
  matieresPremieres: COMPTES.ACHATS_MATIERES,
  loyer: COMPTES.LOYER,
  salaires: COMPTES.SALAIRES,
  electricite: COMPTES.ELECTRICITE,
  carburant: COMPTES.CARBURANT,
  reparations: COMPTES.ENTRETIEN_REPARATIONS,
} as const;
