import { NextResponse } from "next/server";
import { AuthError, authErrorResponse, requireUser } from "@/lib/api-auth";
import { canUseSite } from "@/lib/auth-types";
import {
  buildQrPrintSheetHtml,
  qrSheetFilename,
  type QrPrintItem,
} from "@/lib/qr-print-sheet";
import { lookupStockUnit } from "@/lib/stock-unit-repo";

export const runtime = "nodejs";

async function requireStockZogboAccess() {
  const user = await requireUser();
  if (!canUseSite(user.site, "zogbo")) {
    throw new AuthError("Accès non autorisé.", 403);
  }
  return user;
}

export async function POST(request: Request) {
  try {
    await requireStockZogboAccess();
    const body = (await request.json()) as {
      qrIds?: string[];
      title?: string;
      date?: string;
      productName?: string;
    };

    const qrIds = Array.isArray(body.qrIds)
      ? [...new Set(body.qrIds.map((id) => String(id ?? "").trim()).filter(Boolean))]
      : [];

    if (!qrIds.length) {
      return NextResponse.json({ error: "qrIds requis." }, { status: 400 });
    }

    const items: QrPrintItem[] = [];
    let sheetDate = body.date?.trim() || "";
    for (const qrId of qrIds) {
      const unit = await lookupStockUnit(qrId);
      if (!unit) {
        return NextResponse.json(
          { error: `QR introuvable : ${qrId}` },
          { status: 404 },
        );
      }
      if (!sheetDate) sheetDate = unit.date;
      items.push({ qrId: unit.qrId, productName: unit.productName });
    }

    const productName = body.productName?.trim() || items[0]?.productName || "Plat";
    const date = sheetDate || new Date().toISOString().slice(0, 10);
    const title =
      body.title?.trim() ||
      `${productName} · ${items.length} QR · ${date}`;
    const html = await buildQrPrintSheetHtml({ title, items });
    const filename = qrSheetFilename({ productName, date });

    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    if (error instanceof AuthError) return authErrorResponse(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Export impossible." },
      { status: 500 },
    );
  }
}
