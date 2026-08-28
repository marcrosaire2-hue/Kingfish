import { NextResponse } from "next/server";
import { authErrorResponse, requireUser } from "@/lib/api-auth";
import { isValidDate } from "@/lib/day-doc";
import { buildRegularisationReport } from "@/lib/regularisation-repo";
import { authorizeRequestedSite } from "@/lib/security-policy";
import type { VenteSite } from "@/lib/types";
import { todayIsoDate } from "@/lib/zogbo-calc";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date") || todayIsoDate();
    const siteDecision = authorizeRequestedSite(
      user.site,
      searchParams.get("site"),
    );
    if (!siteDecision.ok) {
      return NextResponse.json(
        { error: siteDecision.error },
        { status: siteDecision.status },
      );
    }
    if (!isValidDate(date)) {
      return NextResponse.json({ error: "Date invalide." }, { status: 400 });
    }

    const report = await buildRegularisationReport(
      date,
      siteDecision.site as VenteSite,
    );

    return NextResponse.json({
      ...report,
      lockedSite: user.site !== "tous",
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
