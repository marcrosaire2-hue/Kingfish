export type UserRole =
  | "gerant"
  /**
   * Comptable : pilotage financier + saisie des stocks par zone (plats,
   * accompagnements, boissons, matières) et immobilisations. Pas de vente POS
   * ni de gestion des comptes.
   */
  | "comptable"
  /**
   * Directeur Administratif et Financier : mêmes écrans / droits opérationnels
   * qu’un administrateur global, sans gestion des comptes. Peut être créé,
   * modifié ou supprimé par un admin (ex. Marc).
   */
  | "daf"
  | "admin";
export type UserSite = "zogbo" | "gbegamey" | "tous";

/**
 * Équipe de service. Rattachée au compte : c'est ainsi qu'on sait quelle
 * équipe a encaissé, sans rien demander au moment de la vente.
 * Les comptes d'encadrement peuvent n'appartenir à aucune équipe.
 */
export type UserShift = "jour" | "nuit" | "aucune";

export const SHIFT_LABELS: Record<UserShift, string> = {
  jour: "Équipe de jour",
  nuit: "Équipe de nuit",
  aucune: "Hors équipe",
};

export const SHIFTS: UserShift[] = ["jour", "nuit", "aucune"];

export function isShift(value: unknown): value is UserShift {
  return SHIFTS.includes(value as UserShift);
}

/**
 * Équipes écrites par les imports de carnets, qui parlent du service en
 * clair. « matin » et « soir » désignent les mêmes équipes que « jour » et
 * « nuit » : sans cette table, ces ventes tombaient en « hors équipe » et le
 * résumé du jour affichait matin et soir à zéro.
 */
const ALIAS_SHIFT: Record<string, UserShift> = {
  matin: "jour",
  midi: "jour",
  soir: "nuit",
  nuit: "nuit",
};

/** Équipe retenue, en tolérant un compte antérieur à cette notion. */
export function effectiveShift(
  shift: UserShift | string | undefined | null,
): UserShift {
  if (isShift(shift)) return shift;
  const alias = typeof shift === "string" ? ALIAS_SHIFT[shift.trim().toLowerCase()] : undefined;
  return alias ?? "aucune";
}

export type AppUser = {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  site: UserSite;
  shift?: UserShift;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SessionUser = {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  site: UserSite;
  shift?: UserShift;
};

export const ROLE_LABELS: Record<UserRole, string> = {
  gerant: "Gérant",
  comptable: "Comptable",
  daf: "Directeur Administratif et Financier",
  admin: "Administrateur",
};

export const SITE_LABELS: Record<UserSite, string> = {
  zogbo: "Zogbo",
  gbegamey: "Gbégamey",
  tous: "Les deux sites",
};

/** Libellé clair : admin de zone vs admin global (aide toutes les zones). */
export function adminKindLabel(site: UserSite): string {
  if (site === "tous") return "Administrateur global";
  return `Administrateur ${SITE_LABELS[site]}`;
}

export function roleSiteLabel(role: UserRole, site: UserSite): string {
  if (role === "admin") return adminKindLabel(site);
  if (role === "daf" || role === "comptable") return ROLE_LABELS[role];
  return `${ROLE_LABELS[role]} · ${SITE_LABELS[site]}`;
}

/** Direction opérationnelle (admin ou DAF) — hors gestion des comptes. */
export function hasDirectionAccess(role: UserRole): boolean {
  return role === "admin" || role === "daf";
}

/** Accès aux écrans / API financiers (résultat, comptabilité, journal stock). */
export function hasFinanceAccess(role: UserRole): boolean {
  return hasDirectionAccess(role) || role === "comptable";
}

export function isGlobalAdmin(user: {
  role: UserRole;
  site: UserSite;
}): boolean {
  return user.role === "admin" && effectiveSite(user.role, user.site) === "tous";
}

export function isZoneAdmin(user: {
  role: UserRole;
  site: UserSite;
}): boolean {
  return user.role === "admin" && effectiveSite(user.role, user.site) !== "tous";
}

export function isPrincipalAdminAccount(username: string): boolean {
  return username.trim().toLowerCase() === "admin";
}

/**
 * Compte direction (Marc) : vue synthèse + journaux + registre + création
 * d'utilisateurs — sans les écrans opérationnels (vente, caisse, stocks zone…).
 */
export function isExecutiveAdminAccount(username: string): boolean {
  return username.trim().toLowerCase() === "marc";
}

/** Peut ouvrir /admin (Équipe) et appeler /api/admin/users. */
export function canManageUsers(user: {
  role: UserRole;
  username: string;
}): boolean {
  return user.role === "admin";
}

const EXECUTIVE_ADMIN_NAV: NavKey[] = [
  "synthese",
  "analyse",
  "compte-resultat",
  "comptabilite",
  "journal-ventes",
  "journal-stock",
  "historique",
  "admin",
];

/** Rôles qu’un admin peut attribuer. */
export function rolesCreatableBy(actor: {
  role: UserRole;
  site: UserSite;
}): UserRole[] {
  if (!actor.role || actor.role !== "admin") return [];
  if (isGlobalAdmin(actor)) {
    return ["gerant", "comptable", "daf", "admin"];
  }
  // Admin de zone : pas de DAF / comptable multi-sites
  return ["gerant", "admin"];
}

/** Sites autorisés pour un rôle donné, selon l’admin connecté. */
export function sitesCreatableBy(
  actor: { role: UserRole; site: UserSite },
  targetRole: UserRole,
): UserSite[] {
  const base = sitesForRole(targetRole);
  if (isGlobalAdmin(actor)) return base;
  const zone = effectiveSite(actor.role, actor.site);
  if (zone === "tous") return base;
  return base.filter((s) => s === zone);
}

/**
 * Vérifie qu’un admin a le droit de créer / modifier un compte cible.
 * L’admin de zone ne gère que sa zone ; seul l’admin global crée des comptes « tous ».
 */
export function assertAdminCanManageTarget(
  actor: { role: UserRole; site: UserSite; username?: string },
  target: { role: UserRole; site: UserSite; username?: string },
): void {
  if (actor.role !== "admin") {
    throw new Error("Accès administrateur requis.");
  }

  const actorSite = effectiveSite(actor.role, actor.site);
  const targetSite = effectiveSite(target.role, target.site);

  if (target.username && isPrincipalAdminAccount(target.username)) {
    if (!isGlobalAdmin(actor)) {
      throw new Error(
        "Seul l’administrateur global peut modifier le compte admin principal.",
      );
    }
  }

  if (isGlobalAdmin(actor)) {
    assertValidRoleSite(target.role, target.site);
    return;
  }

  // Admin de zone
  if (targetSite === "tous") {
    throw new Error(
      "Un administrateur de zone ne peut pas gérer un compte multi-sites. Demandez à l’administrateur global.",
    );
  }
  if (targetSite !== actorSite) {
    throw new Error(
      `Cet administrateur ne gère que le site ${SITE_LABELS[actorSite]}.`,
    );
  }
  if (target.role === "admin" && targetSite !== actorSite) {
    throw new Error("Impossible de créer un admin hors de votre zone.");
  }
  assertValidRoleSite(target.role, target.site);
}

export function userVisibleToAdmin(
  actor: { role: UserRole; site: UserSite },
  user: { role: UserRole; site: UserSite; username: string },
): boolean {
  if (isGlobalAdmin(actor)) return true;
  const actorSite = effectiveSite(actor.role, actor.site);
  if (actorSite === "tous") return true;
  const userSite = effectiveSite(user.role, user.site);
  // L’admin de zone voit les comptes de sa zone (pas les globaux)
  return userSite === actorSite;
}

export type NavKey =
  | "vente"
  | "caisse"
  | "appro"
  | "matieres"
  | "pertes"
  | "reglages"
  | "parametres"
  | "zogbo"
  | "gbegamey"
  | "synthese"
  | "analyse"
  | "compte-resultat"
  | "comptabilite"
  | "historique"
  | "journal-ventes"
  | "regularisation"
  | "immobilisations"
  | "stock"
  | "admin"
  | "journal-stock";

const ROLE_NAV: Record<UserRole, NavKey[]> = {
  gerant: [
    "synthese",
    "analyse",
    "vente",
    "caisse",
    "zogbo",
    "gbegamey",
    "appro",
    "pertes",
    "stock",
    "immobilisations",
    "parametres",
    // Journal des ventes de sa zone (tickets, détail, export).
    "journal-ventes",
    // Saisie / correction / annulation des ventes d'un jour passé.
    "regularisation",
  ],
  // Finance + stocks par zone (plats, accompagnements, boissons, matières)
  // et immobilisations (emballages / actifs).
  comptable: [
    "synthese",
    "analyse",
    "compte-resultat",
    "comptabilite",
    "caisse",
    "zogbo",
    "gbegamey",
    "appro",
    "stock",
    "immobilisations",
    "journal-ventes",
    "journal-stock",
    "historique",
  ],
  // Même périmètre qu’admin, sans la page Équipe (gestion des comptes).
  daf: [
    "synthese",
    "analyse",
    "compte-resultat",
    "comptabilite",
    "vente",
    "caisse",
    "parametres",
    "zogbo",
    "gbegamey",
    "appro",
    "pertes",
    "reglages",
    "journal-ventes",
    "regularisation",
    "stock",
    "immobilisations",
    "historique",
    "journal-stock",
  ],
  admin: [
    "synthese",
    "analyse",
    "compte-resultat",
    "comptabilite",
    "vente",
    "caisse",
    "parametres",
    "zogbo",
    "gbegamey",
    "appro",
    "pertes",
    "reglages",
    "journal-ventes",
    "regularisation",
    "stock",
    "immobilisations",
    "historique",
    "admin",
    // Journal complet des mouvements de stock (ventes, achats, pertes,
    // réceptions) avec export détaillé : audit réservé à l'administration.
    "journal-stock",
  ],
};

/** Sites proposés à la création / édition selon le rôle. */
export function sitesForRole(role: UserRole): UserSite[] {
  if (role === "gerant") {
    // Le gérant est rattaché à UNE zone : il ne voit jamais l'autre.
    return ["zogbo", "gbegamey"];
  }
  if (role === "daf" || role === "comptable") {
    // Multi-sites : les deux restaurants.
    return ["tous"];
  }
  return ["zogbo", "gbegamey", "tous"];
}

export function defaultSiteForRole(role: UserRole): UserSite {
  if (role === "admin" || role === "daf" || role === "comptable") return "tous";
  return "gbegamey";
}

export function assertValidRoleSite(role: UserRole, site: UserSite): void {
  if (!sitesForRole(role).includes(site)) {
    throw new Error(
      "Ce rôle doit être rattaché à un seul site (Zogbo ou Gbégamey).",
    );
  }
}

/** Corrige les anciens comptes encore en « tous » : une zone unique fait foi. */
export function effectiveSite(role: UserRole, site: UserSite): UserSite {
  if (role === "gerant" && site === "tous") {
    return "gbegamey";
  }
  return site;
}

/**
 * Menu filtré par rôle + site : un compte Zogbo ne voit pas Gbégamey
 * (et inversement).
 */
export function navForUser(
  role: UserRole,
  site: UserSite,
  username?: string,
): NavKey[] {
  if (role === "admin" && username && isExecutiveAdminAccount(username)) {
    return [...EXECUTIVE_ADMIN_NAV];
  }
  const scoped = effectiveSite(role, site);
  let keys = [...ROLE_NAV[role]];

  if (scoped === "zogbo") {
    keys = keys.filter((k) => k !== "gbegamey");
  } else if (scoped === "gbegamey") {
    keys = keys.filter((k) => k !== "zogbo");
  }

  return keys;
}

export function navForRole(role: UserRole): NavKey[] {
  return navForUser(role, "tous");
}

export function navForSession(user: {
  role: UserRole;
  site: UserSite;
  username: string;
}): NavKey[] {
  return navForUser(user.role, user.site, user.username);
}

export function canAccessPath(
  role: UserRole,
  pathname: string,
  site: UserSite = "tous",
  username?: string,
): boolean {
  const allowed = navForUser(role, site, username);
  if (pathname.startsWith("/admin")) return allowed.includes("admin");
  if (pathname.startsWith("/vente")) return allowed.includes("vente");
  if (pathname.startsWith("/caisse")) return allowed.includes("caisse");
  if (
    pathname.startsWith("/appro") ||
    pathname.startsWith("/achats") ||
    pathname.startsWith("/matieres")
  ) {
    return allowed.includes("appro");
  }
  if (pathname.startsWith("/matieres")) return allowed.includes("matieres");
  if (pathname.startsWith("/pertes")) return allowed.includes("pertes");
  if (pathname.startsWith("/reglages")) return allowed.includes("reglages");
  if (pathname.startsWith("/parametres")) return allowed.includes("parametres");
  if (pathname.startsWith("/zogbo")) return allowed.includes("zogbo");
  if (pathname.startsWith("/gbegamey")) return allowed.includes("gbegamey");
  if (pathname.startsWith("/combos")) {
    return allowed.includes("stock");
  }
  if (pathname.startsWith("/boissons")) {
    return allowed.includes("zogbo") || allowed.includes("gbegamey");
  }
  if (pathname.startsWith("/synthese")) return allowed.includes("synthese");
  if (pathname.startsWith("/analyse")) return allowed.includes("analyse");
  if (pathname.startsWith("/compte-resultat")) {
    return allowed.includes("compte-resultat");
  }
  if (pathname.startsWith("/comptabilite")) {
    return allowed.includes("comptabilite");
  }
  if (pathname.startsWith("/parametres-comptables")) {
    // Lecture des modules avancés (Capital, Amortissements, Comptes tiers) :
    // même périmètre que Comptabilité. L'activation elle-même reste réservée
    // au compte direction (marc), vérifié séparément côté route.
    return allowed.includes("comptabilite");
  }
  if (pathname.startsWith("/historique-ventes")) {
    return allowed.includes("journal-ventes");
  }
  if (pathname.startsWith("/journal-ventes")) {
    return allowed.includes("journal-ventes");
  }
  if (pathname.startsWith("/regularisation")) {
    return allowed.includes("regularisation");
  }
  if (pathname.startsWith("/immobilisations")) {
    // Page réservée gérant/admin ; l’API doit aussi être lisible en caisse
    // (écran Vente) pour proposer les emballages au panier.
    return (
      allowed.includes("immobilisations") || allowed.includes("vente")
    );
  }
  if (pathname.startsWith("/stock")) {
    return allowed.includes("stock");
  }
  if (pathname.startsWith("/historique")) return allowed.includes("historique");
  if (pathname.startsWith("/journal-stock")) {
    return allowed.includes("journal-stock");
  }
  if (pathname === "/" || pathname === "") {
    return allowed.includes("synthese");
  }
  return false;
}

export function homeForRole(_role: UserRole): string {
  return "/";
}

export function canUseSite(
  userSite: UserSite,
  target: "zogbo" | "gbegamey",
): boolean {
  if (userSite === "tous") return true;
  return userSite === target;
}

/**
 * Gérant, DAF, admin et comptable : saisir / corriger sur un jour passé
 * (ventes, stock, achats, pertes — y compris journée ou caisse clôturée).
 */
export function canManagePastVentes(role: UserRole): boolean {
  return (
    role === "gerant" ||
    role === "comptable" ||
    hasDirectionAccess(role)
  );
}

/** Filtre Mongo / API : rien si « tous », sinon le site unique. */
export function scopeSiteFilter(
  userSite: UserSite,
): { site: "zogbo" | "gbegamey" } | Record<string, never> {
  if (userSite === "tous") return {};
  return { site: userSite };
}

export function resolveUserSiteScope(
  userSite: UserSite,
): "zogbo" | "gbegamey" | null {
  if (userSite === "tous") return null;
  return userSite;
}

export function resolveUserSiteScopeFromUser(user: {
  role: UserRole;
  site: UserSite;
}): "zogbo" | "gbegamey" | null {
  return resolveUserSiteScope(effectiveSite(user.role, user.site));
}
