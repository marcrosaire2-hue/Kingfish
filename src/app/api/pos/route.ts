import { NextResponse } from "next/server";
import { authErrorResponse, requireUser } from "@/lib/api-auth";
import { canUseSite } from "@/lib/auth-types";
import { logActivity } from "@/lib/log-activity";
import {
  cancelPosTicket,
  getPosContext,
  validatePosTicket,
} from "@/lib/pos-repo";
import type { SaleType, VenteKind, VenteSite } from "@/lib/types";
import { reportError } from "@/lib/report-error";
import { todayIsoDate } from "@/lib/zogbo-calc";

export const runtime = "nodejs";

function resolveSite(
  requested: VenteSite | null,
  userSite: "zogbo" | "gbegamey" | "tous",
): VenteSite {
  if (userSite === "zogbo" || userSite === "gbegamey") return userSite;
  return requested === "gbegamey" ? "gbegamey" : "zogbo";
}

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date") || todayIsoDate();
    const requested = (searchParams.get("site") || "gbegamey") as VenteSite;
    const site = resolveSite(requested, user.site);
    if (!canUseSite(user.site, site)) {
      return NextResponse.json({ error: "Site non autorisé." }, { status: 403 });
    }
    const ctx = await getPosContext({ date, site, userId: user.id });
    return NextResponse.json({
      ...ctx,
      lockedSite: user.site !== "tous",
      allowedSites:
        user.site === "tous"
          ? (["zogbo", "gbegamey"] as VenteSite[])
          : [user.site],
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = (await request.json()) as {
      action?: "validate" | "cancel";
      date?: string;
      site?: VenteSite;
      id?: string;
      saleType?: SaleType;
      paymentMethodId?: string;
      tableId?: string;
      serveurId?: string;
      clientNom?: string;
      reduction?: number;
      lines?: Array<{
        kind: VenteKind;
        productId: string;
        name?: string;
        qty: number;
        unitPrice?: number;
      }>;
    };

    const site = resolveSite(body.site ?? null, user.site);
    if (!canUseSite(user.site, site)) {
      return NextResponse.json({ error: "Site non autorisé." }, { status: 403 });
    }

    if (body.action === "validate") {
      const date = body.date || todayIsoDate();
      const result = await validatePosTicket({
        date,
        site,
        user,
        saleType: body.saleType || "Sur place",
        paymentMethodId: body.paymentMethodId,
        tableId: body.tableId,
        serveurId: body.serveurId,
        clientNom: body.clientNom,
        reduction: body.reduction,
        lines: body.lines || [],
      });
      await logActivity({
        user,
        kind: "pos",
        title: `Ticket POS · ${result.ticket.numero}`,
        detail: `${result.ticket.lines.length} ligne(s) · ${result.ticket.saleType}`,
        date,
        site,
        amount: result.ticket.montant,
      });
      return NextResponse.json(result);
    }

    if (body.action === "cancel") {
      if (!body.id || !body.date) {
        return NextResponse.json(
          { error: "id et date requis" },
          { status: 400 },
        );
      }
      const result = await cancelPosTicket({
        id: body.id,
        user,
        date: body.date,
        site,
      });
      await logActivity({
        user,
        kind: "pos",
        title: `Annulation ticket · ${result.ticket.numero}`,
        detail: `Site ${site === "zogbo" ? "Zogbo" : "Gbégamey"}`,
        date: body.date,
        site,
        amount: -result.ticket.montant,
      });
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: "action inconnue" }, { status: 400 });
  } catch (error) {
    // Un ticket qui échoue, c'est une commande perdue en salle : on trace
    // systématiquement, y compris les refus métier.
    reportError("POST /api/pos", error);
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return authErrorResponse(error);
  }
}
