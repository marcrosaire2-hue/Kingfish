import { NextResponse } from "next/server";
import { AuthError, authErrorResponse, requireUser } from "@/lib/api-auth";
import { canUseSite, effectiveSite } from "@/lib/auth-types";
import { logActivity } from "@/lib/log-activity";
import {
  canDeclareCompteur,
  canUpdateCompteur,
  listCompteurReleves,
  upsertCompteurReleve,
} from "@/lib/compteur-repo";
import { COMPTEUR_PERIODE_LABELS, type VenteSite } from "@/lib/types";
import { reportError } from "@/lib/report-error";
import { todayIsoDate } from "@/lib/zogbo-calc";

export const runtime = "nodejs";

function resolveSite(raw: string | null, userSite: string): VenteSite {
  if (raw === "zogbo" || raw === "gbegamey") return raw;
  return userSite === "zogbo" ? "zogbo" : "gbegamey";
}

function actorFrom(user: Awaited<ReturnType<typeof requireUser>>) {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
  };
}

async function preuveFromForm(form: FormData) {
  const raw = form.get("preuve");
  if (!raw || typeof raw === "string") return null;
  if (typeof (raw as Blob).arrayBuffer !== "function") return null;
  const file = raw as File;
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length <= 0) return null;
  return {
    mime: file.type || "application/octet-stream",
    bytes,
    filename: typeof file.name === "string" ? file.name : undefined,
  };
}

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date");
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const siteFilter = searchParams.get("site");
    const scope = effectiveSite(user.role, user.site);

    let site: VenteSite | "all" = scope === "tous" ? "all" : scope;
    if (
      scope === "tous" &&
      (siteFilter === "zogbo" || siteFilter === "gbegamey")
    ) {
      site = siteFilter;
    }

    const rangeMode = !!(from || to);
    const releves = await listCompteurReleves({
      ...(rangeMode
        ? { from: from || to || todayIsoDate(), to: to || from || todayIsoDate() }
        : { date: date || todayIsoDate() }),
      site,
    });

    return NextResponse.json({
      date: date || todayIsoDate(),
      from: rangeMode ? from || to : null,
      to: rangeMode ? to || from : null,
      site: scope,
      filterSite: site,
      releves,
      canDeclare: canDeclareCompteur(user.role),
      canUpdate: canUpdateCompteur(user.role),
      canFollowAll: scope === "tous",
    });
  } catch (error) {
    if (error instanceof AuthError) return authErrorResponse(error);
    reportError("GET /api/compteur", error);
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const scope = effectiveSite(user.role, user.site);
    const form = await request.formData();

    const site = resolveSite(
      typeof form.get("site") === "string" ? String(form.get("site")) : null,
      user.site,
    );
    if (!canUseSite(scope, site)) {
      return NextResponse.json({ error: "Site non autorisé." }, { status: 403 });
    }

    const date =
      typeof form.get("date") === "string" && String(form.get("date")).trim()
        ? String(form.get("date")).trim()
        : todayIsoDate();
    const periode = form.get("periode");
    const quantite = form.get("quantite");
    const preuve = await preuveFromForm(form);

    const entry = await upsertCompteurReleve({
      date,
      site,
      periode,
      quantite,
      preuve,
      actor: actorFrom(user),
    });

    const periodeLabel =
      COMPTEUR_PERIODE_LABELS[entry.periode] ?? entry.periode;

    await logActivity({
      user,
      kind: "compteur",
      title: "Relevé compteur électrique",
      detail: `${periodeLabel} · ${entry.quantite} restant(s) · ${entry.site} · ${entry.actorName}`,
      date: entry.date,
      site: entry.site,
      amount: entry.quantite,
    });

    return NextResponse.json({ entry });
  } catch (error) {
    if (error instanceof AuthError) return authErrorResponse(error);
    const message =
      error instanceof Error ? error.message : "Enregistrement impossible.";
    reportError("POST /api/compteur", error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
