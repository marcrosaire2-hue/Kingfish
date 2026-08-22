import { NextResponse } from "next/server";
import { authErrorResponse, requireUser } from "@/lib/api-auth";
import {
  canManagePastVentes,
  canUseSite,
  type UserShift,
} from "@/lib/auth-types";
import { reportError } from "@/lib/report-error";
import { logActivity } from "@/lib/log-activity";
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

function resolveSite(
  requested: VenteSite | null,
  userSite: "zogbo" | "gbegamey" | "tous",
): VenteSite {
  if (userSite === "zogbo" || userSite === "gbegamey") return userSite;
  return requested === "gbegamey" ? "gbegamey" : "zogbo";
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
    const requestedSite = (searchParams.get("site") || "zogbo") as VenteSite;
    const site = resolveSite(requestedSite, user.site);
    if (!canUseSite(user.site, site)) {
      return NextResponse.json({ error: "Site non autorisé." }, { status: 403 });
    }
    const allowBackdate = canManagePastVentes(user.role);
    const date = await resolveOperatingDate(site, requested, { allowBackdate });
    const recentLimit = Number(searchParams.get("limit") || 40) || 40;
    const board = await getVenteBoard(date, site, { recentLimit });
    return NextResponse.json({
      ...board,
      backdate: allowBackdate && date < todayIsoDate(),
      canManagePast: allowBackdate,
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
    };

    const site = resolveSite(body.site ?? null, user.site);
    if (!canUseSite(user.site, site)) {
      return NextResponse.json({ error: "Site non autorisé." }, { status: 403 });
    }

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
        bypassClosedDay: manager,
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
      const result = await editVenteQty({
        id: body.id,
        date: body.date || todayIsoDate(),
        site,
        qty: body.qty,
        actor,
        bypassClosedDay: true,
        bypassTeam: true,
        bypassStock: true,
      });
      return NextResponse.json(result);
    }

    if (body.action === "delete") {
      if (!manager) {
        return NextResponse.json(
          {
            error:
              "Suppression définitive réservée au gérant ou à l'administrateur.",
          },
          { status: 403 },
        );
      }
      if (!body.id) {
        return NextResponse.json({ error: "id requis." }, { status: 400 });
      }
      const deleted = await deleteVentePermanently({
        id: body.id,
        date: body.date,
        site,
        bypassClosedDay: true,
      });
      await logActivity({
        user,
        kind: "pos",
        title: `Suppression définitive · ${deleted.name}`,
        detail: `Site ${site === "zogbo" ? "Zogbo" : "Gbégamey"}`,
        date: deleted.date,
        site,
        amount: -deleted.amount,
      });
      const board = await getVenteBoard(deleted.date, site);
      return NextResponse.json({ deleted, board });
    }

    if (body.action === "purge") {
      if (!manager) {
        return NextResponse.json(
          {
            error:
              "Purge réservée au gérant ou à l'administrateur.",
          },
          { status: 403 },
        );
      }
      if (!body.from || !body.to) {
        return NextResponse.json(
          { error: "from et to requis (YYYY-MM-DD)." },
          { status: 400 },
        );
      }
      const result = await purgeVentesByDateRange({
        from: body.from,
        to: body.to,
        site,
      });
      await logActivity({
        user,
        kind: "pos",
        title: `Purge ventes ${body.from} → ${body.to}`,
        detail: `${result.posTickets} ticket(s) POS · ${result.ventesLog} ligne(s) journal · ${result.aquaproTickets} AquaPro`,
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
      bypassClosedDay: manager && pastDay,
      // Gérant/admin : le stock reste indicatif, jamais bloquant pour lui —
      // pas seulement en correction d'un jour passé.
      bypassStock: manager,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error) {
      const m = error.message;
      if (
        m.includes("Prix de vente") ||
        m.includes("Prix non autorisé") ||
        m.includes("Réduction réservée") ||
        m.includes("clôturée") ||
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
