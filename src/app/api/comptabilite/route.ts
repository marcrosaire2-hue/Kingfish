import { NextResponse } from "next/server";
import { authErrorResponse, requireAdmin } from "@/lib/api-auth";
import { resolveRequiredSiteScope } from "@/lib/auth-types";
import { buildBilan } from "@/lib/bilan-repo";
import {
  balanceGenerale,
  grandLivre,
} from "@/lib/journal-comptable-calc";
import { buildJournalComptable } from "@/lib/journal-comptable-repo";
import { todayIsoDate } from "@/lib/zogbo-calc";

export const runtime = "nodejs";

function monthStartIso(d = todayIsoDate()): string {
  return `${d.slice(0, 7)}-01`;
}

export async function GET(request: Request) {
  try {
    const user = await requireAdmin();
    const { searchParams } = new URL(request.url);
    const scope = resolveRequiredSiteScope(user, searchParams.get("site"));
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status });
    }
    const scopeSite = scope.site;
    const view = searchParams.get("view") || "journal";

    if (view === "bilan") {
      const asOf = searchParams.get("asOf") || todayIsoDate();
      const bilan = await buildBilan({ asOf, scopeSite });
      return NextResponse.json({ ...bilan, scopeSite });
    }

    const from = searchParams.get("from") || monthStartIso();
    const to = searchParams.get("to") || todayIsoDate();
    const journal = await buildJournalComptable({ from, to, scopeSite });

    if (view === "grand-livre") {
      return NextResponse.json({
        from,
        to,
        scopeSite,
        comptes: grandLivre(journal.ecritures),
        anomalies: journal.anomalies,
      });
    }

    if (view === "balance") {
      return NextResponse.json({
        from,
        to,
        scopeSite,
        lignes: balanceGenerale(journal.ecritures),
        anomalies: journal.anomalies,
      });
    }

    return NextResponse.json({ ...journal, scopeSite });
  } catch (error) {
    return authErrorResponse(error);
  }
}
