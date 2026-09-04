import { NextResponse } from "next/server";
import { AuthError, authErrorResponse, requireUser } from "@/lib/api-auth";
import { canUseSite, effectiveSite } from "@/lib/auth-types";
import { logActivity } from "@/lib/log-activity";
import { reportError } from "@/lib/report-error";
import type { VersementStatut, VenteSite } from "@/lib/types";
import {
  canConfirmVersement,
  canDeclareVersement,
  canDeleteVersement,
  canEditVersement,
  confirmVersement,
  declareVersement,
  deleteVersement,
  listVersements,
  updateVersement,
} from "@/lib/versements-repo";
import { todayIsoDate } from "@/lib/zogbo-calc";

export const runtime = "nodejs";

function resolveSite(raw: string | null, userSite: string): VenteSite {
  if (raw === "zogbo" || raw === "gbegamey") return raw;
  return userSite === "zogbo" ? "zogbo" : "gbegamey";
}

function allowedSitesFor(
  scope: ReturnType<typeof effectiveSite>,
): VenteSite[] | "all" {
  if (scope === "tous") return "all";
  if (scope === "zogbo" || scope === "gbegamey") return [scope];
  return ["gbegamey"];
}

function actorFrom(user: Awaited<ReturnType<typeof requireUser>>) {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
    shift: user.shift,
  };
}

async function preuvesFromForm(form: FormData) {
  const preuveEntries = form.getAll("preuve").filter((v) => {
    if (!v || typeof v === "string") return false;
    return typeof (v as Blob).arrayBuffer === "function";
  }) as File[];

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
  return preuves;
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
      canEdit: canEditVersement(user.role),
      canDelete: canDeleteVersement(user.role),
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
    const scope = effectiveSite(user.role, user.site);
    const allowedSites = allowedSitesFor(scope);

    if (contentType.includes("application/json")) {
      const body = (await request.json()) as {
        action?: "confirm" | "delete";
        id?: string;
      };
      if (!body.id) {
        return NextResponse.json(
          { error: "Identifiant de versement manquant." },
          { status: 400 },
        );
      }

      if (body.action === "delete") {
        const entry = await deleteVersement({
          id: body.id,
          actor: actorFrom(user),
          allowedSites,
        });
        await logActivity({
          user,
          kind: "versements",
          title: "Versement supprimé",
          detail: `Supprimé · ${entry.montant} FCFA · n° ${entry.numeroTransaction} · déclaré par ${entry.actorName}`,
          date: entry.date,
          site: entry.site,
          amount: -entry.montant,
        });
        return NextResponse.json({ deleted: entry });
      }

      if (body.action !== "confirm") {
        return NextResponse.json(
          { error: "Action invalide." },
          { status: 400 },
        );
      }
      const entry = await confirmVersement({
        id: body.id,
        actor: actorFrom(user),
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
    const action =
      typeof form.get("action") === "string" ? String(form.get("action")) : "";
    const site = resolveSite(
      typeof form.get("site") === "string" ? String(form.get("site")) : null,
      user.site,
    );
    if (!canUseSite(scope, site)) {
      return NextResponse.json({ error: "Site non autorisé." }, { status: 403 });
    }

    const preuves = await preuvesFromForm(form);

    const membresRaw = form.getAll("membresPresents");
    const membresPresents =
      membresRaw.length > 0
        ? membresRaw.map((v) => String(v))
        : String(form.get("membresPresents") ?? "");

    if (action === "update") {
      const id =
        typeof form.get("id") === "string" ? String(form.get("id")) : "";
      if (!id) {
        return NextResponse.json(
          { error: "Identifiant de versement manquant." },
          { status: 400 },
        );
      }
      const entry = await updateVersement({
        id,
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
        preuves: preuves.length > 0 ? preuves : undefined,
        actor: actorFrom(user),
        allowedSites,
      });
      await logActivity({
        user,
        kind: "versements",
        title: "Versement modifié",
        detail: `Modifié · ${entry.montant} FCFA · n° ${entry.numeroTransaction} · ${entry.trancheHoraire} · par ${user.name}`,
        date: entry.date,
        site: entry.site,
        amount: entry.montant,
      });
      return NextResponse.json({ entry });
    }

    if (preuves.length === 0) {
      return NextResponse.json(
        { error: "Capture d’écran obligatoire." },
        { status: 400 },
      );
    }

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
      actor: actorFrom(user),
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
