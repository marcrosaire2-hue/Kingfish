import { NextResponse } from "next/server";
import { authErrorResponse, requireUserManagementAdmin } from "@/lib/api-auth";
import { listDirectionTickets } from "@/lib/pos-repo";
import { todayIsoDate } from "@/lib/zogbo-calc";

export const runtime = "nodejs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Journal des ventes direction (hors CA clients, sans effet sur le stock) :
 * toutes les ventes de la période, tous statuts, plus celles encore à valider.
 */
export async function GET(request: Request) {
  try {
    await requireUserManagementAdmin();
    const { searchParams } = new URL(request.url);
    const today = todayIsoDate();
    const fromRaw = searchParams.get("from") ?? "";
    const toRaw = searchParams.get("to") ?? "";
    const from = DATE_RE.test(fromRaw) ? fromRaw : `${today.slice(0, 8)}01`;
    const to = DATE_RE.test(toRaw) ? toRaw : today;
    const tickets = await listDirectionTickets({ from, to });
    return NextResponse.json({ from, to, tickets });
  } catch (error) {
    return authErrorResponse(error);
  }
}
