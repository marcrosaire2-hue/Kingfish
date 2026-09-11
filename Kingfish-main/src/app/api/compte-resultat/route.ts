import { NextResponse } from "next/server";
import { authErrorResponse, requireAdmin } from "@/lib/api-auth";
import { resolveRequiredSiteScope } from "@/lib/auth-types";
import {
  getCompteResultatDay,
  getCompteResultatMonth,
  getCompteResultatYear,
} from "@/lib/compte-resultat-repo";
import { parseYearMonth } from "@/lib/synthese-calc";
import { todayIsoDate } from "@/lib/zogbo-calc";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await requireAdmin();
    const { searchParams } = new URL(request.url);
    const scope = resolveRequiredSiteScope(user, searchParams.get("site"));
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status });
    }
    const scopeSite = scope.site;
    const view = searchParams.get("view") || "day";

    if (view === "day") {
      const date = searchParams.get("date") || todayIsoDate();
      const payload = await getCompteResultatDay(date, scopeSite);
      return NextResponse.json({ ...payload, scopeSite });
    }

    if (view === "month") {
      const month = searchParams.get("month");
      if (!month) {
        return NextResponse.json({ error: "month requis (YYYY-MM)." }, { status: 400 });
      }
      const { year, month: m } = parseYearMonth(month);
      const payload = await getCompteResultatMonth(year, m, scopeSite);
      return NextResponse.json({ ...payload, scopeSite });
    }

    if (view === "year") {
      const yearRaw = searchParams.get("year") || String(new Date().getFullYear());
      const year = Number(yearRaw);
      if (!Number.isFinite(year) || year < 2000) {
        return NextResponse.json({ error: "year invalide." }, { status: 400 });
      }
      const payload = await getCompteResultatYear(year, scopeSite);
      return NextResponse.json({ ...payload, scopeSite });
    }

    return NextResponse.json({ error: "view invalide." }, { status: 400 });
  } catch (error) {
    return authErrorResponse(error);
  }
}
