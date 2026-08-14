import { NextResponse } from "next/server";
import { authErrorResponse, requireAdmin } from "@/lib/api-auth";
import {
  buildJournalBalance,
  buildJournalTotals,
  listJournalRows,
  type JournalStockInput,
  type JournalType,
} from "@/lib/journal-stock-repo";

export const runtime = "nodejs";

const TYPES: JournalType[] = ["vente", "achat", "perte", "reception"];

function isValidDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

/**
 * Journal des mouvements de stock. Tous les paramètres sont optionnels :
 * sans période, c'est toute l'histoire du début à aujourd'hui.
 */
export async function GET(request: Request) {
  try {
    await requireAdmin();
    const url = new URL(request.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const siteParam = url.searchParams.get("site") ?? "tous";
    const typeParam = url.searchParams.get("type") ?? "tous";

    if (from && !isValidDate(from)) {
      return NextResponse.json({ error: "Date « depuis » invalide." }, { status: 400 });
    }
    if (to && !isValidDate(to)) {
      return NextResponse.json({ error: "Date « jusqu'à » invalide." }, { status: 400 });
    }
    if (from && to && from > to) {
      return NextResponse.json(
        { error: "La date de début est après la date de fin." },
        { status: 400 },
      );
    }
    if (!["tous", "zogbo", "gbegamey"].includes(siteParam)) {
      return NextResponse.json({ error: "Site invalide." }, { status: 400 });
    }
    if (typeParam !== "tous" && !TYPES.includes(typeParam as JournalType)) {
      return NextResponse.json({ error: "Type de mouvement invalide." }, { status: 400 });
    }

    const input: JournalStockInput = {
      from: from ?? null,
      to: to ?? null,
      site: siteParam as JournalStockInput["site"],
      type: typeParam as JournalStockInput["type"],
    };

    const rows = await listJournalRows(input);
    const totals = buildJournalTotals(rows);
    const balance = buildJournalBalance(rows);

    const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
    const full = url.searchParams.get("full") === "1";
    const limit = full
      ? rows.length
      : Math.min(500, Math.max(1, Number(url.searchParams.get("limit")) || 200));

    return NextResponse.json({
      rows: rows.slice(offset, offset + limit),
      total: rows.length,
      offset,
      limit,
      full,
      balance,
      totals,
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}