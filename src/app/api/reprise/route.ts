import { NextResponse } from "next/server";
import { authErrorResponse, requireAdmin } from "@/lib/api-auth";
import { logActivity } from "@/lib/log-activity";
import {
  getRepriseDayPayload,
  saveRepriseDay,
  type RepriseSaveInput,
} from "@/lib/reprise-repo";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date");
    if (!date) {
      return NextResponse.json({ error: "Date requise." }, { status: 400 });
    }
    return NextResponse.json(await getRepriseDayPayload(date));
  } catch (error) {
    if (error instanceof Error && error.message.includes("invalide")) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return authErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const user = await requireAdmin();
    const body = (await request.json()) as Partial<RepriseSaveInput>;

    if (
      !body.date ||
      !Array.isArray(body.zogbo) ||
      !Array.isArray(body.gbegameyTransfer) ||
      !Array.isArray(body.gbegameyLocal) ||
      !Array.isArray(body.boissons) ||
      !Array.isArray(body.combos)
    ) {
      return NextResponse.json({ error: "Payload invalide." }, { status: 400 });
    }

    const result = await saveRepriseDay({
      date: body.date,
      zogbo: body.zogbo,
      gbegameyTransfer: body.gbegameyTransfer,
      gbegameyLocal: body.gbegameyLocal,
      boissons: body.boissons,
      combos: body.combos,
      genererVentes: body.genererVentes !== false,
      utiliserJournalDetaille: body.utiliserJournalDetaille !== false,
      ventesZogbo: body.ventesZogbo,
      cloturer: body.cloturer === true,
    });

    await logActivity({
      user,
      kind: "reprise",
      title: `Reprise d’historique · ${result.date}`,
      detail:
        `${result.ventesGenerees} vente(s) enregistrée(s)` +
        (result.ventesSupprimees
          ? ` (${result.ventesSupprimees} ligne(s) reprise précédente(s) mise(s) à jour)`
          : ""),
      date: result.date,
      site: "zogbo",
      amount: result.caZogbo + result.caGbegamey,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("invalide") || error.message.includes("passées"))
    ) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return authErrorResponse(error);
  }
}
