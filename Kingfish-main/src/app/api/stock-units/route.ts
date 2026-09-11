import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { AuthError, authErrorResponse, requireStockWrite, requireUser } from "@/lib/api-auth";
import { canUseSite } from "@/lib/auth-types";
import { reportError } from "@/lib/report-error";
import {
  lookupStockUnit,
  markUnitLost,
  scanStockUnit,
  sendPlatQrUnits,
} from "@/lib/stock-unit-repo";

export const runtime = "nodejs";

async function requireStockQrAccess() {
  const user = await requireUser();
  if (!canUseSite(user.site, "zogbo") && !canUseSite(user.site, "gbegamey")) {
    throw new AuthError("Accès non autorisé.", 403);
  }
  return user;
}

export async function GET(request: Request) {
  try {
    await requireStockQrAccess();
    const { searchParams } = new URL(request.url);
    const qrId = searchParams.get("qrId")?.trim();
    const date = searchParams.get("date")?.trim();
    const format = searchParams.get("format");

    if (!qrId) {
      return NextResponse.json({ error: "qrId requis." }, { status: 400 });
    }

    if (format === "png" || format === "svg") {
      const unit = await lookupStockUnit(qrId);
      if (!unit) {
        return NextResponse.json({ error: "QR introuvable." }, { status: 404 });
      }
      if (format === "svg") {
        const svg = await QRCode.toString(unit.qrId, { type: "svg", margin: 1 });
        return new NextResponse(svg, {
          headers: { "Content-Type": "image/svg+xml" },
        });
      }
      const png = await QRCode.toBuffer(unit.qrId, { type: "png", margin: 1, width: 256 });
      return new NextResponse(new Uint8Array(png), {
        headers: { "Content-Type": "image/png" },
      });
    }

    const unit = await lookupStockUnit(qrId);
    if (!unit) {
      return NextResponse.json({ error: "QR introuvable." }, { status: 404 });
    }

    const scan = scanStockUnit(unit, {
      date: date || unit.date,
      workflow:
        searchParams.get("workflow") === "gbegamey-receive"
          ? "gbegamey-receive"
          : "zogbo-send",
    });

    return NextResponse.json(scan);
  } catch (error) {
    if (error instanceof AuthError) return authErrorResponse(error);
    reportError("GET /api/stock-units", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erreur scan." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireStockQrAccess();
    requireStockWrite(user);
    const body = (await request.json()) as {
      action?: string;
      qrId?: string;
      qrIds?: string[];
      date?: string;
      payloadSite?: "zogbo" | "gbegamey";
      workflow?: string;
    };

    const action = body.action ?? "lookup";
    const qrId = String(body.qrId ?? "").trim();
    const date = body.date;
    const payloadSite =
      body.payloadSite === "gbegamey" ? "gbegamey" : "zogbo";
    const lookupWorkflow =
      body.workflow === "gbegamey-receive" ? "gbegamey-receive" : "zogbo-send";

    if (action === "send-one" && qrId && date) {
      const result = await sendPlatQrUnits({
        date,
        qrIds: [qrId],
        payloadSite,
      });
      return NextResponse.json(result);
    }

    if (action === "send-batch" && date && Array.isArray(body.qrIds)) {
      const result = await sendPlatQrUnits({
        date,
        qrIds: body.qrIds,
        payloadSite,
      });
      return NextResponse.json(result);
    }

    if (action === "mark-lost" && qrId && date) {
      const unit = await markUnitLost({ qrId, date });
      return NextResponse.json({ unit });
    }

    if (!qrId) {
      return NextResponse.json({ error: "qrId requis." }, { status: 400 });
    }

    const unit = await lookupStockUnit(qrId);
    if (!unit) {
      return NextResponse.json({ error: "QR introuvable." }, { status: 404 });
    }

    const scan = scanStockUnit(unit, {
      date: date || unit.date,
      workflow: lookupWorkflow,
    });
    return NextResponse.json(scan);
  } catch (error) {
    if (error instanceof AuthError) return authErrorResponse(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Action impossible." },
      { status: 400 },
    );
  }
}
