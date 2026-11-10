import { withReadCache } from "@/lib/read-cache";
import { NextResponse } from "next/server";
import { authErrorResponse, requireUser } from "@/lib/api-auth";
import { canUseSite } from "@/lib/auth-types";
import { getJournalStockJours, type JournalFamille } from "@/lib/journal-stock-jours";
import type { VenteSite } from "@/lib/types";
import { shiftIsoDate, todayIsoDate } from "@/lib/zogbo-calc";

export const runtime = "nodejs";

const FAMILLES = ["toutes", "plat", "local", "boisson"] as const;

export const GET = withReadCache(async function GET(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const to = searchParams.get("to") || todayIsoDate();
    const from = searchParams.get("from") || shiftIsoDate(to, -6) || to;
    const famille = (searchParams.get("famille") || "toutes") as "toutes" | JournalFamille;
    if (!FAMILLES.includes(famille)) {
      return NextResponse.json({ error: "Famille invalide." }, { status: 400 });
    }
    // Un compte rattaché à un site ne voit que son site.
    const demande = (searchParams.get("site") || "gbegamey") as VenteSite;
    const site: VenteSite = user.site !== "tous" ? user.site : demande;
    if (site !== "zogbo" && site !== "gbegamey") {
      return NextResponse.json({ error: "Site invalide." }, { status: 400 });
    }
    if (!canUseSite(user.site, site)) {
      return NextResponse.json({ error: "Site non autorisé." }, { status: 403 });
    }
    const rows = await getJournalStockJours({ site, from, to, famille });
    return NextResponse.json({ site, from, to, famille, rows, lockedSite: user.site !== "tous" });
  } catch (error) {
    return authErrorResponse(error);
  }
});
