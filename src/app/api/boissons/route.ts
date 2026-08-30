import { NextResponse } from "next/server";
import { reportError } from "@/lib/report-error";
import type { BoissonsLine } from "@/lib/types";
import { authErrorResponse, requireStockWrite, requireUser } from "@/lib/api-auth";
import { canUseSite, effectiveSite } from "@/lib/auth-types";
import { logActivity } from "@/lib/log-activity";
import { unitsPerCasierOf } from "@/lib/boissons-calc";
import {
  applyBoissonsPurchase,
  cancelBoissonsMovement,
  getBoissonsDayPayload,
  saveBoissonsDay,
} from "@/lib/boissons-repo";
import {
  countQrGeneratedByProduct,
  generatePlatQrUnits,
  voidPrepareUnitsByMovement,
} from "@/lib/stock-unit-repo";
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
    const qrGeneratedByProduct =
      site === "zogbo" || site === "gbegamey"
        ? await countQrGeneratedByProduct(date, site, "boisson")
        : {};
    return NextResponse.json({
      ...payload,
      exits,
      caJournal,
      qrGeneratedByProduct,
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const user = await requireUser();
    requireStockWrite(user);
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
    requireStockWrite(user);
    const body = (await request.json()) as {
      action?: "cancel";
      date?: string;
      productId?: string;
      movementId?: string;
      qty?: number;
      qtyBottles?: number;
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
      const voidedQr = await voidPrepareUnitsByMovement(body.movementId);
      const m = cancelled.movement;
      await logActivity({
        user,
        kind: "boissons",
        title: `Annulation achat · ${m.name}`,
        detail: `−${m.qty} · ${voidedQr} QR annulé(s)`,
        date: body.date,
        site: body.site ?? m.site,
      });
      const exits = await listVentesByKind({
        date: body.date,
        kind: "boisson",
        site: body.site ?? "all",
      });
      const qrSite = body.site ?? m.site;
      const qrGeneratedByProduct = await countQrGeneratedByProduct(
        body.date,
        qrSite,
        "boisson",
      );
      return NextResponse.json({
        ...cancelled,
        exits,
        voidedQr,
        qrGeneratedByProduct,
      });
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
    const drink = result.drinks.find((d) => d.id === body.productId);
    const bottles = Math.max(
      0,
      Math.round(Number(body.qtyBottles) || 0) ||
        Math.round(m.qty * unitsPerCasierOf(drink)),
    );
    let units: Awaited<ReturnType<typeof generatePlatQrUnits>>["units"] = [];
    let qrError: string | null = null;
    if (bottles > 0) {
      try {
        const generated = await generatePlatQrUnits({
          date: body.date,
          productId: body.productId,
          qty: bottles,
          site: body.site,
          kind: "boisson",
          movementId: m.id,
          skipPayload: true,
        });
        units = generated.units;
      } catch (error) {
        qrError =
          error instanceof Error
            ? error.message
            : "QR des nouvelles bouteilles impossible.";
      }
    }
    await logActivity({
      user,
      kind: "boissons",
      title: `Achat · ${m.name}`,
      detail: `+${bottles || m.qty} bt · ${units.length} QR · dispo ${m.stockAfter}`,
      date: body.date,
      site: body.site ?? null,
    });
    const exits = await listVentesByKind({
      date: body.date,
      kind: "boisson",
      site: body.site ?? "all",
    });
    const qrGeneratedByProduct = await countQrGeneratedByProduct(
      body.date,
      body.site,
      "boisson",
    );
    return NextResponse.json({
      ...result,
      exits,
      units,
      qrError,
      qrGeneratedByProduct,
    });
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
