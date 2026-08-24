import { NextResponse } from "next/server";
import { authErrorResponse, requireUser } from "@/lib/api-auth";
import { todayIsoDate } from "@/lib/zogbo-calc";
import {
  AnalyseError,
  loadAnalyseReport,
  parseAnalyseQuery,
} from "@/lib/analyse-repo";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const query = parseAnalyseQuery(searchParams, todayIsoDate());
    const report = await loadAnalyseReport({
      user,
      period: query.period,
      date: query.date,
      requestedSite: query.requestedSite,
      shift: query.shift,
      kind: query.kind,
    });
    return NextResponse.json({
      report,
      role: user.role,
      lockedSite: user.site !== "tous",
      userSite: user.site,
    });
  } catch (error) {
    if (error instanceof AnalyseError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return authErrorResponse(error);
  }
}
