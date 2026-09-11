import { NextResponse } from "next/server";
import { authErrorResponse, requireUser } from "@/lib/api-auth";
import { ROLE_LABELS, type UserRole } from "@/lib/auth-types";
import { logActivity } from "@/lib/log-activity";
import {
  getSiteRolesConfig,
  saveSiteRolesConfig,
} from "@/lib/site-roles-repo";
import {
  USER_ROLES,
  type VentePolicyPermissions,
} from "@/lib/site-roles-model";
import type { VenteSite } from "@/lib/types";

export const runtime = "nodejs";

function canEditSiteRoles(role: string): boolean {
  return role === "admin" || role === "gerant";
}

function parsePermissions(raw: unknown): Partial<VentePolicyPermissions> | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const out: Partial<VentePolicyPermissions> = {};
  if (typeof o.sell === "boolean") out.sell = o.sell;
  if (typeof o.modify === "boolean") out.modify = o.modify;
  if (typeof o.delete === "boolean") out.delete = o.delete;
  if (typeof o.cancel === "boolean") out.cancel = o.cancel;
  return Object.keys(out).length ? out : null;
}

function parseSiteMap(raw: unknown): Partial<Record<VenteSite, Partial<VentePolicyPermissions>>> | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const out: Partial<Record<VenteSite, Partial<VentePolicyPermissions>>> = {};
  for (const site of ["zogbo", "gbegamey"] as VenteSite[]) {
    const perms = parsePermissions(o[site]);
    if (perms) out[site] = perms;
  }
  return Object.keys(out).length ? out : null;
}

function parseRoleMap(raw: unknown): Partial<Record<UserRole, Partial<VentePolicyPermissions>>> | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const out: Partial<Record<UserRole, Partial<VentePolicyPermissions>>> = {};
  for (const role of USER_ROLES) {
    const perms = parsePermissions(o[role]);
    if (perms) out[role] = perms;
  }
  return Object.keys(out).length ? out : null;
}

function summarizePerms(p: VentePolicyPermissions): string {
  return `encaissement ${p.sell ? "oui" : "non"} · modif ${p.modify ? "oui" : "non"} · annul ${p.cancel ? "oui" : "non"} · suppr ${p.delete ? "oui" : "non"}`;
}

export async function GET() {
  try {
    await requireUser();
    const config = await getSiteRolesConfig();
    return NextResponse.json({
      ...config,
      roleLabels: ROLE_LABELS,
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const user = await requireUser();
    if (!canEditSiteRoles(user.role)) {
      return NextResponse.json({ error: "Accès refusé." }, { status: 403 });
    }
    const body = (await request.json()) as {
      sites?: unknown;
      roles?: unknown;
      /** Compatibilité ancien client */
      zogbo?: unknown;
      gbegamey?: unknown;
    };

    let sites = parseSiteMap(body.sites);
    if (!sites && (body.zogbo || body.gbegamey)) {
      sites = {};
      const zogbo = parsePermissions(body.zogbo);
      const gbegamey = parsePermissions(body.gbegamey);
      if (zogbo) sites.zogbo = zogbo;
      if (gbegamey) sites.gbegamey = gbegamey;
    }
    const roles = parseRoleMap(body.roles);

    if (!sites && !roles) {
      return NextResponse.json(
        { error: "Aucune modification valide." },
        { status: 400 },
      );
    }

    const saved = await saveSiteRolesConfig({
      sites: sites ?? undefined,
      roles: roles ?? undefined,
    });

    await logActivity({
      user,
      kind: "pos",
      title: "Politiques ventes enregistrées",
      detail: USER_ROLES.map(
        (role) => `${ROLE_LABELS[role]} · ${summarizePerms(saved.roles[role])}`,
      ).join(" — "),
      site: "tous",
    });

    return NextResponse.json({ ...saved, roleLabels: ROLE_LABELS });
  } catch (error) {
    return authErrorResponse(error);
  }
}
