import { withReadCache } from "@/lib/read-cache";
import { NextResponse } from "next/server";
import { authErrorResponse, requireUser } from "@/lib/api-auth";
import { canUseSite } from "@/lib/auth-types";
import { getPointVentes } from "@/lib/point-ventes-repo";
import type { VenteSite } from "@/lib/types";
import { todayIsoDate } from "@/lib/zogbo-calc";

export const runtime = "nodejs";

function monthStart(d = todayIsoDate()) {
  return `${d.slice(0, 7)}-01`;
}

export const GET = withReadCache(async function GET(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const from = searchParams.get("from") || monthStart();
    const to = searchParams.get("to") || todayIsoDate();
    const siteRaw = (searchParams.get("site") || "all") as "all" | VenteSite;
    const limite = Number(searchParams.get("limite") || 10);

    if (siteRaw !== "all" && siteRaw !== "zogbo" && siteRaw !== "gbegamey") {
      return NextResponse.json({ error: "Site invalide." }, { status: 400 });
    }
    if (siteRaw !== "all" && !canUseSite(user.site, siteRaw)) {
      return NextResponse.json({ error: "Site non autorisé." }, { status: 403 });
    }
    // Un compte rattaché à un site ne voit que son site.
    const site: "all" | VenteSite = user.site !== "tous" ? user.site : siteRaw;

    const payload = await getPointVentes({ from, to, site, limite });
    return NextResponse.json({ ...payload, lockedSite: user.site !== "tous" });
  } catch (error) {
    return authErrorResponse(error);
  }
});
