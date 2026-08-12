import { NextResponse } from "next/server";
import { authErrorResponse, requireUser } from "@/lib/api-auth";
import { canUseSite } from "@/lib/auth-types";
import type { VenteSite } from "@/lib/types";
import { sumCaByShiftRange } from "@/lib/vente-repo";
import { todayIsoDate } from "@/lib/zogbo-calc";

export const runtime = "nodejs";

function monthStart(d = todayIsoDate()) {
  return `${d.slice(0, 7)}-01`;
}

function isValidDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const from = searchParams.get("from") || monthStart();
    const to = searchParams.get("to") || todayIsoDate();
    const siteRaw = (searchParams.get("site") || "all") as "all" | VenteSite;

    if (siteRaw !== "all" && siteRaw !== "zogbo" && siteRaw !== "gbegamey") {
      return NextResponse.json({ error: "Site invalide." }, { status: 400 });
    }
    if (siteRaw !== "all" && !canUseSite(user.site, siteRaw)) {
      return NextResponse.json({ error: "Site non autorisé." }, { status: 403 });
    }
    if (!isValidDate(from) || !isValidDate(to)) {
      return NextResponse.json(
        { error: "Dates invalides (attendu YYYY-MM-DD)." },
        { status: 400 },
      );
    }
    if (from > to) {
      return NextResponse.json(
        { error: "La date de début doit précéder la fin." },
        { status: 400 },
      );
    }

    let site: "all" | VenteSite = siteRaw;
    if (user.site !== "tous") {
      site = user.site;
    }

    const result = await sumCaByShiftRange(from, to, site);

    return NextResponse.json({
      from,
      to,
      site,
      lockedSite: user.site !== "tous",
      ...result,
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
