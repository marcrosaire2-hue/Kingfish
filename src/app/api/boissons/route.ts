import { NextResponse } from "next/server";
import { reportError } from "@/lib/report-error";
import type { BoissonsLine } from "@/lib/types";
import { authErrorResponse, requireUser } from "@/lib/api-auth";
import { canUseSite, effectiveSite } from "@/lib/auth-types";
import { logActivity } from "@/lib/log-activity";
import {
  applyBoissonsPurchase,
  cancelBoissonsMovement,
  getBoissonsDayPayload,
  saveBoissonsDay,
} from "@/lib/boissons-repo";
import { listVentesByKind, sumCaByKindForSite } from "@/lib/vente-repo";
import { todayIsoDate } from "@/lib/zogbo-calc";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date") || todayIsoDate();
    const site = (searchParams.get("site") || "all") as
      | "zogbo"
      | "gbegamey"
      | "all";
    if (
      (site === "zogbo" || site === "gbegamey") &&
      !canUseSite(effectiveSite(user.role, user.site), site)
    ) {
      return NextResponse.json({ error: "Site non autorisé." }, { status: 403 });
    }
    const payload = await getBoissonsDayPayload(date);
    const exits = await listVentesByKind({
      date,
      kind: "boisson",
      site,
      limit: 80,
    });
    const caJournal =
      site === "zogbo" || site === "gbegamey"
        ? await sumCaByKindForSite(date, site, "boisson")
        : 0;
    return NextResponse.json({ ...payload, exits, caJournal });
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
    if (
      !body.date ||
      !Array.isArray(body.lines) ||
      (body.site !== "zogbo" && body.site !== "gbegamey")
    ) {
      return NextResponse.json(
        { error: "Payload invalide (date + lines + site requis)." },
        { status: 400 },
      );
    }
    if (!canUseSite(effectiveSite(user.role, user.site), body.site)) {
      return NextResponse.json({ error: "Site non autorisé." }, { status: 403 });
    }
    const saved = await saveBoissonsDay(
      {
        date: body.date,
        site: body.site,
        status: body.status,
        lines: body.lines,
      },
      { stockSaisie: true },
    );
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
      const scope = effectiveSite(user.role, user.site);
      const cancelled = await cancelBoissonsMovement({
        date: body.date,
        movementId: body.movementId,
        site: scope === "tous" ? null : scope,
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

    if (
      !body.date ||
      !body.productId ||
      body.qty === undefined ||
      (body.site !== "zogbo" && body.site !== "gbegamey")
    ) {
      return NextResponse.json(
        { error: "date, productId, qty et site requis." },
        { status: 400 },
      );
    }
    if (!canUseSite(effectiveSite(user.role, user.site), body.site)) {
      return NextResponse.json({ error: "Site non autorisé." }, { status: 403 });
    }

    const result = await applyBoissonsPurchase({
      date: body.date,
      site: body.site,
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
    reportError("POST /api/boissons", error);
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
