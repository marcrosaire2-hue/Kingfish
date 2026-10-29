import { cached, invalidateCache } from "@/lib/ttl-cache";
import { getDb } from "@/lib/mongodb";
import type { UserRole } from "@/lib/auth-types";
import {
  DEFAULT_ROLE_VENTE_PERMISSIONS,
  DEFAULT_SITE_ROLES_CONFIG,
  DEFAULT_VENTE_POLICY_PERMISSIONS,
  USER_ROLES,
  type SiteRolesConfig,
  type UserSiteOverrides,
  type VentePolicyPermissions,
} from "@/lib/site-roles-model";
import type { VenteSite } from "@/lib/types";

const DOC_ID = "site_roles";

type SiteRolesDoc = SiteRolesConfig & { _id: string };

/** Ancien format : zogbo / gbegamey à la racine. */
type LegacySiteRolesDoc = {
  _id: string;
  zogbo?: Partial<VentePolicyPermissions>;
  gbegamey?: Partial<VentePolicyPermissions>;
  updatedAt?: string | null;
};

function normalizePermissions(
  raw: Partial<VentePolicyPermissions> | undefined,
  fallback: VentePolicyPermissions = DEFAULT_VENTE_POLICY_PERMISSIONS,
): VentePolicyPermissions {
  return {
    sell: raw?.sell !== undefined ? raw.sell : fallback.sell,
    modify: raw?.modify !== undefined ? raw.modify : fallback.modify,
    delete: raw?.delete !== undefined ? raw.delete : fallback.delete,
    cancel: raw?.cancel !== undefined ? raw.cancel : fallback.cancel,
  };
}

function normalizeRolePermissions(
  raw: Partial<Record<UserRole, Partial<VentePolicyPermissions>>> | undefined,
): Record<UserRole, VentePolicyPermissions> {
  const out = { ...DEFAULT_SITE_ROLES_CONFIG.roles };
  for (const role of USER_ROLES) {
    out[role] = normalizePermissions(raw?.[role], DEFAULT_ROLE_VENTE_PERMISSIONS[role]);
  }
  return out;
}

/** Ne garde que des booléens valides, pour des sites connus. */
export function sanitizeUserOverrides(
  raw: unknown,
): Record<string, UserSiteOverrides> {
  const out: Record<string, UserSiteOverrides> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [userId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[a-f0-9]{24}$/i.test(userId) || !value || typeof value !== "object") continue;
    const perSite: UserSiteOverrides = {};
    for (const site of ["zogbo", "gbegamey"] as VenteSite[]) {
      const sv = (value as Record<string, unknown>)[site];
      if (!sv || typeof sv !== "object") continue;
      const perms: Partial<VentePolicyPermissions> = {};
      for (const action of ["sell", "modify", "delete", "cancel"] as const) {
        const b = (sv as Record<string, unknown>)[action];
        if (typeof b === "boolean") perms[action] = b;
      }
      if (Object.keys(perms).length) perSite[site] = perms;
    }
    if (Object.keys(perSite).length) out[userId] = perSite;
  }
  return out;
}

function normalize(doc: Partial<SiteRolesDoc & LegacySiteRolesDoc> | null): SiteRolesConfig {
  if (doc?.sites) {
    return {
      sites: {
        zogbo: normalizePermissions(doc.sites.zogbo),
        gbegamey: normalizePermissions(doc.sites.gbegamey),
      },
      roles: normalizeRolePermissions(doc.roles),
      users: sanitizeUserOverrides(doc.users),
      updatedAt: doc.updatedAt ?? null,
    };
  }

  // Migration depuis l'ancien schéma (permissions par site seulement).
  const legacyZogbo = doc?.zogbo;
  const legacyGbegamey = doc?.gbegamey;
  return {
    sites: {
      zogbo: normalizePermissions(legacyZogbo),
      gbegamey: normalizePermissions(legacyGbegamey),
    },
    roles: { ...DEFAULT_SITE_ROLES_CONFIG.roles },
    updatedAt: doc?.updatedAt ?? null,
  };
}

export async function getSiteRolesConfig(): Promise<SiteRolesConfig> {
  const db = await getDb();
  return cached(`${db.databaseName}:site_roles`, 15_000, loadSiteRolesConfig);
}

async function loadSiteRolesConfig(): Promise<SiteRolesConfig> {
  const db = await getDb();
  const existing = await db
    .collection<SiteRolesDoc>("site_roles")
    .findOne({ _id: DOC_ID });
  if (existing) return normalize(existing);

  const seeded = {
    ...DEFAULT_SITE_ROLES_CONFIG,
    updatedAt: new Date().toISOString(),
  };
  await db.collection<SiteRolesDoc>("site_roles").updateOne(
    { _id: DOC_ID },
    { $set: { _id: DOC_ID, ...seeded } },
    { upsert: true },
  );
  return seeded;
}

export async function saveSiteRolesConfig(input: {
  sites?: Partial<Record<VenteSite, Partial<VentePolicyPermissions>>>;
  roles?: Partial<Record<UserRole, Partial<VentePolicyPermissions>>>;
  /** Remplace l'ensemble des droits par compte. */
  users?: Record<string, UserSiteOverrides>;
}): Promise<SiteRolesConfig> {
  const current = await getSiteRolesConfig();
  const nextSites = { ...current.sites };
  if (input.sites?.zogbo) {
    nextSites.zogbo = normalizePermissions({
      ...current.sites.zogbo,
      ...input.sites.zogbo,
    });
  }
  if (input.sites?.gbegamey) {
    nextSites.gbegamey = normalizePermissions({
      ...current.sites.gbegamey,
      ...input.sites.gbegamey,
    });
  }

  const nextRoles = { ...current.roles };
  if (input.roles) {
    for (const role of USER_ROLES) {
      if (input.roles[role]) {
        nextRoles[role] = normalizePermissions(
          { ...current.roles[role], ...input.roles[role] },
          DEFAULT_ROLE_VENTE_PERMISSIONS[role],
        );
      }
    }
  }

  const next: SiteRolesConfig = {
    sites: nextSites,
    roles: nextRoles,
    users: input.users ? sanitizeUserOverrides(input.users) : (current.users ?? {}),
    updatedAt: new Date().toISOString(),
  };
  const db = await getDb();
  await db.collection<SiteRolesDoc>("site_roles").updateOne(
    { _id: DOC_ID },
    { $set: { _id: DOC_ID, ...next } },
    { upsert: true },
  );
  invalidateCache(`${db.databaseName}:site_roles`);
  return next;
}

export function siteRolesSummary(config: SiteRolesConfig, site: VenteSite) {
  return config.sites[site];
}
