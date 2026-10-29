import { NextResponse } from "next/server";
import { authErrorResponse, requireUserManagementAdmin } from "@/lib/api-auth";
import { listDirectionTickets } from "@/lib/pos-repo";
import { todayIsoDate } from "@/lib/zogbo-calc";

export const runtime = "nodejs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Ventes direction (hors CA clients) : file « à valider » sur tous les jours
 * et sites, validées de la période, totaux par site.
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

    const { pending, validated } = await listDirectionTickets({ from, to });

    const totals: Record<string, { count: number; montant: number }> = {
      zogbo: { count: 0, montant: 0 },
      gbegamey: { count: 0, montant: 0 },
    };
    for (const t of validated) {
      const bucket = totals[t.site];
      if (!bucket) continue;
      bucket.count += 1;
      bucket.montant += t.montant;
    }
    return NextResponse.json({
      from,
      to,
      pending,
      validated,
      totals: {
        ...totals,
        all: {
          count: validated.length,
          montant: validated.reduce((s, t) => s + t.montant, 0),
        },
        pending: {
          count: pending.length,
          montant: pending.reduce((s, t) => s + t.montant, 0),
        },
      },
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
