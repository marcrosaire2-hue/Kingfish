import { NextResponse } from "next/server";
import { authErrorResponse, requireUser } from "@/lib/api-auth";
import { canUseSite } from "@/lib/auth-types";
import { getQuantitesVendues } from "@/lib/quantites-vendues-repo";
import type { VenteKind, VenteSite } from "@/lib/types";
import { todayIsoDate } from "@/lib/zogbo-calc";

export const runtime = "nodejs";

function monthStart(d = todayIsoDate()) {
  return `${d.slice(0, 7)}-01`;
}

const KINDS: VenteKind[] = ["plat", "local", "boisson", "extra"];

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const from = searchParams.get("from") || monthStart();
    const to = searchParams.get("to") || todayIsoDate();
    const siteRaw = (searchParams.get("site") || "all") as "all" | VenteSite;
    const kindRaw = (searchParams.get("kind") || "all") as "all" | VenteKind;
    const q = searchParams.get("q") || "";

    if (siteRaw !== "all" && siteRaw !== "zogbo" && siteRaw !== "gbegamey") {
      return NextResponse.json({ error: "Site invalide." }, { status: 400 });
    }
    if (siteRaw !== "all" && !canUseSite(user.site, siteRaw)) {
      return NextResponse.json({ error: "Site non autorisé." }, { status: 403 });
    }
    if (kindRaw !== "all" && !KINDS.includes(kindRaw)) {
      return NextResponse.json({ error: "Famille invalide." }, { status: 400 });
    }

    let site: "all" | VenteSite = siteRaw;
    if (user.site !== "tous") {
      site = user.site;
    }

    const payload = await getQuantitesVendues({
      from,
      to,
      site,
      kind: kindRaw,
      q,
    });

    return NextResponse.json({
      ...payload,
      lockedSite: user.site !== "tous",
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
