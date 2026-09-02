export type UserRole =
  | "gerant"
  /**
   * Comptable : finance et consultation des stocks. Pas de vente POS,
   * pas de saisie de stock, pas d’analyse ni de registre d’activité.
   */
  | "comptable"
  /**
   * Directeur Administratif et Financier : finance et consultation, sans
   * vente POS, sans saisie de stock, sans gestion des comptes.
   */
  | "daf"
  | "admin";
export type UserSite = "zogbo" | "gbegamey" | "tous";

/**
 * Équipe de service. Rattachée au compte : c'est ainsi qu'on sait quelle
 * équipe a encaissé, sans rien demander au moment de la vente.
 * Les comptes d'encadrement peuvent n'appartenir à aucune équipe.
 */
/**
 * Créneaux de service :
 * - jour  = matin 08h–16h
 * - soir  = 16h–00h
 * - nuit  = 00h–08h (Gbégamey)
 * - aucune = hors équipe (encadrement)
 */
export type UserShift = "jour" | "soir" | "nuit" | "aucune";

export const SHIFT_LABELS: Record<UserShift, string> = {
  jour: "Équipe de jour",
  soir: "Équipe de soir",
  nuit: "Équipe de nuit",
  aucune: "Hors équipe",
};

export const SHIFTS: UserShift[] = ["jour", "soir", "nuit", "aucune"];

export function emptyShiftTotals(): Record<UserShift, number> {
  return { jour: 0, soir: 0, nuit: 0, aucune: 0 };
}

export function isShift(value: unknown): value is UserShift {
  return SHIFTS.includes(value as UserShift);
}

/**
 * Équipes écrites par les imports de carnets, qui parlent du service en
 * clair. « matin » → jour ; « soir » est désormais une équipe à part entière.
 */
const ALIAS_SHIFT: Record<string, UserShift> = {
  matin: "jour",
  midi: "jour",
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
  /**
   * Menu effectif figé dans le JWT (autorisations).
   * Absent des sessions anciennes → repli sur navForUser.
   */
  nav?: NavKey[];
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

/** Accès aux écrans / API financiers (résultat, comptabilité). */
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

export function isPrincipalAdminAccount(
  username: string | undefined | null,
): boolean {
  if (!username?.trim()) return false;
  return username.trim().toLowerCase() === "admin";
}

/**
 * Compte direction (Marc) : vue synthèse + journaux + registre + création
 * d'utilisateurs — sans les écrans opérationnels (vente, caisse, stocks zone…).
 */
export function isExecutiveAdminAccount(
  username: string | undefined | null,
): boolean {
  if (!username?.trim()) return false;
  const listed = (process.env.EXECUTIVE_ADMIN_USERNAMES ?? "marc")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return listed.includes(username.trim().toLowerCase());
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
  "versements",
  "journal-ventes",
  "quantites-vendues",
  "historique",
  "rapport-quotidien",
  "controle",
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

  if (isExecutiveAdminAccount(actor.username)) {
    assertValidRoleSite(target.role, target.site);
    return;
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
  actor: { role: UserRole; site: UserSite; username?: string },
  user: { role: UserRole; site: UserSite; username: string },
): boolean {
  if (isExecutiveAdminAccount(actor.username)) return true;
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
  | "versements"
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
  | "quantites-vendues"
  | "regularisation"
  | "immobilisations"
  | "stock"
  | "admin"
  | "rapport-quotidien"
  | "controle";

const ROLE_NAV: Record<UserRole, NavKey[]> = {
  gerant: [
    "synthese",
    "vente",
    "caisse",
    "zogbo",
    "gbegamey",
    "appro",
    "pertes",
    "versements",
    "stock",
    "parametres",
    // Journal des ventes de sa zone (tickets, détail, export).
    "journal-ventes",
    // Volumes vendus par article (période).
    "quantites-vendues",
    // Saisie / correction / annulation des ventes d'un jour passé.
    "regularisation",
    "rapport-quotidien",
    "controle",
  ],
  // Finance + consultation des stocks. Pas d’analyse, ni registre.
  comptable: [
    "synthese",
    "compte-resultat",
    "comptabilite",
    "caisse",
    "zogbo",
    "gbegamey",
    "appro",
    "versements",
    "stock",
    "immobilisations",
    "journal-ventes",
    "quantites-vendues",
    "rapport-quotidien",
    "controle",
  ],
  // Finance + consultation des stocks. Pas de vente, pertes, registre,
  // régularisation, réglages POS ni comptabilité.
  daf: [
    "synthese",
    "analyse",
    "compte-resultat",
    "caisse",
    "parametres",
    "zogbo",
    "gbegamey",
    "appro",
    "versements",
    "journal-ventes",
    "quantites-vendues",
    "stock",
    "immobilisations",
    "rapport-quotidien",
    "controle",
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
    "versements",
    "reglages",
    "journal-ventes",
    "quantites-vendues",
    "regularisation",
    "stock",
    "immobilisations",
    "historique",
    "admin",
    "rapport-quotidien",
    "controle",
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

/** Menu code du rôle sans filtre de site (héritage matrice Autorisations). */
export function roleNavUnscoped(
  role: UserRole,
  username?: string,
): NavKey[] {
  if (role === "admin" && username && isExecutiveAdminAccount(username)) {
    return [...EXECUTIVE_ADMIN_NAV];
  }
  return [...ROLE_NAV[role]];
}

/** Pages refusées au DAF même si un JWT / une matrice les réintroduit. */
const DAF_DENIED_NAV: readonly NavKey[] = [
  "vente",
  "pertes",
  "regularisation",
  "historique",
  "reglages",
  "comptabilite",
];

/** Pages refusées au comptable même si un JWT / une matrice les réintroduit. */
const COMPTABLE_DENIED_NAV: readonly NavKey[] = ["analyse", "historique"];

/** Pages refusées au gérant même si un JWT / une matrice les réintroduit. */
const GERANT_DENIED_NAV: readonly NavKey[] = ["analyse", "immobilisations"];

export function stripRoleDeniedNavKeys(
  keys: NavKey[],
  role: UserRole,
): NavKey[] {
  if (role === "gerant") {
    return keys.filter((k) => !GERANT_DENIED_NAV.includes(k));
  }
  if (role === "daf") {
    return keys.filter((k) => !DAF_DENIED_NAV.includes(k));
  }
  if (role === "comptable") {
    return keys.filter((k) => !COMPTABLE_DENIED_NAV.includes(k));
  }
  return keys;
}

/** Retire l’autre zone du menu (Zogbo ↔ Gbégamey). */
export function filterNavKeysBySite(
  keys: NavKey[],
  role: UserRole,
  site: UserSite,
): NavKey[] {
  const withoutRoleDenied = stripRoleDeniedNavKeys(keys, role);
  const scoped = effectiveSite(role, site);
  if (scoped === "zogbo") {
    return withoutRoleDenied.filter((k) => k !== "gbegamey");
  }
  if (scoped === "gbegamey") {
    return withoutRoleDenied.filter((k) => k !== "zogbo");
  }
  return withoutRoleDenied;
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
  return filterNavKeysBySite([...ROLE_NAV[role]], role, site);
}

/** Menu code (héritage) avant application des overrides Mongo. */
export function defaultNavKeysForRole(
  role: UserRole,
  site: UserSite = "tous",
  username?: string,
): NavKey[] {
  return navForUser(role, site, username);
}

export function navForRole(role: UserRole): NavKey[] {
  return navForUser(role, "tous");
}

export function navForSession(user: {
  role: UserRole;
  site: UserSite;
  username: string;
  nav?: NavKey[];
}): NavKey[] {
  const keys =
    user.nav && user.nav.length > 0
      ? [...user.nav]
      : navForUser(user.role, user.site, user.username);
  return filterNavKeysBySite(keys, user.role, user.site);
}

/**
 * Vérifie un chemin contre une liste de NavKey déjà résolue
 * (JWT / autorisations), sans recalculer le rôle.
 */
export function pathAllowedByNavKeys(
  allowed: NavKey[],
  pathname: string,
): boolean {
  return canAccessPathWithAllowed(allowed, pathname);
}

function canAccessPathWithAllowed(
  allowed: NavKey[],
  pathname: string,
): boolean {
  if (pathname.startsWith("/admin")) return allowed.includes("admin");
  if (pathname.startsWith("/autorisations")) {
    return allowed.includes("admin");
  }
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
  if (pathname.startsWith("/versements")) return allowed.includes("versements");
  if (pathname.startsWith("/reglages")) return allowed.includes("reglages");
  if (pathname.startsWith("/parametres")) return allowed.includes("parametres");
  if (pathname.startsWith("/stock-zogbo")) return allowed.includes("zogbo");
  if (pathname.startsWith("/zogbo")) return allowed.includes("zogbo");
  if (pathname.startsWith("/stock-gbegamey")) return allowed.includes("gbegamey");
  if (pathname.startsWith("/gbegamey")) return allowed.includes("gbegamey");
  if (pathname.startsWith("/combos")) {
    return (
      allowed.includes("parametres") ||
      allowed.includes("stock") ||
      allowed.includes("vente")
    );
  }
  if (pathname.startsWith("/boissons")) {
    return allowed.includes("zogbo") || allowed.includes("gbegamey");
  }
  if (pathname.startsWith("/synthese")) return allowed.includes("synthese");
  if (pathname.startsWith("/analyse")) return allowed.includes("analyse");
  if (pathname.startsWith("/rapport-quotidien")) {
    return allowed.includes("rapport-quotidien");
  }
  if (pathname.startsWith("/controle")) {
    return allowed.includes("controle");
  }
  if (pathname.startsWith("/compte-resultat")) {
    return allowed.includes("compte-resultat");
  }
  if (pathname.startsWith("/comptabilite")) {
    return allowed.includes("comptabilite");
  }
  if (pathname.startsWith("/parametres-comptables")) {
    return allowed.includes("comptabilite");
  }
  if (pathname.startsWith("/historique-ventes")) {
    return allowed.includes("journal-ventes");
  }
  if (pathname.startsWith("/journal-ventes")) {
    return allowed.includes("journal-ventes");
  }
  if (pathname.startsWith("/quantites-vendues")) {
    return allowed.includes("quantites-vendues");
  }
  if (pathname.startsWith("/regularisation")) {
    return allowed.includes("regularisation");
  }
  if (pathname.startsWith("/immobilisations")) {
    return allowed.includes("immobilisations");
  }
  if (pathname.startsWith("/stock")) {
    return allowed.includes("stock");
  }
  if (pathname.startsWith("/historique")) return allowed.includes("historique");
  if (pathname === "/" || pathname === "") {
    return allowed.includes("synthese");
  }
  return false;
}

export function canAccessPath(
  role: UserRole,
  pathname: string,
  site: UserSite = "tous",
  username?: string,
  navOverride?: NavKey[],
): boolean {
  if (
    role !== "admin" &&
    (pathname.startsWith("/admin") || pathname.startsWith("/autorisations"))
  ) {
    return false;
  }
  const allowed = filterNavKeysBySite(
    navOverride ?? navForUser(role, site, username),
    role,
    site,
  );
  return canAccessPathWithAllowed(allowed, pathname);
}

/** DAF et comptable consultent le stock ; ils ne préparent, ne scanne ni n’enregistrent. */
export function canWriteStock(role: UserRole): boolean {
  return role !== "daf" && role !== "comptable";
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
 * Gérant, DAF, admin et comptable : saisir / corriger un jour *ouvert* passé
 * (ventes, stock, achats, pertes). Ne contourne pas une clôture :
 * voir canCorrectClosedFinancialData.
 */
export function canManagePastVentes(role: UserRole): boolean {
  return (
    role === "gerant" ||
    role === "comptable" ||
    hasDirectionAccess(role)
  );
}

/** Seuls admin / DAF contournent l’isolation entre équipes de vente. */
export function canBypassTeamIsolation(role: UserRole): boolean {
  return role === "admin" || role === "daf";
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

export type RequiredSiteScope =
  | { ok: true; site: "zogbo" | "gbegamey" }
  | { ok: false; status: 400; error: string };

/**
 * Périmètre finance / caisse : un seul site à la fois.
 * Les comptes multi-sites doivent choisir Zogbo ou Gbégamey — plus de total
 * consolidé qui mélange les deux caisses.
 */
export function resolveRequiredSiteScope(
  user: { role: UserRole; site: UserSite },
  requested: unknown,
): RequiredSiteScope {
  const scoped = effectiveSite(user.role, user.site);
  if (scoped === "zogbo" || scoped === "gbegamey") {
    return { ok: true, site: scoped };
  }
  if (requested === "zogbo" || requested === "gbegamey") {
    return { ok: true, site: requested };
  }
  // Multi-sites : un seul site à la fois, jamais un total consolidé.
  return { ok: true, site: "zogbo" };
}
