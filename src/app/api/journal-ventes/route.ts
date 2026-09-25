import { NextResponse } from "next/server";
import { authErrorResponse, requireUser } from "@/lib/api-auth";
import { canManagePastVentesSales } from "@/lib/auth-types";
import { resolveVentesHistorySite } from "@/lib/security-policy";
import {
  listJournalVentes,
  type VenteHistorySource,
  type VenteHistoryStatut,
} from "@/lib/ventes-history-repo";
import { getSiteRolesConfig } from "@/lib/site-roles-repo";
import {
  permissionsForRole,
  ventePermissionsFor,
} from "@/lib/site-roles-model";
import type { VenteSite } from "@/lib/types";
import { todayIsoDate } from "@/lib/zogbo-calc";
import { getParametres } from "@/lib/parametres-repo";

export const runtime = "nodejs";

function monthStart(d = todayIsoDate()) {
  return `${d.slice(0, 7)}-01`;
}

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const from = searchParams.get("from") || monthStart();
    const to = searchParams.get("to") || todayIsoDate();
    const siteDecision = resolveVentesHistorySite(
      user.site,
      searchParams.get("site"),
    );
    if (!siteDecision.ok) {
      return NextResponse.json(
        { error: siteDecision.error },
        { status: siteDecision.status },
      );
    }

    const statut = (searchParams.get("statut") || "all") as VenteHistoryStatut;
    const source = (searchParams.get("source") ||
      "all") as VenteHistorySource;
    const serveur = searchParams.get("serveur") || "";
    const paiement = searchParams.get("paiement") || "";
    const q = searchParams.get("q") || "";

    const [result, siteRoles, parametres] = await Promise.all([
      listJournalVentes({
        from,
        to,
        site: siteDecision.site,
        statut,
        source,
        serveur,
        paiement,
        q,
      }),
      getSiteRolesConfig(),
      user.role === "admin" ? getParametres() : Promise.resolve(null),
    ]);

    const rolePerms = permissionsForRole(siteRoles, user.role);
    const scopedSite =
      siteDecision.site !== "all" ? (siteDecision.site as VenteSite) : null;
    const ventePerms = scopedSite
      ? ventePermissionsFor(siteRoles, user.role, scopedSite)
      : rolePerms;

    return NextResponse.json({
      ...result,
      site: siteDecision.site,
      lockedSite: siteDecision.lockedSite,
      allowedSites: siteDecision.allowedSites,
      canManagePast: canManagePastVentesSales(user.role) && rolePerms.modify,
      canPurge: rolePerms.delete,
      canEditFull: user.role === "admin",
      sitePolicies: siteRoles,
      ventePermissions: ventePerms,
      catalog: parametres
        ? {
            plat: parametres.baseDishes.map((d) => ({ id: d.id, name: d.name })),
            local: parametres.localDishes.map((d) => ({ id: d.id, name: d.name })),
            boisson: parametres.drinks.map((d) => ({ id: d.id, name: d.name })),
          }
        : null,
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
