import { getDb } from "@/lib/mongodb";
import type { UserRole } from "@/lib/auth-types";
import {
  DEFAULT_ROLE_VENTE_PERMISSIONS,
  DEFAULT_SITE_ROLES_CONFIG,
  DEFAULT_VENTE_POLICY_PERMISSIONS,
  USER_ROLES,
  type SiteRolesConfig,
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

function normalize(doc: Partial<SiteRolesDoc & LegacySiteRolesDoc> | null): SiteRolesConfig {
  if (doc?.sites) {
    return {
      sites: {
        zogbo: normalizePermissions(doc.sites.zogbo),
        gbegamey: normalizePermissions(doc.sites.gbegamey),
      },
      roles: normalizeRolePermissions(doc.roles),
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
    updatedAt: new Date().toISOString(),
  };
  const db = await getDb();
  await db.collection<SiteRolesDoc>("site_roles").updateOne(
    { _id: DOC_ID },
    { $set: { _id: DOC_ID, ...next } },
    { upsert: true },
  );
  return next;
}

export function siteRolesSummary(config: SiteRolesConfig, site: VenteSite) {
  return config.sites[site];
}
