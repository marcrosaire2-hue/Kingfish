import { NextResponse } from "next/server";
import { reportError } from "@/lib/report-error";
import type { GbegameyLocalLine, GbegameyTransferLine } from "@/lib/types";
import { AuthError, authErrorResponse, requireUser } from "@/lib/api-auth";
import { canUseSite } from "@/lib/auth-types";
import { logActivity } from "@/lib/log-activity";
import {
  getGbegameyDayPayload,
  saveGbegameyDay,
} from "@/lib/gbegamey-repo";
import {
  listVentesForSite,
  summarizeVentesForSite,
  sumCaForSite,
} from "@/lib/vente-repo";
import { todayIsoDate } from "@/lib/zogbo-calc";

export const runtime = "nodejs";

async function requireGbegameyAccess() {
  const user = await requireUser();
  if (!canUseSite(user.site, "gbegamey")) {
    throw new AuthError("Accès Gbégamey non autorisé pour ce compte.", 403);
  }
  return user;
}

export async function GET(request: Request) {
  try {
    await requireGbegameyAccess();
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date") || todayIsoDate();
    const [payload, caJournal, ventes, ventesSummary] = await Promise.all([
      getGbegameyDayPayload(date),
      sumCaForSite(date, "gbegamey"),
      listVentesForSite({ date, site: "gbegamey" }),
      summarizeVentesForSite(date, "gbegamey"),
    ]);
    return NextResponse.json({ ...payload, caJournal, ventes, ventesSummary });
  } catch (error) {
    if (error instanceof AuthError) return authErrorResponse(error);
    reportError("GET /api/gbegamey", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Impossible de charger Gbégamey.",
      },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const user = await requireGbegameyAccess();
    const body = (await request.json()) as {
      date?: string;
      status?: "ouverte" | "cloturee";
      transferLines?: GbegameyTransferLine[];
      localLines?: GbegameyLocalLine[];
    };

    if (
      !body.date ||
      !Array.isArray(body.transferLines) ||
      !Array.isArray(body.localLines)
    ) {
      return NextResponse.json(
        {
          error:
            "Payload invalide (date + transferLines + localLines requis).",
        },
        { status: 400 },
      );
    }

    const saved = await saveGbegameyDay({
      date: body.date,
      status: body.status,
      transferLines: body.transferLines,
      localLines: body.localLines,
    });
    const transferSold = body.transferLines.reduce(
      (s, l) => s + (l.sold || 0),
      0,
    );
    const localSold = body.localLines.reduce((s, l) => s + (l.sold || 0), 0);
    await logActivity({
      user,
      kind: "gbegamey",
      title: `Inventaire plats Gbégamey · ${body.date}`,
      detail: `plats vendu ${transferSold} · acc. vendu ${localSold}`,
      date: body.date,
      site: "gbegamey",
    });
    return NextResponse.json(saved);
  } catch (error) {
    if (error instanceof AuthError) return authErrorResponse(error);
    reportError("PUT /api/gbegamey", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Impossible d’enregistrer Gbégamey.",
      },
      { status: 500 },
    );
  }
}
