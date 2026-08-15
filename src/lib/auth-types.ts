export type UserRole =
  | "vendeur"
  | "cuisine"
  /**
   * Rôle polyvalent : réunit vendeur et cuisine sur un même poste. Dans un
   * restaurant où la même personne encaisse et suit la production, séparer les
   * deux obligeait à jongler entre deux comptes.
   */
  | "equipier"
  | "gerant"
  | "admin";
export type UserSite = "zogbo" | "gbegamey" | "tous";

/**
 * Équipe de service. Rattachée au compte : c'est ainsi qu'on sait quelle
 * équipe a encaissé, sans rien demander au vendeur au moment de la vente.
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
  vendeur: "Vendeur",
  cuisine: "Cuisine / Production",
  equipier: "Vente & Cuisine",
  gerant: "Gérant",
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
  return `${ROLE_LABELS[role]} · ${SITE_LABELS[site]}`;
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

/** Rôles qu’un admin peut attribuer. */
export function rolesCreatableBy(actor: {
  role: UserRole;
  site: UserSite;
}): UserRole[] {
  if (!actor.role || actor.role !== "admin") return [];
  if (isGlobalAdmin(actor)) {
    return ["equipier", "vendeur", "cuisine", "gerant", "admin"];
  }
  // Admin de zone : pas de gérant multi-sites, mais peut créer un autre admin de sa zone
  return ["equipier", "vendeur", "cuisine", "gerant", "admin"];
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
  | "compte-resultat"
  | "historique"
  | "historique-ventes"
  | "journal-ventes"
  | "stock"
  | "admin"
  | "journal-stock"
  | "pilotage-global";

const ROLE_NAV: Record<UserRole, NavKey[]> = {
  vendeur: ["synthese", "vente", "caisse"],
  cuisine: ["synthese", "zogbo", "appro", "pertes"],
  // Union des deux rôles précédents, sans rien y ajouter.
  equipier: [
    "synthese",
    "vente",
    "caisse",
    "zogbo",
    "appro",
    "pertes",
  ],
  gerant: [
    "synthese",
    "vente",
    "caisse",
    "zogbo",
    "gbegamey",
    "appro",
    "pertes",
    "stock",
    // L'historique des ventes de SA zone : le filtre Site est verrouillé
    // sur sa zone (jamais celle d'à côté).
    "historique-ventes",
    // Journal détaillé des ventes de sa zone, jour par jour.
    "journal-ventes",
  ],
  admin: [
    "synthese",
    "compte-resultat",
    "vente",
    "caisse",
    "parametres",
    "zogbo",
    "gbegamey",
    "appro",
        "pertes",
    "reglages",
    "historique-ventes",
    "journal-ventes",
    "stock",
    "historique",
    "admin",
    // Journal complet des mouvements de stock (ventes, achats, pertes,
    // réceptions) avec export détaillé : audit réservé à l'administration.
    "journal-stock",
    // Vue consolidée de tout le réseau, coffre central compris : même
    // périmètre que Compte de résultat et Registre, administration seule.
    "pilotage-global",
  ],
};

/** Sites proposés à la création / édition selon le rôle. */
export function sitesForRole(role: UserRole): UserSite[] {
  if (role === "vendeur" || role === "cuisine" || role === "equipier") {
    return ["zogbo", "gbegamey"];
  }
  if (role === "gerant") {
    // Le gérant est rattaché à UNE zone : il ne voit jamais l'autre.
    return ["zogbo", "gbegamey"];
  }
  return ["zogbo", "gbegamey", "tous"];
}

export function defaultSiteForRole(role: UserRole): UserSite {
  if (role === "admin") return "tous";
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
  if (
    (role === "vendeur" ||
      role === "cuisine" ||
      role === "equipier" ||
      role === "gerant") &&
    site === "tous"
  ) {
    return "gbegamey";
  }
  return site;
}

/**
 * Menu filtré par rôle + site : un compte Zogbo ne voit pas Gbégamey
 * (et inversement). Cuisine suit le site assigné.
 */
export function navForUser(role: UserRole, site: UserSite): NavKey[] {
  const scoped = effectiveSite(role, site);
  let keys = [...ROLE_NAV[role]];

  if (role === "cuisine" || role === "equipier") {
    const position = keys.indexOf("zogbo");
    keys = keys.filter((k) => k !== "zogbo" && k !== "gbegamey");
    keys.splice(position, 0, scoped === "gbegamey" ? "gbegamey" : "zogbo");
  }

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

export function canAccessPath(
  role: UserRole,
  pathname: string,
  site: UserSite = "tous",
): boolean {
  const allowed = navForUser(role, site);
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
  if (pathname.startsWith("/combos") || pathname.startsWith("/boissons")) {
    return allowed.includes("zogbo") || allowed.includes("gbegamey");
  }
  if (pathname.startsWith("/synthese")) return allowed.includes("synthese");
  if (pathname.startsWith("/compte-resultat")) {
    return allowed.includes("compte-resultat");
  }
  if (pathname.startsWith("/historique-ventes")) {
    return allowed.includes("historique-ventes");
  }
  if (pathname.startsWith("/journal-ventes")) {
    return allowed.includes("journal-ventes");
  }
  if (pathname.startsWith("/stock")) {
    return allowed.includes("stock");
  }
  if (pathname.startsWith("/historique")) return allowed.includes("historique");
  if (pathname.startsWith("/pilotage-global")) {
    return allowed.includes("pilotage-global");
  }
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
