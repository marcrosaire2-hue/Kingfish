import { NextResponse } from "next/server";
import { authErrorResponse, requireUser } from "@/lib/api-auth";
import { canManagePastVentes } from "@/lib/auth-types";
import {
  canPurgeFinancialData,
  resolveVentesHistorySite,
} from "@/lib/security-policy";
import {
  listJournalVentes,
  type VenteHistorySource,
  type VenteHistoryStatut,
} from "@/lib/ventes-history-repo";
import { todayIsoDate } from "@/lib/zogbo-calc";

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

    const result = await listJournalVentes({
      from,
      to,
      site: siteDecision.site,
      statut,
      source,
      serveur,
      paiement,
      q,
    });

    return NextResponse.json({
      ...result,
      site: siteDecision.site,
      lockedSite: siteDecision.lockedSite,
      allowedSites: siteDecision.allowedSites,
      canManagePast: canManagePastVentes(user.role),
      canPurge: canPurgeFinancialData(user.role),
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
