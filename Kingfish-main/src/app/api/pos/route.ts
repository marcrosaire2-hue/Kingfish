import { NextResponse } from "next/server";
import { authErrorResponse, requireUser } from "@/lib/api-auth";
import { canManagePastVentes, canUseSite } from "@/lib/auth-types";
import {
  authorizeRequestedSite,
  canCorrectClosedFinancialData,
  containsMongoOperator,
} from "@/lib/security-policy";
import { ventePermissionsFor } from "@/lib/site-roles-model";
import {
  authorizePermanentDelete,
  authorizeVenteAction,
} from "@/lib/site-roles-policy";
import { consumeRateLimit, rateLimitResponse } from "@/lib/security-rate-limit";
import { logActivity, logCriticalActivity } from "@/lib/log-activity";
import {
  cancelPosTicket,
  deletePosTicketPermanently,
  getPosContext,
  validatePosTicket,
} from "@/lib/pos-repo";
import { getSiteRolesConfig } from "@/lib/site-roles-repo";
import type { SaleType, VenteKind, VenteSite } from "@/lib/types";
import { notifySaleTicketAsync } from "@/lib/mail/notify-sale";
import { reportError } from "@/lib/report-error";
import { todayIsoDate } from "@/lib/zogbo-calc";

export const runtime = "nodejs";

async function tooMany(
  key: string,
  limit: number,
  windowMs: number,
  failClosed: boolean,
) {
  try {
    const hit = await consumeRateLimit({ key, limit, windowMs });
    if (!hit.allowed) {
      return NextResponse.json(rateLimitResponse(hit.retryAfterSec), {
        status: 429,
        headers: { "Retry-After": String(hit.retryAfterSec) },
      });
    }
    return null;
  } catch {
    if (failClosed) {
      return NextResponse.json(
        { error: "Contrôle de débit indisponible." },
        { status: 503 },
      );
    }
    return null;
  }
}

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const requested = searchParams.get("date") || todayIsoDate();
    const siteDecision = authorizeRequestedSite(user.site, searchParams.get("site"));
    if (!siteDecision.ok) {
      return NextResponse.json(
        { error: siteDecision.error },
        { status: siteDecision.status },
      );
    }
    const site = siteDecision.site;
    const [ctx, siteRoles] = await Promise.all([
      getPosContext({
        date: requested,
        site,
        allowBackdate: canManagePastVentes(user.role),
        user,
      }),
      getSiteRolesConfig(),
    ]);
    const ventePerms = ventePermissionsFor(siteRoles, user.role, site);
    return NextResponse.json({
      ...ctx,
      canManagePast: canManagePastVentes(user.role) && ventePerms.modify,
      canPurge: ventePerms.delete,
      lockedSite: user.site !== "tous",
      allowedSites:
        user.site === "tous"
          ? (["zogbo", "gbegamey"] as VenteSite[])
          : [user.site],
      sitePolicies: siteRoles,
      ventePermissions: ventePerms,
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = (await request.json()) as {
      action?: "validate" | "cancel" | "delete";
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
        qrId?: string | null;
      }>;
      reason?: string;
      confirm?: boolean;
    };

    if (containsMongoOperator(body)) {
      return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
    }

    const siteDecision = authorizeRequestedSite(user.site, body.site);
    if (!siteDecision.ok) {
      return NextResponse.json(
        { error: siteDecision.error },
        { status: siteDecision.status },
      );
    }
    const site = siteDecision.site;
    const siteRoles = await getSiteRolesConfig();

    if (body.action === "validate") {
      const sellGate = authorizeVenteAction({
        config: siteRoles,
        role: user.role,
        site,
        action: "sell",
      });
      if (!sellGate.ok) {
        return NextResponse.json(
          { error: sellGate.error },
          { status: sellGate.status },
        );
      }
      const result = await validatePosTicket({
        date: body.date || todayIsoDate(),
        site,
        user,
        saleType: body.saleType || "Sur place",
        // Vente encaissée hors ligne puis rejouée : la référence du poste
        // évite de compter deux fois la même commande.
        clientRef: request.headers.get("X-Vente-Locale"),
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
        date: result.ticket.date,
        site,
        amount: result.ticket.montant,
      });
      notifySaleTicketAsync(result.ticket);
      return NextResponse.json(result);
    }

    if (body.action === "cancel") {
      const gate = authorizeVenteAction({
        config: siteRoles,
        role: user.role,
        site,
        action: "cancel",
      });
      if (!gate.ok) {
        return NextResponse.json({ error: gate.error }, { status: gate.status });
      }
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

    if (body.action === "delete") {
      const gate = authorizePermanentDelete({
        config: siteRoles,
        role: user.role,
        site,
        reason: body.reason,
      });
      if (!gate.ok) {
        return NextResponse.json({ error: gate.error }, { status: gate.status });
      }
      if (!body.id || !body.date) {
        return NextResponse.json(
          { error: "id et date requis" },
          { status: 400 },
        );
      }
      const limited = await tooMany(`pos-delete:${user.id}`, 20, 60 * 60 * 1000, true);
      if (limited) return limited;
      const result = await deletePosTicketPermanently({
        id: body.id,
        date: body.date,
        site,
        bypassClosedDay: canCorrectClosedFinancialData(user.role),
      });
      await logCriticalActivity({
        user,
        kind: "pos",
        title: `Suppression définitive ticket · ${result.ticket.numero}`,
        detail: `Motif : ${String(body.reason).trim()} · ${result.ticket.deletedLines} ligne(s) journal`,
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
