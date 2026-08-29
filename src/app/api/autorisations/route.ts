import { NextResponse } from "next/server";
import { AuthError, authErrorResponse, requireUser } from "@/lib/api-auth";
import {
  isExecutiveAdminAccount,
  ROLE_LABELS,
  roleNavUnscoped,
  type UserRole,
} from "@/lib/auth-types";
import {
  PERMISSION_RESOURCES,
  ROLES_FOR_PERMISSIONS,
  isPermissionAction,
  isPermissionValue,
  type PermissionOverride,
} from "@/lib/autorisations-model";
import {
  bumpAllSessionTokenVersions,
  getAutorisationsConfig,
  listAutorisationsHistory,
  resolveActionDecision,
  saveAutorisationsConfig,
} from "@/lib/autorisations-repo";
import { logActivity } from "@/lib/log-activity";
import { listUsers } from "@/lib/users-repo";

export const runtime = "nodejs";

async function requireExecutiveAdmin() {
  const user = await requireUser();
  if (!isExecutiveAdminAccount(user.username) || user.role !== "admin") {
    throw new AuthError(
      "La matrice d’autorisations est réservée au compte direction.",
      403,
    );
  }
  return user;
}

export async function GET() {
  try {
    const user = await requireExecutiveAdmin();
    const [config, history, users] = await Promise.all([
      getAutorisationsConfig(),
      listAutorisationsHistory(30),
      listUsers(),
    ]);

    const roleDefaults: Record<string, string[]> = {};
    for (const role of ROLES_FOR_PERMISSIONS) {
      roleDefaults[role] = roleNavUnscoped(
        role,
        role === "admin" ? user.username : undefined,
      );
    }

    const matrix = PERMISSION_RESOURCES.map((resource) => {
      const byRole: Record<
        string,
        Record<string, { value: string; source: string }>
      > = {};
      for (const role of ROLES_FOR_PERMISSIONS) {
        const defaults = roleNavUnscoped(
          role as UserRole,
          role === "admin" ? user.username : undefined,
        );
        const defaultAllowed = resource.navKey
          ? defaults.includes(resource.navKey)
          : false;
        byRole[role] = {};
        for (const action of resource.actions) {
          byRole[role][action] = resolveActionDecision({
            config,
            role: role as UserRole,
            resourceId: resource.id,
            action,
            defaultAllowed,
          });
        }
      }
      return { resource, byRole };
    });

    return NextResponse.json({
      config,
      history,
      resources: PERMISSION_RESOURCES,
      roles: ROLES_FOR_PERMISSIONS.map((r) => ({
        id: r,
        label: ROLE_LABELS[r],
      })),
      users: users.map((u) => ({
        id: u.id,
        username: u.username,
        name: u.name,
        role: u.role,
        site: u.site,
        active: u.active !== false,
      })),
      roleDefaults,
      matrix,
      actor: {
        id: user.id,
        username: user.username,
        name: user.name,
      },
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const user = await requireExecutiveAdmin();
    const body = (await request.json()) as {
      overrides?: PermissionOverride[];
      confirmSensitive?: boolean;
      summary?: string;
    };

    const overridesRaw = Array.isArray(body.overrides) ? body.overrides : [];
    const overrides: PermissionOverride[] = [];
    for (const raw of overridesRaw) {
      if (!raw || typeof raw !== "object") continue;
      if (raw.targetType !== "role" && raw.targetType !== "user") continue;
      if (typeof raw.targetId !== "string" || typeof raw.resourceId !== "string") {
        continue;
      }
      const actions: PermissionOverride["actions"] = {};
      for (const [k, v] of Object.entries(raw.actions ?? {})) {
        if (isPermissionAction(k) && isPermissionValue(v) && v !== "inherit") {
          actions[k] = v;
        }
      }
      if (Object.keys(actions).length === 0) continue;
      overrides.push({
        targetType: raw.targetType,
        targetId: raw.targetId,
        resourceId: raw.resourceId,
        actions,
      });
    }

    const sensitiveDeny = overrides.some((o) => {
      const res = PERMISSION_RESOURCES.find((r) => r.id === o.resourceId);
      return res?.sensitive && o.actions.access === "deny";
    });
    if (sensitiveDeny && body.confirmSensitive !== true) {
      return NextResponse.json(
        {
          error:
            "Confirmation requise pour refuser un accès sensible (confirmSensitive: true).",
          requiresConfirm: true,
        },
        { status: 400 },
      );
    }

    const saved = await saveAutorisationsConfig({
      overrides,
      actor: user,
      summary: body.summary,
    });
    const revoked = await bumpAllSessionTokenVersions();

    await logActivity({
      user,
      kind: "user",
      title: "Autorisations mises à jour",
      detail: `v${saved.version} · ${saved.overrides.length} règle(s) · ${revoked} session(s) à renouveler`,
      site: "tous",
    });

    return NextResponse.json({
      config: saved,
      sessionsRevoked: revoked,
      message:
        "Modifications enregistrées. Chaque compte devra se reconnecter pour appliquer le nouveau menu.",
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
