import { NextResponse } from "next/server";
import { AuthError, authErrorResponse, requireUser } from "@/lib/api-auth";
import { canUseSite, effectiveSite } from "@/lib/auth-types";
import { logActivity } from "@/lib/log-activity";
import { reportError } from "@/lib/report-error";
import type { VersementStatut, VenteSite } from "@/lib/types";
import {
  canConfirmVersement,
  canDeclareVersement,
  confirmVersement,
  declareVersement,
  listVersements,
} from "@/lib/versements-repo";
import { todayIsoDate } from "@/lib/zogbo-calc";

export const runtime = "nodejs";

function resolveSite(raw: string | null, userSite: string): VenteSite {
  if (raw === "zogbo" || raw === "gbegamey") return raw;
  return userSite === "zogbo" ? "zogbo" : "gbegamey";
}

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date");
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const siteFilter = searchParams.get("site");
    const statutRaw = searchParams.get("statut");
    const statut: VersementStatut | "all" =
      statutRaw === "en_attente" || statutRaw === "confirmee"
        ? statutRaw
        : "all";
    const scope = effectiveSite(user.role, user.site);

    let site: VenteSite | "all" = scope === "tous" ? "all" : scope;
    if (scope === "tous" && (siteFilter === "zogbo" || siteFilter === "gbegamey")) {
      site = siteFilter;
    }

    const rangeMode = !!(from || to);
    const versements = await listVersements({
      ...(rangeMode
        ? { from: from || to || todayIsoDate(), to: to || from || todayIsoDate() }
        : { date: date || todayIsoDate() }),
      site,
      statut,
    });

    return NextResponse.json({
      date: date || todayIsoDate(),
      from: rangeMode ? from || to : null,
      to: rangeMode ? to || from : null,
      site: scope,
      filterSite: site,
      versements,
      canDeclare: canDeclareVersement(user.role),
      canConfirm: canConfirmVersement(user.role),
      canFollowAll: scope === "tous",
    });
  } catch (error) {
    if (error instanceof AuthError) return authErrorResponse(error);
    reportError("GET /api/versements", error);
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const contentType = request.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      const body = (await request.json()) as {
        action?: "confirm";
        id?: string;
      };
      if (body.action !== "confirm" || !body.id) {
        return NextResponse.json(
          { error: "Action de confirmation invalide." },
          { status: 400 },
        );
      }
      const entry = await confirmVersement({
        id: body.id,
        actor: {
          id: user.id,
          name: user.name,
          username: user.username,
          role: user.role,
          shift: user.shift,
        },
      });
      await logActivity({
        user,
        kind: "versements",
        title: "Versement confirmé",
        detail: `Confirmé · ${entry.montant} FCFA · n° ${entry.numeroTransaction} · tx ${entry.heureTransaction} · déclaré par ${entry.actorName} (@${entry.actorUsername})`,
        date: entry.date,
        site: entry.site,
        amount: entry.montant,
      });
      return NextResponse.json({ entry });
    }

    const form = await request.formData();
    const site = resolveSite(
      typeof form.get("site") === "string" ? String(form.get("site")) : null,
      user.site,
    );
    if (!canUseSite(effectiveSite(user.role, user.site), site)) {
      return NextResponse.json({ error: "Site non autorisé." }, { status: 403 });
    }

    const preuveEntries = form.getAll("preuve").filter((v) => {
      if (!v || typeof v === "string") return false;
      return typeof (v as Blob).arrayBuffer === "function";
    }) as File[];

    if (preuveEntries.length === 0) {
      return NextResponse.json(
        { error: "Capture d’écran obligatoire." },
        { status: 400 },
      );
    }

    const preuves: Array<{
      mime: string;
      bytes: Buffer;
      filename?: string;
    }> = [];
    for (const preuve of preuveEntries) {
      const bytes = Buffer.from(await preuve.arrayBuffer());
      if (bytes.length <= 0) continue;
      preuves.push({
        mime: preuve.type || "application/octet-stream",
        bytes,
        filename: typeof preuve.name === "string" ? preuve.name : undefined,
      });
    }
    if (preuves.length === 0) {
      return NextResponse.json(
        { error: "Capture d’écran obligatoire." },
        { status: 400 },
      );
    }

    const membresRaw = form.getAll("membresPresents");
    const membresPresents =
      membresRaw.length > 0
        ? membresRaw.map((v) => String(v))
        : String(form.get("membresPresents") ?? "");

    const entry = await declareVersement({
      date:
        typeof form.get("date") === "string" && String(form.get("date"))
          ? String(form.get("date"))
          : undefined,
      site,
      heureTransaction: String(form.get("heureTransaction") ?? ""),
      trancheHoraire: form.get("trancheHoraire"),
      membresPresents,
      montant: form.get("montant"),
      numeroTransaction: String(form.get("numeroTransaction") ?? ""),
      preuves,
      actor: {
        id: user.id,
        name: user.name,
        username: user.username,
        role: user.role,
        shift: user.shift,
      },
    });

    await logActivity({
      user,
      kind: "versements",
      title: "Versement déclaré",
      detail: `En attente · ${entry.montant} FCFA · n° ${entry.numeroTransaction} · ${entry.trancheHoraire} · présents : ${entry.membresPresents.join(", ")} · ${entry.actorName} (@${entry.actorUsername})`,
      date: entry.date,
      site: entry.site,
      amount: entry.montant,
    });

    return NextResponse.json({ entry });
  } catch (error) {
    if (error instanceof AuthError) return authErrorResponse(error);
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    reportError("POST /api/versements", error);
    return authErrorResponse(error);
  }
}
