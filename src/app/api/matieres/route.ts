import { NextResponse } from "next/server";
import { authErrorResponse, requireUser } from "@/lib/api-auth";
import { logActivity } from "@/lib/log-activity";
import {
  applyMatieresPurchase,
  cancelMatieresMovement,
  getMatieresDayPayload,
  saveMatieresDay,
} from "@/lib/matieres-repo";
import type { MatieresLine } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireUser();
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date");
    if (!date) {
      return NextResponse.json({ error: "Date requise." }, { status: 400 });
    }
    const payload = await getMatieresDayPayload(date);
    return NextResponse.json(payload);
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
      lines?: MatieresLine[];
    };
    if (!body.date || !Array.isArray(body.lines)) {
      return NextResponse.json({ error: "Payload invalide." }, { status: 400 });
    }
    const payload = await saveMatieresDay({
      date: body.date,
      status: body.status,
      lines: body.lines,
    });
    await logActivity({
      user,
      kind: "matieres",
      title: `Matières · ${body.date}`,
      detail: `${body.lines.length} ligne(s) · ${body.status ?? "ouverte"}`,
      date: body.date,
      site: "zogbo",
    });
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof Error && error.message.includes("invalide")) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = (await request.json()) as {
      action?: string;
      date?: string;
      productId?: string;
      qty?: number;
      unitPrice?: number;
      movementId?: string;
    };

    if (!body.date) {
      return NextResponse.json({ error: "Date requise." }, { status: 400 });
    }

    if (body.action === "cancel") {
      if (!body.movementId) {
        return NextResponse.json(
          { error: "movementId requis." },
          { status: 400 },
        );
      }
      const payload = await cancelMatieresMovement({
        date: body.date,
        movementId: body.movementId,
      });
      await logActivity({
        user,
        kind: "matieres",
        title: "Annulation achat matières",
        detail: `Mouvement ${body.movementId}`,
        date: body.date,
        site: "zogbo",
      });
      return NextResponse.json(payload);
    }

    if (!body.productId || body.qty == null) {
      return NextResponse.json(
        { error: "productId et qty requis." },
        { status: 400 },
      );
    }
    const payload = await applyMatieresPurchase({
      date: body.date,
      productId: body.productId,
      qty: Number(body.qty),
      unitPrice: body.unitPrice,
    });
    await logActivity({
      user,
      kind: "matieres",
      title: "Achat matières",
      detail: `Produit ${body.productId} · +${Number(body.qty)}`,
      date: body.date,
      site: "zogbo",
      amount: body.unitPrice != null ? Number(body.unitPrice) * Number(body.qty) : null,
    });
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return authErrorResponse(error);
  }
}
