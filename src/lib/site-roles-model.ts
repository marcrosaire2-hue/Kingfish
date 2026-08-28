import type { UserRole } from "@/lib/auth-types";
import type { VenteSite } from "@/lib/types";

/** Actions configurables sur les ventes / commandes. */
export type VentePolicyAction = "sell" | "modify" | "delete" | "cancel";

export type VentePolicyPermissions = {
  sell: boolean;
  modify: boolean;
  delete: boolean;
  cancel: boolean;
};

export type SiteRolesConfig = {
  /** Restrictions globales par point de vente (tous rôles confondus). */
  sites: {
    zogbo: VentePolicyPermissions;
    gbegamey: VentePolicyPermissions;
  };
  /** Droits par rôle métier. */
  roles: Record<UserRole, VentePolicyPermissions>;
  updatedAt: string | null;
};

export const USER_ROLES: UserRole[] = ["gerant", "comptable", "daf", "admin"];

export const VENTE_POLICY_ACTION_LABELS: Record<
  VentePolicyAction,
  { label: string; hint: string }
> = {
  sell: {
    label: "Enregistrer",
    hint: "Encaisser une vente ou valider un ticket / commande.",
  },
  modify: {
    label: "Modifier",
    hint: "Corriger les quantités d'une vente ou d'une ligne de commande.",
  },
  delete: {
    label: "Supprimer",
    hint: "Suppression définitive d'une vente ou d'un ticket (motif requis).",
  },
  cancel: {
    label: "Annuler",
    hint: "Annuler une vente ou un ticket et reprendre le stock.",
  },
};

export const VENTE_POLICY_ACTIONS: VentePolicyAction[] = [
  "sell",
  "modify",
  "delete",
  "cancel",
];

export const DEFAULT_VENTE_POLICY_PERMISSIONS: VentePolicyPermissions = {
  sell: true,
  modify: true,
  delete: true,
  cancel: true,
};

/** Aligné sur le comportement historique de l'application. */
export const DEFAULT_ROLE_VENTE_PERMISSIONS: Record<
  UserRole,
  VentePolicyPermissions
> = {
  gerant: { sell: true, modify: true, delete: false, cancel: true },
  comptable: { sell: false, modify: true, delete: false, cancel: false },
  daf: { sell: true, modify: true, delete: false, cancel: true },
  admin: { sell: true, modify: true, delete: true, cancel: true },
};

export const DEFAULT_SITE_ROLES_CONFIG: SiteRolesConfig = {
  sites: {
    zogbo: { ...DEFAULT_VENTE_POLICY_PERMISSIONS },
    gbegamey: { ...DEFAULT_VENTE_POLICY_PERMISSIONS },
  },
  roles: {
    gerant: { ...DEFAULT_ROLE_VENTE_PERMISSIONS.gerant },
    comptable: { ...DEFAULT_ROLE_VENTE_PERMISSIONS.comptable },
    daf: { ...DEFAULT_ROLE_VENTE_PERMISSIONS.daf },
    admin: { ...DEFAULT_ROLE_VENTE_PERMISSIONS.admin },
  },
  updatedAt: null,
};

export function permissionsForSite(
  config: SiteRolesConfig,
  site: VenteSite,
): VentePolicyPermissions {
  return config.sites[site];
}

export function permissionsForRole(
  config: SiteRolesConfig,
  role: UserRole,
): VentePolicyPermissions {
  return config.roles[role] ?? DEFAULT_ROLE_VENTE_PERMISSIONS[role];
}

export function isVenteActionAllowed(
  config: SiteRolesConfig,
  role: UserRole,
  site: VenteSite,
  action: VentePolicyAction,
): boolean {
  return (
    permissionsForSite(config, site)[action] &&
    permissionsForRole(config, role)[action]
  );
}

export function ventePermissionsFor(
  config: SiteRolesConfig,
  role: UserRole,
  site: VenteSite,
): VentePolicyPermissions {
  const sitePerms = permissionsForSite(config, site);
  const rolePerms = permissionsForRole(config, role);
  return {
    sell: sitePerms.sell && rolePerms.sell,
    modify: sitePerms.modify && rolePerms.modify,
    delete: sitePerms.delete && rolePerms.delete,
    cancel: sitePerms.cancel && rolePerms.cancel,
  };
}

/** Pendant le chargement ou sans config, on autorise l'affichage (l'API bloque). */
export function venteActionEnabled(
  config: SiteRolesConfig | null | undefined,
  role: UserRole | null | undefined,
  site: VenteSite,
  action: VentePolicyAction,
): boolean {
  if (!config || !role) return true;
  return isVenteActionAllowed(config, role, site, action);
}

/** @deprecated Utiliser venteActionEnabled */
export type SiteVenteAction = Exclude<VentePolicyAction, "sell">;
export type SiteVentePermissions = Omit<VentePolicyPermissions, "sell">;
export const SITE_VENTE_ACTION_LABELS = VENTE_POLICY_ACTION_LABELS;
export function siteActionEnabled(
  config: SiteRolesConfig | null | undefined,
  site: VenteSite,
  action: SiteVenteAction,
): boolean {
  if (!config) return true;
  return config.sites[site][action];
}

export function isSiteVenteActionAllowed(
  config: SiteRolesConfig,
  site: VenteSite,
  action: SiteVenteAction,
): boolean {
  return config.sites[site][action];
}
