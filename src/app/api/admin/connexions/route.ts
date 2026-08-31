import { NextResponse } from "next/server";
import { authErrorResponse, requireUserManagementAdmin } from "@/lib/api-auth";
import { getConnexionsBoard } from "@/lib/connexions-repo";
import { reportError } from "@/lib/report-error";

export const runtime = "nodejs";

/** Présence live + journal des connexions (admin uniquement). */
export async function GET() {
  try {
    await requireUserManagementAdmin();
    const board = await getConnexionsBoard();
    return NextResponse.json(board);
  } catch (error) {
    reportError("GET /api/admin/connexions", error);
    return authErrorResponse(error);
  }
}
