import { NextResponse } from "next/server";
import type { BoissonsLine } from "@/lib/types";
import { authErrorResponse, requireUser } from "@/lib/api-auth";
import { logActivity } from "@/lib/log-activity";
import {
  applyBoissonsPurchase,
  cancelBoissonsMovement,
  getBoissonsDayPayload,
  saveBoissonsDay,
} from "@/lib/boissons-repo";
import { listVentesByKind } from "@/lib/vente-repo";
import { todayIsoDate } from "@/lib/zogbo-calc";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireUser();
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date") || todayIsoDate();
    const site = (searchParams.get("site") || "all") as
      | "zogbo"
      | "gbegamey"
      | "all";
    const payload = await getBoissonsDayPayload(date);
    const exits = await listVentesByKind({
      date,
      kind: "boisson",
      site,
      limit: 80,
    });
    return NextResponse.json({ ...payload, exits });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const user = await requireUser();
    const body = (await request.json()) as {
      date?: string;
      status?: "ouverte" | "cloturee";
      lines?: BoissonsLine[];
      site?: "zogbo" | "gbegamey";
    };
    if (!body.date || !Array.isArray(body.lines)) {
      return NextResponse.json(
        { error: "Payload invalide (date + lines requis)." },
        { status: 400 },
      );
    }
    const saved = await saveBoissonsDay({
      date: body.date,
      status: body.status,
      lines: body.lines,
    });
    await logActivity({
      user,
      kind: "boissons",
      title: `Boissons · ${body.date}`,
      detail: `notes / compté enregistrés`,
      date: body.date,
      site: body.site ?? null,
    });
    return NextResponse.json(saved);
  } catch (error) {
    return authErrorResponse(error);
  }
}

/** Entrée stock (achat) ou annulation — registre traçable */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = (await request.json()) as {
      action?: "cancel";
      date?: string;
      productId?: string;
      movementId?: string;
      qty?: number;
      site?: "zogbo" | "gbegamey";
    };

    if (body.action === "cancel") {
      if (!body.date || !body.movementId) {
        return NextResponse.json(
          { error: "date et movementId requis pour annuler." },
          { status: 400 },
        );
      }
      const cancelled = await cancelBoissonsMovement({
        date: body.date,
        movementId: body.movementId,
      });
      const m = cancelled.movement;
      await logActivity({
        user,
        kind: "boissons",
        title: `Annulation achat · ${m.name}`,
        detail: `−${m.qty} · entrée annulée`,
        date: body.date,
        site: body.site ?? null,
      });
      const exits = await listVentesByKind({
        date: body.date,
        kind: "boisson",
        site: body.site ?? "all",
      });
      return NextResponse.json({ ...cancelled, exits });
    }

    if (!body.date || !body.productId || body.qty === undefined) {
      return NextResponse.json(
        { error: "date, productId et qty requis." },
        { status: 400 },
      );
    }

    const result = await applyBoissonsPurchase({
      date: body.date,
      productId: body.productId,
      qty: body.qty,
    });
    const m = result.movement;
    await logActivity({
      user,
      kind: "boissons",
      title: `Achat · ${m.name}`,
      detail: `+${m.qty} · dispo ${m.stockAfter}`,
      date: body.date,
      site: body.site ?? null,
    });
    const exits = await listVentesByKind({
      date: body.date,
      kind: "boisson",
      site: body.site ?? "all",
    });
    return NextResponse.json({ ...result, exits });
  } catch (error) {
    console.error("POST /api/boissons", error);
    const message =
      error instanceof Error ? error.message : "Impossible d’enregistrer.";
    const status =
      message.includes("insuffisant") ||
      message.includes("invalide") ||
      message.includes("négatif") ||
      message.includes("introuvable") ||
      message.includes("déjà annulé")
        ? 400
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
