import { NextResponse } from "next/server";
import { authErrorResponse, requireUser } from "@/lib/api-auth";
import { canUseSite, type UserShift } from "@/lib/auth-types";
import { reportError } from "@/lib/report-error";
import {
  getVenteBoard,
  recordExtraVente,
  recordVente,
  undoVente,
} from "@/lib/vente-repo";
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
    // L'équipe suit le compte : le vendeur n'a rien à saisir.
    shift: user.shift,
  };
}

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date") || todayIsoDate();
    const requested = (searchParams.get("site") || "zogbo") as VenteSite;
    const site = resolveSite(requested, user.site);
    if (!canUseSite(user.site, site)) {
      return NextResponse.json({ error: "Site non autorisé." }, { status: 403 });
    }
    const recentLimit = Number(searchParams.get("limit") || 40) || 40;
    const board = await getVenteBoard(date, site, { recentLimit });
    return NextResponse.json({
      ...board,
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
    const body = (await request.json()) as {
      action?: "sell" | "undo" | "extra";
      date?: string;
      site?: VenteSite;
      kind?: VenteKind;
      productId?: string;
      qty?: number;
      id?: string;
      description?: string;
      unitPrice?: number;
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
      });
      return NextResponse.json(result);
    }

    if (body.action === "extra") {
      if (!body.date || body.description === undefined || body.unitPrice === undefined) {
        return NextResponse.json(
          { error: "date, description et unitPrice requis." },
          { status: 400 },
        );
      }
      const result = await recordExtraVente({
        date: body.date,
        site,
        description: body.description,
        unitPrice: body.unitPrice,
        actor,
      });
      return NextResponse.json(result);
    }

    if (!body.date || !body.kind || !body.productId) {
      return NextResponse.json(
        { error: "date, kind et productId requis." },
        { status: 400 },
      );
    }

    const result = await recordVente({
      date: body.date,
      site,
      kind: body.kind,
      productId: body.productId,
      qty: body.qty ?? 1,
      unitPrice: body.unitPrice,
      actor,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error) {
      const m = error.message;
      if (
        m.includes("Prix de vente") ||
        m.includes("introuvable") ||
        m.includes("insuffisante") ||
        m.includes("insuffisant") ||
        m.includes("déjà annulée") ||
        m.includes("invalide") ||
        m.includes("ne sont vendus qu") ||
        m.includes("Décrivez") ||
        m.includes("Description") ||
        m.includes("Prix invalide")
      ) {
        // Refus métier attendu (stock, prix, saisie) : pas un incident.
        return NextResponse.json({ error: m }, { status: 400 });
      }
    }
    // Tout le reste est un échec de vente : il doit laisser une trace.
    reportError("POST /api/vente", error);
    return authErrorResponse(error);
  }
}
