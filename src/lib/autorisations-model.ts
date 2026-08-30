import type { NavKey, UserRole } from "@/lib/auth-types";

/** Actions granulaires exposées dans la matrice. */
export type PermissionAction =
  | "access"
  | "view"
  | "create"
  | "update"
  | "delete"
  | "admin";

export type PermissionValue = "allow" | "deny" | "inherit";

export type PermissionCategoryId =
  | "accueil"
  | "quotidien"
  | "pilotage"
  | "administration"
  | "autre";

export const PERMISSION_CATEGORY_LABELS: Record<PermissionCategoryId, string> = {
  accueil: "Accueil & finance",
  quotidien: "Quotidien",
  pilotage: "Pilotage",
  administration: "Administration",
  autre: "Autres",
};

export const PERMISSION_ACTION_LABELS: Record<PermissionAction, string> = {
  access: "Accès",
  view: "Voir",
  create: "Créer",
  update: "Modifier",
  delete: "Supprimer",
  admin: "Administrer",
};

export type PermissionResource = {
  id: string;
  /** Lié au menu / middleware quand c'est une page. */
  navKey?: NavKey;
  label: string;
  path: string;
  category: PermissionCategoryId;
  description: string;
  actions: PermissionAction[];
  /** Refuser cet accès exige une confirmation. */
  sensitive?: boolean;
};

/** Catalogue des pages / fonctionnalités contrôlables. */
export const PERMISSION_RESOURCES: PermissionResource[] = [
  {
    id: "synthese",
    navKey: "synthese",
    label: "Tableau de bord",
    path: "/",
    category: "accueil",
    description: "Synthèse CA et indicateurs du jour.",
    actions: ["access", "view"],
  },
  {
    id: "analyse",
    navKey: "analyse",
    label: "Analyse",
    path: "/analyse",
    category: "accueil",
    description: "Diagnostic commercial et marges.",
    actions: ["access", "view"],
  },
  {
    id: "rapport-quotidien",
    navKey: "rapport-quotidien",
    label: "Rapport du jour",
    path: "/rapport-quotidien",
    category: "accueil",
    description: "Synthèse quotidienne CA, pertes, écarts et alertes.",
    actions: ["access", "view"],
  },
  {
    id: "controle",
    navKey: "controle",
    label: "Contrôle écarts",
    path: "/controle",
    category: "accueil",
    description: "Écarts de transport Zogbo → Gbégamey.",
    actions: ["access", "view"],
  },
  {
    id: "compte-resultat",
    navKey: "compte-resultat",
    label: "Compte de résultat",
    path: "/compte-resultat",
    category: "accueil",
    description: "Produits, charges et résultat.",
    actions: ["access", "view", "update"],
  },
  {
    id: "comptabilite",
    navKey: "comptabilite",
    label: "Comptabilité",
    path: "/comptabilite",
    category: "accueil",
    description: "Journal, grand livre, bilan.",
    actions: ["access", "view"],
  },
  {
    id: "vente",
    navKey: "vente",
    label: "Vente (POS)",
    path: "/vente",
    category: "quotidien",
    description: "Encaissement et panier multi-articles.",
    actions: ["access", "create", "update", "delete"],
  },
  {
    id: "caisse",
    navKey: "caisse",
    label: "Caisse",
    path: "/caisse",
    category: "quotidien",
    description: "Ouverture, mouvements et clôture.",
    actions: ["access", "view", "create", "update", "admin"],
  },
  {
    id: "zogbo",
    navKey: "zogbo",
    label: "Stock Zogbo",
    path: "/zogbo",
    category: "quotidien",
    description: "Inventaire et préparations Zogbo.",
    actions: ["access", "view", "update"],
  },
  {
    id: "gbegamey",
    navKey: "gbegamey",
    label: "Stock Gbégamey",
    path: "/stock-gbegamey",
    category: "quotidien",
    description: "Inventaire et réceptions Gbégamey.",
    actions: ["access", "view", "update"],
  },
  {
    id: "appro",
    navKey: "appro",
    label: "Approvisionnement / Achats",
    path: "/appro",
    category: "quotidien",
    description: "Achats matières et libellés libres.",
    actions: ["access", "view", "create", "update"],
  },
  {
    id: "pertes",
    navKey: "pertes",
    label: "Pertes",
    path: "/pertes",
    category: "quotidien",
    description: "Déclaration des pertes de stock.",
    actions: ["access", "view", "create"],
  },
  {
    id: "stock",
    navKey: "stock",
    label: "Stock final",
    path: "/stock",
    category: "quotidien",
    description: "Vue consolidée des stocks.",
    actions: ["access", "view"],
  },
  {
    id: "immobilisations",
    navKey: "immobilisations",
    label: "Immobilisations",
    path: "/immobilisations",
    category: "quotidien",
    description: "Emballages et actifs.",
    actions: ["access", "view", "create", "update"],
  },
  {
    id: "journal-ventes",
    navKey: "journal-ventes",
    label: "Journal des ventes",
    path: "/journal-ventes",
    category: "pilotage",
    description: "Tickets et lignes de vente.",
    actions: ["access", "view", "delete"],
  },
  {
    id: "quantites-vendues",
    navKey: "quantites-vendues",
    label: "Quantités vendues",
    path: "/quantites-vendues",
    category: "pilotage",
    description: "Volumes par article sur une période.",
    actions: ["access", "view"],
  },
  {
    id: "regularisation",
    navKey: "regularisation",
    label: "Régularisation",
    path: "/regularisation",
    category: "pilotage",
    description: "Saisie / correction de jours passés.",
    actions: ["access", "create", "update", "delete"],
    sensitive: true,
  },
  {
    id: "historique",
    navKey: "historique",
    label: "Registre d’activité",
    path: "/historique",
    category: "pilotage",
    description: "Historique des opérations.",
    actions: ["access", "view"],
  },
  {
    id: "parametres",
    navKey: "parametres",
    label: "Paramètres catalogue",
    path: "/parametres",
    category: "pilotage",
    description: "Plats, boissons, matières.",
    actions: ["access", "view", "update", "admin"],
    sensitive: true,
  },
  {
    id: "reglages",
    navKey: "reglages",
    label: "Réglages POS",
    path: "/reglages",
    category: "pilotage",
    description: "Paiements, tables, serveurs.",
    actions: ["access", "view", "update"],
    sensitive: true,
  },
  {
    id: "admin",
    navKey: "admin",
    label: "Équipe (utilisateurs)",
    path: "/admin",
    category: "administration",
    description: "Création et gestion des comptes.",
    actions: ["access", "view", "create", "update", "delete", "admin"],
    sensitive: true,
  },
  {
    id: "autorisations",
    label: "Matrice des autorisations",
    path: "/admin",
    category: "administration",
    description: "Permissions fines sur les pages et fonctionnalités (section Équipe).",
    actions: ["access", "view", "update", "admin"],
    sensitive: true,
  },
];

export type PermissionOverride = {
  targetType: "role" | "user";
  /** Rôle (`gerant`…) ou id utilisateur. */
  targetId: string;
  resourceId: string;
  actions: Partial<Record<PermissionAction, PermissionValue>>;
};

export type AutorisationsConfig = {
  version: number;
  overrides: PermissionOverride[];
  updatedAt: string | null;
  updatedBy: {
    id: string;
    name: string;
    username: string;
  } | null;
};

export const EMPTY_AUTORISATIONS: AutorisationsConfig = {
  version: 1,
  overrides: [],
  updatedAt: null,
  updatedBy: null,
};

export type AutorisationsHistoryEntry = {
  id: string;
  at: string;
  actorId: string | null;
  actorName: string | null;
  actorUsername: string | null;
  summary: string;
  detail: string;
};

export const ROLES_FOR_PERMISSIONS: UserRole[] = [
  "gerant",
  "comptable",
  "daf",
  "admin",
];

export function resourceById(id: string): PermissionResource | undefined {
  return PERMISSION_RESOURCES.find((r) => r.id === id);
}

export function isPermissionAction(v: unknown): v is PermissionAction {
  return (
    v === "access" ||
    v === "view" ||
    v === "create" ||
    v === "update" ||
    v === "delete" ||
    v === "admin"
  );
}

export function isPermissionValue(v: unknown): v is PermissionValue {
  return v === "allow" || v === "deny" || v === "inherit";
}
