import { NextResponse } from "next/server";
import { authErrorResponse, requireUser } from "@/lib/api-auth";
import {
  canManagePastVentes,
  canUseSite,
  type UserShift,
} from "@/lib/auth-types";
import {
  authorizeRequestedSite,
  canCorrectClosedFinancialData,
  containsMongoOperator,
  parseFiniteAmount,
} from "@/lib/security-policy";
import { ventePermissionsFor } from "@/lib/site-roles-model";
import {
  authorizePermanentDelete,
  authorizeVenteAction,
} from "@/lib/site-roles-policy";
import { consumeRateLimit, rateLimitResponse } from "@/lib/security-rate-limit";
import { logActivity, logCriticalActivity } from "@/lib/log-activity";
import { reportError } from "@/lib/report-error";
import { resolveOperatingDate, ensureActiveCaisseForSite } from "@/lib/caisse-repo";
import {
  editVenteQty,
  getVenteBoard,
  recordVente,
  undoVente,
  deleteVentePermanently,
} from "@/lib/vente-repo";
import { purgeVentesByDateRange } from "@/lib/pos-repo";
import { getSiteRolesConfig } from "@/lib/site-roles-repo";
import type { VenteKind, VenteSite } from "@/lib/types";
import { todayIsoDate } from "@/lib/zogbo-calc";
import { getParametres } from "@/lib/parametres-repo";
import {
  lookupStockUnit,
  scanStockUnit,
} from "@/lib/stock-unit-repo";

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
    const today = todayIsoDate();
    // Jour courant : ouvre la caisse du site automatiquement (Zogbo et
    // Gbégamey indépendantes — chacune à la demande).
    if (!(allowBackdate && requested < today)) {
      await ensureActiveCaisseForSite({ site, user });
    }
    const date = await resolveOperatingDate(site, requested, { allowBackdate });
    const recentLimit = Number(searchParams.get("limit") || 40) || 40;
    const [board, siteRoles] = await Promise.all([
      getVenteBoard(date, site, { recentLimit }),
      getSiteRolesConfig(),
    ]);
    const ventePerms = ventePermissionsFor(siteRoles, user.role, site);
    return NextResponse.json({
      ...board,
      backdate: allowBackdate && date < todayIsoDate(),
      canManagePast: allowBackdate && ventePerms.modify,
      canPurge: ventePerms.delete,
      canCorrectClosed: canCorrectClosedFinancialData(user.role),
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
    const actor = actorOf(user);
    const manager = canManagePastVentes(user.role);
    const body = (await request.json()) as {
      action?: "sell" | "undo" | "extra" | "edit" | "delete" | "purge" | "scan-qr";
      date?: string;
      site?: VenteSite;
      kind?: VenteKind;
      productId?: string;
      qty?: number;
      id?: string;
      qrId?: string;
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
    const siteRoles = await getSiteRolesConfig();
    // Gérant / DAF / admin / comptable : corriger un jour passé (ouvert ou
    // clôturé). La suppression définitive et la purge restent admin-only.
    const closedBypass = manager;

    if (body.action === "scan-qr") {
      const qrId = String(body.qrId ?? "").trim();
      if (!qrId) {
        return NextResponse.json({ error: "qrId requis." }, { status: 400 });
      }
      const date = await resolveOperatingDate(site, body.date, {
        allowBackdate: manager,
      });
      const unit = await lookupStockUnit(qrId);
      if (!unit) {
        return NextResponse.json(
          {
            error:
              "Code introuvable. Vérifiez le code collé sous le QR (ex. A7K-3Q2).",
          },
          { status: 404 },
        );
      }
      const scan = scanStockUnit(unit, {
        date,
        site,
        workflow: "vente",
      });
      const parametres = await getParametres();
      const dish = parametres.baseDishes.find((d) => d.id === unit.productId);
      const acc = parametres.localDishes.find((d) => d.id === unit.productId);
      const drink = parametres.drinks.find((d) => d.id === unit.productId);
      const unitPrice =
        unit.kind === "boisson"
          ? (drink?.salePrice ?? 0)
          : unit.kind === "local"
            ? (acc?.unitPrice ?? 0)
            : (dish?.unitPrice ?? 0);
      const canSell = scan.allowedActions.includes("sell");
      return NextResponse.json({
        ...scan,
        unitPrice,
        canSell,
      });
    }

    if (body.action === "undo") {
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
      const gate = authorizeVenteAction({
        config: siteRoles,
        role: user.role,
        site,
        action: "modify",
      });
      if (!gate.ok) {
        return NextResponse.json({ error: gate.error }, { status: gate.status });
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
      const gate = authorizePermanentDelete({
        config: siteRoles,
        role: user.role,
        site,
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
      const gate = authorizePermanentDelete({
        config: siteRoles,
        role: user.role,
        site,
        reason: body.reason,
        confirm: body.confirm,
        purge: true,
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
      return NextResponse.json(
        {
          error:
            "Les ventes hors catalogue ne sont plus autorisées. Choisissez un article du catalogue.",
        },
        { status: 410 },
      );
    }

    if (!body.kind || !body.productId) {
      return NextResponse.json(
        { error: "kind et productId requis." },
        { status: 400 },
      );
    }

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
