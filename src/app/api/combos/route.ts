import { NextResponse } from "next/server";
import { reportError } from "@/lib/report-error";
import type { CombosLine, CombosMovementType } from "@/lib/types";
import { authErrorResponse, requireUser } from "@/lib/api-auth";
import { logActivity } from "@/lib/log-activity";
import {
  applyCombosMovement,
  cancelCombosMovement,
  getCombosDayPayload,
  saveCombosDay,
} from "@/lib/combos-repo";
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
    const payload = await getCombosDayPayload(date);
    const exits = await listVentesByKind({
      date,
      kind: "combo",
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
      lines?: CombosLine[];
      site?: "zogbo" | "gbegamey";
    };
    if (!body.date || !Array.isArray(body.lines)) {
      return NextResponse.json(
        { error: "Payload invalide (date + lines requis)." },
        { status: 400 },
      );
    }
    const saved = await saveCombosDay({
      date: body.date,
      status: body.status,
      lines: body.lines,
    });
    await logActivity({
      user,
      kind: "combos",
      title: `Combos · ${body.date}`,
      detail: `notes / compté enregistrés`,
      date: body.date,
      site: body.site ?? null,
    });
    return NextResponse.json(saved);
  } catch (error) {
    return authErrorResponse(error);
  }
}

/** Préparé / envoi Zogbo → Gbégamey, ou annulation */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = (await request.json()) as {
      action?: "cancel";
      date?: string;
      productId?: string;
      movementId?: string;
      type?: CombosMovementType;
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
      const cancelled = await cancelCombosMovement({
        date: body.date,
        movementId: body.movementId,
      });
      const m = cancelled.movement;
      await logActivity({
        user,
        kind: "combos",
        title: `Annulation combo · ${m.name}`,
        detail: `${m.type === "prepare" ? "Préparé" : "Envoi"} −${m.qty}`,
        date: body.date,
        site: "zogbo",
      });
      const exits = await listVentesByKind({
        date: body.date,
        kind: "combo",
        site: body.site ?? "all",
      });
      return NextResponse.json({ ...cancelled, exits });
    }

    if (
      !body.date ||
      !body.productId ||
      !body.type ||
      body.qty === undefined
    ) {
      return NextResponse.json(
        { error: "date, productId, type et qty requis." },
        { status: 400 },
      );
    }
    if (body.type !== "prepare" && body.type !== "send") {
      return NextResponse.json({ error: "type invalide." }, { status: 400 });
    }

    const result = await applyCombosMovement({
      date: body.date,
      productId: body.productId,
      type: body.type,
      qty: body.qty,
    });
    const m = result.movement;
    await logActivity({
      user,
      kind: "combos",
      title:
        m.type === "prepare"
          ? `Combo préparé · ${m.name}`
          : `Combo envoyé · ${m.name}`,
      detail: `+${m.qty} · dispo Zogbo ${m.stockAfter}`,
      date: body.date,
      site: "zogbo",
    });
    const exits = await listVentesByKind({
      date: body.date,
      kind: "combo",
      site: body.site ?? "all",
    });
    return NextResponse.json({ ...result, exits });
  } catch (error) {
    reportError("POST /api/combos", error);
    const message =
      error instanceof Error ? error.message : "Impossible d’enregistrer.";
    const status =
      message.includes("insuffisant") ||
      message.includes("invalide") ||
      message.includes("introuvable") ||
      message.includes("déjà annulé") ||
      message.includes("Annulation")
        ? 400
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
