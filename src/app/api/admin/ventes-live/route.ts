import { NextRequest, NextResponse } from "next/server";
import { authErrorResponse, requireUserManagementAdmin } from "@/lib/api-auth";
import { reportError } from "@/lib/report-error";
import { getVentesLiveBoard } from "@/lib/ventes-live-repo";

export const runtime = "nodejs";

/** Tickets POS récents pour notification live admin. */
export async function GET(request: NextRequest) {
  try {
    const admin = await requireUserManagementAdmin();
    const since = request.nextUrl.searchParams.get("since");
    const board = await getVentesLiveBoard(admin, { since });
    return NextResponse.json(board);
  } catch (error) {
    reportError("GET /api/admin/ventes-live", error);
    return authErrorResponse(error);
  }
}
