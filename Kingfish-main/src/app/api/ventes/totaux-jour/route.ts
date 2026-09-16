import { NextResponse } from "next/server";
import { AuthError, authErrorResponse, requireUser } from "@/lib/api-auth";
import { effectiveSite } from "@/lib/auth-types";
import { reportError } from "@/lib/report-error";
import { listVentesTrancheTotals } from "@/lib/ventes-history-repo";
import type { VenteSite } from "@/lib/types";
import { todayIsoDate } from "@/lib/zogbo-calc";

export const runtime = "nodejs";

/**
 * Totaux de ventes par jour et par tranche (nuit/matin/soir), sans détail —
 * utilisés sur la page Versements pour comparer le chiffre encaissé aux
 * versements déclarés sur la même période/tranche. Même périmètre de site
 * que /api/versements.
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const from = searchParams.get("from") || todayIsoDate();
    const to = searchParams.get("to") || from;
    const siteFilter = searchParams.get("site");
    const scope = effectiveSite(user.role, user.site);

    let site: VenteSite | "all" = scope === "tous" ? "all" : scope;
    if (
      scope === "tous" &&
      (siteFilter === "zogbo" || siteFilter === "gbegamey")
    ) {
      site = siteFilter;
    }

    const result = await listVentesTrancheTotals({ from, to, site });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AuthError) return authErrorResponse(error);
    reportError("GET /api/ventes/totaux-jour", error);
    return authErrorResponse(error);
  }
}
