import { NextResponse } from "next/server";
import { AuthError, authErrorResponse, requireStockWrite, requireUser } from "@/lib/api-auth";
import { canUseSite } from "@/lib/auth-types";
import { logActivity } from "@/lib/log-activity";
import { reportError } from "@/lib/report-error";
import {
  generatePlatQrUnits,
  getStockSitePayload,
  listPlatUnits,
  registerProductStock,
  saveAccompanimentStock,
  sendPlatQrUnits,
} from "@/lib/stock-unit-repo";
import type { GbegameyLocalLine } from "@/lib/types";
import type { StockUnitStatus } from "@/lib/stock-unit-types";
import { todayIsoDate } from "@/lib/zogbo-calc";

export const runtime = "nodejs";

async function requireStockGbegameyAccess() {
  const user = await requireUser();
  if (!canUseSite(user.site, "gbegamey")) {
    throw new AuthError(
      "Accès Stock Gbégamey non autorisé pour ce compte.",
      403,
    );
  }
  return user;
}

export async function GET(request: Request) {
  try {
    await requireStockGbegameyAccess();
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date") || todayIsoDate();
    const productId = searchParams.get("productId");
    const listUnits = searchParams.get("units") === "1";

    if (listUnits && productId) {
      const statusParam = searchParams.get("status");
      const status: StockUnitStatus | undefined =
        statusParam === "prepare" ||
        statusParam === "envoye" ||
        statusParam === "vendu" ||
        statusParam === "perdu"
          ? statusParam
          : undefined;
      const siteParam = searchParams.get("site");
      const site: "zogbo" | "gbegamey" | undefined =
        siteParam === "zogbo" || siteParam === "gbegamey"
          ? siteParam
          : undefined;

      const units = await listPlatUnits({
        date,
        productId,
        status,
        site,
      });
      return NextResponse.json({ units });
    }

    const payload = await getStockSitePayload(date, "gbegamey");
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof AuthError) return authErrorResponse(error);
    reportError("GET /api/stock-gbegamey", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Impossible de charger Stock Gbégamey.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireStockGbegameyAccess();
    requireStockWrite(user);
    const body = (await request.json()) as {
      action?: string;
      date?: string;
      productId?: string;
      qty?: number;
      qrIds?: string[];
      kind?: "plat" | "local" | "boisson";
      accompanimentLines?: GbegameyLocalLine[];
    };

    const date = body.date || todayIsoDate();
    const action = body.action ?? "";

    if (action === "generate-qr") {
      if (!body.productId) {
        return NextResponse.json({ error: "productId requis." }, { status: 400 });
      }
      if (body.kind === "boisson") {
        return NextResponse.json(
          {
            error:
              "Les QR boissons se créent à l’achat (nombre de bouteilles), pas ici.",
          },
          { status: 400 },
        );
      }
      const result = await generatePlatQrUnits({
        date,
        productId: body.productId,
        qty: body.qty ?? 0,
        site: "gbegamey",
        kind: body.kind,
      });
      await logActivity({
        user,
        kind: "gbegamey",
        title: `QR générés · ${body.productId}`,
        detail: `${result.units.length} unité(s) · ${date}`,
        date,
        site: "gbegamey",
      });
      return NextResponse.json(result);
    }

    if (action === "register-stock") {
      if (!body.productId) {
        return NextResponse.json({ error: "productId requis." }, { status: 400 });
      }
      if (body.kind === "boisson") {
        return NextResponse.json(
          {
            error: "Les boissons s’enregistrent via l’achat (+).",
          },
          { status: 400 },
        );
      }
      const generateQr = Boolean(
        (body as { generateQr?: boolean }).generateQr,
      );
      const result = await registerProductStock({
        date,
        site: "gbegamey",
        productId: body.productId,
        qty: body.qty ?? 0,
        kind: body.kind,
        generateQr,
      });
      await logActivity({
        user,
        kind: "gbegamey",
        title: generateQr
          ? `Stock + QR · ${body.productId}`
          : `Stock saisi · ${body.productId}`,
        detail: `+${body.qty ?? 0} · ${date}`,
        date,
        site: "gbegamey",
      });
      return NextResponse.json(result);
    }

    if (action === "send") {
      const qrIds = Array.isArray(body.qrIds) ? body.qrIds : [];
      const result = await sendPlatQrUnits({
        date,
        qrIds,
        payloadSite: "gbegamey",
      });
      await logActivity({
        user,
        kind: "transfert",
        title: `Réception QR Gbégamey`,
        detail: `${result.sent.length} unité(s) · ${date}`,
        date,
        site: "gbegamey",
      });
      return NextResponse.json(result);
    }

    if (action === "save-accompaniments") {
      if (!Array.isArray(body.accompanimentLines)) {
        return NextResponse.json(
          { error: "accompanimentLines requis." },
          { status: 400 },
        );
      }
      const payload = await saveAccompanimentStock({
        date,
        accompanimentLines: body.accompanimentLines,
        site: "gbegamey",
      });
      return NextResponse.json({ payload });
    }

    return NextResponse.json({ error: "Action inconnue." }, { status: 400 });
  } catch (error) {
    if (error instanceof AuthError) return authErrorResponse(error);
    const message =
      error instanceof Error ? error.message : "Opération impossible.";
    reportError("POST /api/stock-gbegamey", error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PUT(request: Request) {
  try {
    const user = await requireStockGbegameyAccess();
    requireStockWrite(user);
    const body = (await request.json()) as {
      date?: string;
      accompanimentLines?: GbegameyLocalLine[];
    };
    if (!body.date || !Array.isArray(body.accompanimentLines)) {
      return NextResponse.json({ error: "Payload invalide." }, { status: 400 });
    }
    const payload = await saveAccompanimentStock({
      date: body.date,
      accompanimentLines: body.accompanimentLines,
      site: "gbegamey",
    });
    return NextResponse.json({ payload });
  } catch (error) {
    if (error instanceof AuthError) return authErrorResponse(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erreur enregistrement." },
      { status: 400 },
    );
  }
}
