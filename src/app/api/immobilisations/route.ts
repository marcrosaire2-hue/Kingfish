import { NextResponse } from "next/server";
import { AuthError, authErrorResponse, requireUser } from "@/lib/api-auth";
import { canManagePastVentes, canUseSite, effectiveSite } from "@/lib/auth-types";
import {
  createImmobilisation,
  listImmobilisations,
  setImmobilisationActive,
  updateImmobilisation,
} from "@/lib/immobilisations-repo";
import { logActivity } from "@/lib/log-activity";
import { reportError } from "@/lib/report-error";
import type { ImmobilisationKind, VenteSite } from "@/lib/types";

export const runtime = "nodejs";

function parseKind(raw: string | null): ImmobilisationKind | "all" {
  if (raw === "actif" || raw === "emballage") return raw;
  return "all";
}

function parseActive(raw: string | null): boolean | "all" {
  if (raw === "1" || raw === "true") return true;
  if (raw === "0" || raw === "false") return false;
  return "all";
}

function parseSite(raw: string | null): VenteSite | "all" {
  if (raw === "zogbo" || raw === "gbegamey") return raw;
  return "all";
}

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    // Vendeurs (encaissement) et gérants peuvent lister les emballages actifs.
    const { searchParams } = new URL(request.url);
    const kind = parseKind(searchParams.get("kind"));
    const active = parseActive(searchParams.get("active"));
    let site = parseSite(searchParams.get("site"));

    const scope = effectiveSite(user.role, user.site);
    if (scope !== "tous") {
      site = scope;
    }

    const items = await listImmobilisations({ kind, active, site });
    return NextResponse.json({ items, site: scope });
  } catch (error) {
    if (error instanceof AuthError) return authErrorResponse(error);
    reportError("GET /api/immobilisations", error);
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    if (!canManagePastVentes(user.role)) {
      return NextResponse.json(
        { error: "Réservé au gérant ou à l’administrateur." },
        { status: 403 },
      );
    }

    const body = (await request.json()) as {
      action?: "create" | "update" | "setActive";
      id?: string;
      name?: string;
      kind?: ImmobilisationKind;
      qty?: number;
      unit?: string;
      cost?: number;
      salePrice?: number | null;
      date?: string;
      site?: VenteSite | null;
      notes?: string;
      active?: boolean;
      dureeUtiliteAnnees?: number | null;
    };

    if (body.action === "setActive") {
      if (!body.id || body.active === undefined) {
        return NextResponse.json(
          { error: "id et active requis." },
          { status: 400 },
        );
      }
      const item = await setImmobilisationActive({
        id: body.id,
        active: body.active,
      });
      await logActivity({
        user,
        kind: "immobilisations",
        title: body.active
          ? `Immobilisation activée · ${item.name}`
          : `Immobilisation désactivée · ${item.name}`,
        detail: item.kind,
        date: item.date,
        site: item.site,
      });
      return NextResponse.json({ item });
    }

    if (body.action === "update") {
      if (!body.id) {
        return NextResponse.json({ error: "id requis." }, { status: 400 });
      }
      if (
        body.site === "zogbo" ||
        body.site === "gbegamey"
      ) {
        if (!canUseSite(effectiveSite(user.role, user.site), body.site)) {
          return NextResponse.json(
            { error: "Site non autorisé." },
            { status: 403 },
          );
        }
      }
      const item = await updateImmobilisation({
        id: body.id,
        name: body.name,
        qty: body.qty,
        unit: body.unit,
        cost: body.cost,
        salePrice: body.salePrice,
        date: body.date,
        site: body.site,
        notes: body.notes,
        dureeUtiliteAnnees: body.dureeUtiliteAnnees,
        user,
      });
      await logActivity({
        user,
        kind: "immobilisations",
        title: `Immobilisation modifiée · ${item.name}`,
        detail: item.kind,
        date: item.date,
        site: item.site,
        amount: item.cost || null,
      });
      return NextResponse.json({ item });
    }

    // create
    if (!body.name || !body.kind || !body.date) {
      return NextResponse.json(
        { error: "name, kind et date requis." },
        { status: 400 },
      );
    }
    if (body.site === "zogbo" || body.site === "gbegamey") {
      if (!canUseSite(effectiveSite(user.role, user.site), body.site)) {
        return NextResponse.json(
          { error: "Site non autorisé." },
          { status: 403 },
        );
      }
    }

    const item = await createImmobilisation({
      name: body.name,
      kind: body.kind,
      qty: body.qty,
      unit: body.unit,
      cost: body.cost,
      salePrice: body.salePrice,
      date: body.date,
      site: body.site ?? null,
      notes: body.notes,
      dureeUtiliteAnnees: body.dureeUtiliteAnnees,
      user,
    });
    await logActivity({
      user,
      kind: "immobilisations",
      title: `Immobilisation créée · ${item.name}`,
      detail: item.kind,
      date: item.date,
      site: item.site,
      amount: item.cost || item.salePrice || null,
    });
    return NextResponse.json({ item });
  } catch (error) {
    if (error instanceof AuthError) return authErrorResponse(error);
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    reportError("POST /api/immobilisations", error);
    return authErrorResponse(error);
  }
}
