import { NextResponse } from "next/server";
import {
  AuthError,
  authErrorResponse,
  requireUserManagementAdmin,
} from "@/lib/api-auth";
import { effectiveSite, SITE_LABELS } from "@/lib/auth-types";
import { logActivity } from "@/lib/log-activity";
import type { VenteSite } from "@/lib/types";
import {
  getVentesSansStockStatus,
  setVentesSansStock,
} from "@/lib/ventes-sans-stock";
import { todayIsoDate } from "@/lib/zogbo-calc";

export const runtime = "nodejs";

const SITES: VenteSite[] = ["zogbo", "gbegamey"];

function isSite(v: unknown): v is VenteSite {
  return typeof v === "string" && (SITES as string[]).includes(v);
}

function sitesForAdmin(site: ReturnType<typeof effectiveSite>): VenteSite[] {
  if (site === "zogbo" || site === "gbegamey") return [site];
  return SITES;
}

function toEnforceStock(ventesSansStock: boolean): boolean {
  return !ventesSansStock;
}

export async function GET(request: Request) {
  try {
    const admin = await requireUserManagementAdmin();
    const url = new URL(request.url);
    const date = url.searchParams.get("date")?.trim() || todayIsoDate();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "Date invalide." }, { status: 400 });
    }

    const status = await getVentesSansStockStatus(date);
    const allowed = sitesForAdmin(effectiveSite(admin.role, admin.site));

    return NextResponse.json({
      date: status.date,
      sites: allowed.map((site) => ({
        site,
        label: SITE_LABELS[site],
        ventesSansStock: status[site],
        enforceStock: toEnforceStock(status[site]),
      })),
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const admin = await requireUserManagementAdmin();
    const body = (await request.json()) as {
      site?: VenteSite;
      enforceStock?: boolean;
      date?: string;
    };

    const date = body.date?.trim() || todayIsoDate();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "Date invalide." }, { status: 400 });
    }
    if (!isSite(body.site)) {
      return NextResponse.json({ error: "Site invalide." }, { status: 400 });
    }
    if (typeof body.enforceStock !== "boolean") {
      return NextResponse.json(
        { error: "Paramètre enforceStock manquant." },
        { status: 400 },
      );
    }

    const allowed = sitesForAdmin(effectiveSite(admin.role, admin.site));
    if (!allowed.includes(body.site)) {
      throw new AuthError("Ce site n'est pas dans votre périmètre.", 403);
    }

    const ventesSansStock = !body.enforceStock;
    await setVentesSansStock(date, body.site, ventesSansStock);

    await logActivity({
      user: admin,
      kind: "parametres",
      title: body.enforceStock
        ? "Vente selon le stock activée"
        : "Vente libre activée",
      detail: `${SITE_LABELS[body.site]} · ${date} · par ${admin.name}`,
      date,
      site: body.site,
    });

    const status = await getVentesSansStockStatus(date);

    return NextResponse.json({
      ok: true,
      date,
      site: body.site,
      ventesSansStock: status[body.site],
      enforceStock: toEnforceStock(status[body.site]),
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
