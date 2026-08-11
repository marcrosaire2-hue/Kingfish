import { NextResponse } from "next/server";
import type { ZogboLine, ZogboMovementType } from "@/lib/types";
import { AuthError, authErrorResponse, requireUser } from "@/lib/api-auth";
import { canUseSite } from "@/lib/auth-types";
import { logActivity } from "@/lib/log-activity";
import {
  applyZogboMovement,
  cancelZogboMovement,
  getZogboDayPayload,
  listZogboDays,
  saveZogboDay,
} from "@/lib/zogbo-repo";
import { todayIsoDate } from "@/lib/zogbo-calc";

export const runtime = "nodejs";

function formatTimeForLog(iso: string): string {
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "short",
      timeStyle: "medium",
      timeZone: "Africa/Porto-Novo",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

async function requireZogboAccess() {
  const user = await requireUser();
  if (!canUseSite(user.site, "zogbo")) {
    throw new AuthError("Accès Zogbo non autorisé pour ce compte.", 403);
  }
  return user;
}

export async function GET(request: Request) {
  try {
    await requireZogboAccess();
    const { searchParams } = new URL(request.url);
    if (searchParams.get("list") === "1") {
      const days = await listZogboDays();
      return NextResponse.json({ days });
    }
    const date = searchParams.get("date") || todayIsoDate();
    const payload = await getZogboDayPayload(date);
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof AuthError) return authErrorResponse(error);
    console.error("GET /api/zogbo", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Impossible de charger Zogbo.",
      },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const user = await requireZogboAccess();
    const body = (await request.json()) as {
      date?: string;
      status?: "ouverte" | "cloturee";
      lines?: ZogboLine[];
    };

    if (!body.date || !Array.isArray(body.lines)) {
      return NextResponse.json(
        { error: "Payload invalide (date + lines requis)." },
        { status: 400 },
      );
    }

    const saved = await saveZogboDay({
      date: body.date,
      status: body.status,
      lines: body.lines,
    });
    await logActivity({
      user,
      kind: "zogbo",
      title: `Point Zogbo enregistré · ${body.date}`,
      detail: `${saved.day.lines.length} plats · stock total ${saved.day.lines.reduce((s, l) => s + l.stock, 0)}`,
      date: body.date,
      site: "zogbo",
    });
    return NextResponse.json(saved);
  } catch (error) {
    if (error instanceof AuthError) return authErrorResponse(error);
    console.error("PUT /api/zogbo", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Impossible d’enregistrer Zogbo.",
      },
      { status: 500 },
    );
  }
}

/** Ajoute un mouvement (préparé / envoi) — met à jour le stock et le registre */
export async function POST(request: Request) {
  try {
    const user = await requireZogboAccess();
    const body = (await request.json()) as {
      action?: "cancel";
      date?: string;
      productId?: string;
      movementId?: string;
      type?: ZogboMovementType;
      qty?: number;
    };

    if (body.action === "cancel") {
      if (!body.date || !body.movementId) {
        return NextResponse.json(
          { error: "date et movementId requis pour annuler." },
          { status: 400 },
        );
      }
      const cancelled = await cancelZogboMovement({
        date: body.date,
        movementId: body.movementId,
      });
      const m = cancelled.movement;
      await logActivity({
        user,
        kind: m.type === "send" ? "transfert" : "zogbo",
        title: `Annulation ${m.type === "send" ? "envoi" : "préparation"} · ${m.name}`,
        detail: `${m.qty} annulé(s) · mouvement du ${formatTimeForLog(m.at)}`,
        date: body.date,
        site: "zogbo",
      });
      return NextResponse.json(cancelled);
    }

    if (
      !body.date ||
      !body.productId ||
      (body.type !== "prepare" && body.type !== "send") ||
      body.qty === undefined
    ) {
      return NextResponse.json(
        { error: "date, productId, type (prepare|send) et qty requis." },
        { status: 400 },
      );
    }

    const result = await applyZogboMovement({
      date: body.date,
      productId: body.productId,
      type: body.type,
      qty: body.qty,
    });
    const m = result.movement;
    if (m.type === "send") {
      await logActivity({
        user,
        kind: "transfert",
        title: `Envoi → Gbégamey · ${m.name}`,
        detail: `−${m.qty} · stock reste ${m.stockAfter}`,
        date: body.date,
        site: "zogbo",
      });
    } else {
      await logActivity({
        user,
        kind: "zogbo",
        title: `Préparé · ${m.name}`,
        detail: `+${m.qty} · stock ${m.stockAfter}`,
        date: body.date,
        site: "zogbo",
      });
    }

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AuthError) return authErrorResponse(error);
    console.error("POST /api/zogbo", error);
    const message =
      error instanceof Error ? error.message : "Impossible d’enregistrer.";
    const status =
      message.includes("insuffisant") ||
      message.includes("invalide") ||
      message.includes("impossible") ||
      message.includes("introuvable") ||
      message.includes("déjà annulé") ||
      message.includes("en même temps")
        ? 400
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
