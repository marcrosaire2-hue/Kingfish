import { NextResponse } from "next/server";
import { authErrorResponse, requireUser } from "@/lib/api-auth";
import {
  canManagePastVentes,
  canUseSite,
  type UserShift,
} from "@/lib/auth-types";
import {
  authorizeRequestedSite,
  authorizeDestructiveSale,
  canCorrectClosedFinancialData,
  canPurgeFinancialData,
  containsMongoOperator,
  parseFiniteAmount,
} from "@/lib/security-policy";
import { consumeRateLimit, rateLimitResponse } from "@/lib/security-rate-limit";
import { logActivity, logCriticalActivity } from "@/lib/log-activity";
import { reportError } from "@/lib/report-error";
import { resolveOperatingDate } from "@/lib/caisse-repo";
import {
  editVenteQty,
  getVenteBoard,
  recordExtraVente,
  recordVente,
  undoVente,
  deleteVentePermanently,
} from "@/lib/vente-repo";
import { purgeVentesByDateRange } from "@/lib/pos-repo";
import type { VenteKind, VenteSite } from "@/lib/types";
import { todayIsoDate } from "@/lib/zogbo-calc";

export const runtime = "nodejs";

function siteFromRequest(
  userSite: "zogbo" | "gbegamey" | "tous",
  requested: unknown,
) {
  return authorizeRequestedSite(userSite, requested);
}

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

function actorOf(user: {
  id: string;
  name: string;
  username: string;
  shift?: UserShift;
}) {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    shift: user.shift,
  };
}

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const requested = searchParams.get("date") || todayIsoDate();
    const siteDecision = siteFromRequest(user.site, searchParams.get("site"));
    if (!siteDecision.ok) {
      return NextResponse.json(
        { error: siteDecision.error },
        { status: siteDecision.status },
      );
    }
    const site = siteDecision.site;
    const allowBackdate = canManagePastVentes(user.role);
    const date = await resolveOperatingDate(site, requested, { allowBackdate });
    const recentLimit = Number(searchParams.get("limit") || 40) || 40;
    const board = await getVenteBoard(date, site, { recentLimit });
    return NextResponse.json({
      ...board,
      backdate: allowBackdate && date < todayIsoDate(),
      canManagePast: allowBackdate,
      canPurge: canPurgeFinancialData(user.role),
      canCorrectClosed: canCorrectClosedFinancialData(user.role),
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
    const actor = actorOf(user);
    const manager = canManagePastVentes(user.role);
    const body = (await request.json()) as {
      action?: "sell" | "undo" | "extra" | "edit" | "delete" | "purge";
      date?: string;
      site?: VenteSite;
      kind?: VenteKind;
      productId?: string;
      qty?: number;
      id?: string;
      description?: string;
      unitPrice?: number;
      from?: string;
      to?: string;
      reason?: string;
      confirm?: boolean;
    };

    if (containsMongoOperator(body)) {
      return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
    }

    const siteDecision = siteFromRequest(user.site, body.site);
    if (!siteDecision.ok) {
      return NextResponse.json(
        { error: siteDecision.error },
        { status: siteDecision.status },
      );
    }
    const site = siteDecision.site;
    const closedBypass = canCorrectClosedFinancialData(user.role);

    if (body.action === "undo") {
      if (!body.id || !body.date) {
        return NextResponse.json(
          { error: "id et date requis pour annuler." },
          { status: 400 },
        );
      }
      const result = await undoVente({
        id: body.id,
        date: body.date,
        site,
        actor,
        bypassClosedDay: closedBypass,
        bypassTeam: manager,
      });
      return NextResponse.json(result);
    }

    if (body.action === "edit") {
      if (!manager) {
        return NextResponse.json(
          { error: "Modification réservée au gérant ou à l'administrateur." },
          { status: 403 },
        );
      }
      if (!body.id || body.qty === undefined) {
        return NextResponse.json(
          { error: "id et qty requis." },
          { status: 400 },
        );
      }
      const qty = parseFiniteAmount(body.qty, { min: 1, max: 10_000 });
      if (qty === null) {
        return NextResponse.json({ error: "Quantité invalide." }, { status: 400 });
      }
      const result = await editVenteQty({
        id: body.id,
        date: body.date || todayIsoDate(),
        site,
        qty,
        actor,
        bypassClosedDay: closedBypass,
        bypassTeam: true,
        bypassStock: true,
      });
      return NextResponse.json(result);
    }

    if (body.action === "delete") {
      const gate = authorizeDestructiveSale({
        role: user.role,
        action: "delete",
        reason: body.reason,
      });
      if (!gate.ok) {
        return NextResponse.json({ error: gate.error }, { status: gate.status });
      }
      if (!body.id) {
        return NextResponse.json({ error: "id requis." }, { status: 400 });
      }
      const limited = await tooMany(`vente-delete:${user.id}`, 20, 60 * 60 * 1000, true);
      if (limited) return limited;
      const deleted = await deleteVentePermanently({
        id: body.id,
        date: body.date,
        site,
        bypassClosedDay: closedBypass,
      });
      await logCriticalActivity({
        user,
        kind: "pos",
        title: `Suppression définitive · ${deleted.name}`,
        detail: `Motif : ${String(body.reason).trim()} · site ${site === "zogbo" ? "Zogbo" : "Gbégamey"}`,
        date: deleted.date,
        site,
        amount: -deleted.amount,
      });
      const board = await getVenteBoard(deleted.date, site);
      return NextResponse.json({ deleted, board });
    }

    if (body.action === "purge") {
      const gate = authorizeDestructiveSale({
        role: user.role,
        action: "purge",
        reason: body.reason,
        confirm: body.confirm,
      });
      if (!gate.ok) {
        return NextResponse.json({ error: gate.error }, { status: gate.status });
      }
      if (!body.from || !body.to) {
        return NextResponse.json(
          { error: "from et to requis (YYYY-MM-DD)." },
          { status: 400 },
        );
      }
      const limited = await tooMany(`vente-purge:${user.id}`, 5, 60 * 60 * 1000, true);
      if (limited) return limited;
      const result = await purgeVentesByDateRange({
        from: body.from,
        to: body.to,
        site,
      });
      await logCriticalActivity({
        user,
        kind: "pos",
        title: `Purge ventes ${body.from} → ${body.to}`,
        detail: `Motif : ${String(body.reason).trim()} · ${result.posTickets} ticket(s) POS · ${result.ventesLog} ligne(s) journal · ${result.aquaproTickets} AquaPro`,
        date: body.to,
        site,
      });
      return NextResponse.json(result);
    }

    if (body.action === "extra") {
      if (body.description === undefined || body.unitPrice === undefined) {
        return NextResponse.json(
          { error: "description et unitPrice requis." },
          { status: 400 },
        );
      }
      const date = await resolveOperatingDate(site, body.date, {
        allowBackdate: manager,
      });
      const result = await recordExtraVente({
        date,
        site,
        description: body.description,
        unitPrice: body.unitPrice,
        actor,
      });
      return NextResponse.json(result);
    }

    if (!body.kind || !body.productId) {
      return NextResponse.json(
        { error: "kind et productId requis." },
        { status: 400 },
      );
    }

    const date = await resolveOperatingDate(site, body.date, {
      allowBackdate: manager,
    });
    const pastDay = date < todayIsoDate();
    const result = await recordVente({
      date,
      site,
      kind: body.kind,
      productId: body.productId,
      qty: body.qty ?? 1,
      unitPrice: body.unitPrice,
      actor,
      bypassClosedDay: closedBypass && pastDay,
      // Gérant/admin : le stock reste indicatif, jamais bloquant pour lui —
      // pas seulement en correction d'un jour passé.
      bypassStock: manager,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error) {
      const m = error.message;
      if (m.includes("clôturée")) {
        return NextResponse.json({ error: m }, { status: 403 });
      }
      if (
        m.includes("Prix de vente") ||
        m.includes("Prix non autorisé") ||
        m.includes("Réduction réservée") ||
        m.includes("introuvable") ||
        m.includes("insuffisante") ||
        m.includes("insuffisant") ||
        m.includes("déjà annulée") ||
        m.includes("Annulation refusée") ||
        m.includes("invalide") ||
        m.includes("ne sont vendus qu") ||
        m.includes("Décrivez") ||
        m.includes("Description") ||
        m.includes("Prix invalide") ||
        m.includes("Modification réservée") ||
        m.includes("Quantité invalide")
      ) {
        return NextResponse.json({ error: m }, { status: 400 });
      }
    }
    reportError("POST /api/vente", error);
    return authErrorResponse(error);
  }
}
