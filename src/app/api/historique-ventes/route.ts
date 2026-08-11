import { NextResponse } from "next/server";
import { authErrorResponse, requireUser } from "@/lib/api-auth";
import { canUseSite } from "@/lib/auth-types";
import {
  listVentesHistory,
  type VenteHistorySource,
  type VenteHistoryStatut,
} from "@/lib/ventes-history-repo";
import type { VenteSite } from "@/lib/types";
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
    const siteRaw = (searchParams.get("site") || "all") as "all" | VenteSite;
    const statut = (searchParams.get("statut") || "all") as VenteHistoryStatut;
    const source = (searchParams.get("source") ||
      "all") as VenteHistorySource;
    const serveur = searchParams.get("serveur") || "";
    const paiement = searchParams.get("paiement") || "";
    const q = searchParams.get("q") || "";
    const limit = Number(searchParams.get("limit") || "200");

    if (siteRaw !== "all" && siteRaw !== "zogbo" && siteRaw !== "gbegamey") {
      return NextResponse.json({ error: "Site invalide." }, { status: 400 });
    }
    if (
      siteRaw !== "all" &&
      !canUseSite(user.site, siteRaw)
    ) {
      return NextResponse.json({ error: "Site non autorisé." }, { status: 403 });
    }

    let site: "all" | VenteSite = siteRaw;
    if (user.site !== "tous") {
      site = user.site;
    }

    const result = await listVentesHistory({
      from,
      to,
      site,
      statut,
      source,
      serveur,
      paiement,
      q,
      limit: Number.isFinite(limit) ? limit : 200,
    });

    return NextResponse.json({
      ...result,
      site,
      lockedSite: user.site !== "tous",
      allowedSites:
        user.site === "tous"
          ? (["zogbo", "gbegamey"] as const)
          : ([user.site] as const),
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
