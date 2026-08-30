import { ObjectId, type WithId } from "mongodb";
import {
  defaultNavKeysForRole,
  isExecutiveAdminAccount,
  roleNavUnscoped,
  type NavKey,
  type SessionUser,
  type UserRole,
} from "@/lib/auth-types";
import {
  EMPTY_AUTORISATIONS,
  PERMISSION_RESOURCES,
  resourceById,
  type AutorisationsConfig,
  type AutorisationsHistoryEntry,
  type PermissionAction,
  type PermissionOverride,
  type PermissionValue,
} from "@/lib/autorisations-model";
import { getDb } from "@/lib/mongodb";

const CONFIG_ID = "config";

type ConfigDoc = WithId<{
  _id: string;
  version: number;
  overrides: PermissionOverride[];
  updatedAt: string | null;
  updatedBy: AutorisationsConfig["updatedBy"];
}>;

type HistoryDoc = {
  _id: ObjectId;
  at: string;
  actorId: string | null;
  actorName: string | null;
  actorUsername: string | null;
  summary: string;
  detail: string;
};

function normalizeOverride(raw: PermissionOverride): PermissionOverride | null {
  if (!raw || (raw.targetType !== "role" && raw.targetType !== "user")) {
    return null;
  }
  if (typeof raw.targetId !== "string" || !raw.targetId.trim()) return null;
  if (typeof raw.resourceId !== "string" || !resourceById(raw.resourceId)) {
    return null;
  }
  const actions: Partial<Record<PermissionAction, PermissionValue>> = {};
  for (const [k, v] of Object.entries(raw.actions ?? {})) {
    if (
      (k === "access" ||
        k === "view" ||
        k === "create" ||
        k === "update" ||
        k === "delete" ||
        k === "admin") &&
      (v === "allow" || v === "deny" || v === "inherit")
    ) {
      if (v !== "inherit") actions[k] = v;
    }
  }
  if (Object.keys(actions).length === 0) return null;
  return {
    targetType: raw.targetType,
    targetId: raw.targetId.trim(),
    resourceId: raw.resourceId,
    actions,
  };
}

export async function getAutorisationsConfig(): Promise<AutorisationsConfig> {
  const db = await getDb();
  const doc = await db
    .collection<ConfigDoc>("autorisations")
    .findOne({ _id: CONFIG_ID });
  if (!doc) return { ...EMPTY_AUTORISATIONS, overrides: [] };
  return {
    version: Number(doc.version) || 1,
    overrides: (doc.overrides ?? [])
      .map(normalizeOverride)
      .filter((o): o is PermissionOverride => !!o),
    updatedAt: doc.updatedAt ?? null,
    updatedBy: doc.updatedBy ?? null,
  };
}

/**
 * Décision effective pour une action : override user > override rôle > héritage code.
 */
export function resolveActionDecision(input: {
  config: AutorisationsConfig;
  role: UserRole;
  userId?: string;
  resourceId: string;
  action: PermissionAction;
  defaultAllowed: boolean;
}): { value: PermissionValue; source: "user" | "role" | "inherit" } {
  const { config, role, userId, resourceId, action, defaultAllowed } = input;
  if (userId) {
    const userOv = config.overrides.find(
      (o) =>
        o.targetType === "user" &&
        o.targetId === userId &&
        o.resourceId === resourceId,
    );
    const uv = userOv?.actions?.[action];
    if (uv === "allow" || uv === "deny") {
      return { value: uv, source: "user" };
    }
  }
  const roleOv = config.overrides.find(
    (o) =>
      o.targetType === "role" &&
      o.targetId === role &&
      o.resourceId === resourceId,
  );
  const rv = roleOv?.actions?.[action];
  if (rv === "allow" || rv === "deny") {
    return { value: rv, source: "role" };
  }
  return {
    value: defaultAllowed ? "allow" : "deny",
    source: "inherit",
  };
}

export function isActionAllowed(input: {
  config: AutorisationsConfig;
  role: UserRole;
  userId?: string;
  username?: string;
  site: SessionUser["site"];
  resourceId: string;
  action: PermissionAction;
}): boolean {
  const resource = resourceById(input.resourceId);
  if (!resource) return false;
  if (
    input.role !== "admin" &&
    (input.resourceId === "admin" || input.resourceId === "autorisations")
  ) {
    return false;
  }
  const defaults = roleNavUnscoped(
    input.role,
    input.username,
  );
  const defaultAllowed = resource.navKey
    ? defaults.includes(resource.navKey)
    : false;
  // Pour les actions autres que access : héritage = même porte que l'accès page.
  const baseAllowed =
    input.action === "access" || input.action === "view"
      ? defaultAllowed
      : defaultAllowed;
  const decision = resolveActionDecision({
    config: input.config,
    role: input.role,
    userId: input.userId,
    resourceId: input.resourceId,
    action: input.action,
    defaultAllowed: baseAllowed,
  });
  return decision.value === "allow";
}

/** Menu effectif après application des overrides (access). */
export async function resolveEffectiveNav(
  user: Pick<SessionUser, "id" | "role" | "site" | "username">,
): Promise<NavKey[]> {
  const config = await getAutorisationsConfig();
  const base = defaultNavKeysForRole(user.role, user.site, user.username);
  const allowed = new Set<NavKey>(base);

  for (const resource of PERMISSION_RESOURCES) {
    if (!resource.navKey) continue;
    const ok = isActionAllowed({
      config,
      role: user.role,
      userId: user.id,
      username: user.username,
      site: user.site,
      resourceId: resource.id,
      action: "access",
    });
    if (ok) allowed.add(resource.navKey);
    else allowed.delete(resource.navKey);
  }

  // Compte direction : ne jamais perdre Équipe ni le tableau de bord.
  if (isExecutiveAdminAccount(user.username)) {
    allowed.add("admin");
    allowed.add("synthese");
  }

  if (user.role !== "admin") {
    allowed.delete("admin");
  }

  return [...allowed];
}

export function assertSafeAutorisationsSave(input: {
  actor: SessionUser;
  overrides: PermissionOverride[];
}): void {
  const { actor, overrides } = input;
  // Empêche de se retirer Autorisations / Équipe.
  for (const critical of ["autorisations", "admin"] as const) {
    const selfDeny = overrides.find(
      (o) =>
        o.targetType === "user" &&
        o.targetId === actor.id &&
        o.resourceId === critical &&
        o.actions.access === "deny",
    );
    if (selfDeny) {
      throw new Error(
        `Impossible de vous retirer l’accès à « ${critical} » (protection du compte connecté).`,
      );
    }
  }
  if (isExecutiveAdminAccount(actor.username)) {
    for (const critical of ["autorisations", "admin", "synthese"] as const) {
      const roleDeny = overrides.find(
        (o) =>
          o.targetType === "role" &&
          o.targetId === "admin" &&
          o.resourceId === critical &&
          o.actions.access === "deny",
      );
      if (roleDeny) {
        throw new Error(
          `Le rôle Administrateur ne peut pas perdre l’accès critique « ${critical} ».`,
        );
      }
    }
  }
}

export async function saveAutorisationsConfig(input: {
  overrides: PermissionOverride[];
  actor: SessionUser;
  summary?: string;
}): Promise<AutorisationsConfig> {
  assertSafeAutorisationsSave({
    actor: input.actor,
    overrides: input.overrides,
  });

  const cleaned = input.overrides
    .map(normalizeOverride)
    .filter((o): o is PermissionOverride => !!o);

  const prev = await getAutorisationsConfig();
  const now = new Date().toISOString();
  const next: AutorisationsConfig = {
    version: (prev.version || 1) + 1,
    overrides: cleaned,
    updatedAt: now,
    updatedBy: {
      id: input.actor.id,
      name: input.actor.name,
      username: input.actor.username,
    },
  };

  const db = await getDb();
  await db.collection<ConfigDoc>("autorisations").updateOne(
    { _id: CONFIG_ID },
    {
      $set: {
        version: next.version,
        overrides: next.overrides,
        updatedAt: next.updatedAt,
        updatedBy: next.updatedBy,
      },
    },
    { upsert: true },
  );

  const added = cleaned.length - prev.overrides.length;
  const summary =
    input.summary?.trim() ||
    `Matrice d’autorisations enregistrée (v${next.version}, ${cleaned.length} règle(s), Δ ${added >= 0 ? "+" : ""}${added}).`;

  await db.collection<HistoryDoc>("autorisations_history").insertOne({
    _id: new ObjectId(),
    at: now,
    actorId: input.actor.id,
    actorName: input.actor.name,
    actorUsername: input.actor.username,
    summary,
    detail: JSON.stringify({
      before: prev.overrides.length,
      after: cleaned.length,
      version: next.version,
    }),
  });

  return next;
}

export async function listAutorisationsHistory(
  limit = 40,
): Promise<AutorisationsHistoryEntry[]> {
  const db = await getDb();
  const docs = await db
    .collection<HistoryDoc>("autorisations_history")
    .find({})
    .sort({ at: -1 })
    .limit(Math.min(100, Math.max(1, limit)))
    .toArray();
  return docs.map((d) => ({
    id: d._id.toHexString(),
    at: d.at,
    actorId: d.actorId,
    actorName: d.actorName,
    actorUsername: d.actorUsername,
    summary: d.summary,
    detail: d.detail,
  }));
}

/** Invalide toutes les sessions pour forcer le rechargement du menu JWT. */
export async function bumpAllSessionTokenVersions(): Promise<number> {
  const db = await getDb();
  const result = await db.collection("users").updateMany(
    {},
    { $inc: { tokenVersion: 1 } },
  );
  return result.modifiedCount;
}
