import { NextResponse } from "next/server";
import { authErrorResponse, requireUser } from "@/lib/api-auth";
import { canAccessPath } from "@/lib/auth-types";
import { buildRapportQuotidien } from "@/lib/rapport-quotidien-repo";
import type { VenteSite } from "@/lib/types";
import { todayIsoDate } from "@/lib/zogbo-calc";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    if (
      !canAccessPath(
        user.role,
        "/rapport-quotidien",
        user.site,
        user.username,
        user.nav,
      )
    ) {
      return NextResponse.json({ error: "Accès refusé." }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date") || todayIsoDate();
    const siteParam = searchParams.get("site") || "all";
    const siteFilter =
      siteParam === "zogbo" || siteParam === "gbegamey"
        ? (siteParam as VenteSite)
        : "all";

    const rapport = await buildRapportQuotidien({
      date,
      userSite: user.site,
      siteFilter,
    });
    return NextResponse.json(rapport);
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return authErrorResponse(error);
  }
}
