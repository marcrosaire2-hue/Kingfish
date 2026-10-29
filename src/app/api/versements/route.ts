import { withLiveBump } from "@/lib/live-route";
import { NextResponse } from "next/server";
import { AuthError, authErrorResponse, requireUser } from "@/lib/api-auth";
import { canUseSite, effectiveSite } from "@/lib/auth-types";
import { logActivity, logCriticalActivity } from "@/lib/log-activity";
import {
  addCaisseMouvement,
  cancelCaisseMouvement,
  resolveCaisseForDepense,
} from "@/lib/caisse-repo";
import {
  canCorrectClosedFinancialData,
  isValidAuditReason,
} from "@/lib/security-policy";
import { reportError } from "@/lib/report-error";
import type { VersementStatut, VenteSite } from "@/lib/types";
import {
  canCancelPendingVersement,
  canConfirmVersement,
  canDeclareVersement,
  canDeleteVersement,
  canEditPendingVersement,
  cancelVersement,
  confirmVersement,
  declareVersement,
  deleteVersementPermanently,
  getVersement,
  getVersementCaisseMouvement,
  listVersements,
  setVersementCaisseMouvement,
  updateVersement,
} from "@/lib/versements-repo";
import { todayIsoDate } from "@/lib/zogbo-calc";

export const runtime = "nodejs";

function resolveSite(raw: string | null, userSite: string): VenteSite {
  if (raw === "zogbo" || raw === "gbegamey") return raw;
  return userSite === "zogbo" ? "zogbo" : "gbegamey";
}

/**
 * Annulation / suppression d'un versement confirmé (admin) : l'entrée de caisse
 * créée à la confirmation est annulée AVANT, sinon l'argent resterait compté.
 * Si elle échoue, rien n'est touché.
 */
async function reverseCaisseEntry(
  versementId: string,
  user: Awaited<ReturnType<typeof requireUser>>,
): Promise<void> {
  const mouvementId = await getVersementCaisseMouvement(versementId);
  if (!mouvementId) return;
  try {
    await cancelCaisseMouvement({ mouvementId, user, allowClosed: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "erreur inconnue";
    // Déjà annulée à la main : rien à reprendre.
    if (message.includes("déjà annulé")) return;
    throw new Error(`Entrée de caisse liée non annulée : ${message}`);
  }
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
      statutRaw === "en_attente" ||
      statutRaw === "confirmee" ||
      statutRaw === "annulee"
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
      canEditPending: canEditPendingVersement(user.role),
      canCancelPending: canCancelPendingVersement(user.role),
      canDelete: canDeleteVersement(user.role),
      canFollowAll: scope === "tous",
    });
  } catch (error) {
    if (error instanceof AuthError) return authErrorResponse(error);
    reportError("GET /api/versements", error);
    return authErrorResponse(error);
  }
}

export const POST = withLiveBump(async function POST(request: Request) {
  try {
    const user = await requireUser();
    const contentType = request.headers.get("content-type") || "";
    const scope = effectiveSite(user.role, user.site);

    if (contentType.includes("application/json")) {
      const body = (await request.json()) as {
        action?: "confirm" | "cancel" | "delete";
        id?: string;
        reason?: string;
      };
      if (
        !body.id ||
        (body.action !== "confirm" &&
          body.action !== "cancel" &&
          body.action !== "delete")
      ) {
        return NextResponse.json(
          { error: "Action invalide." },
          { status: 400 },
        );
      }

      const existing = await getVersement(body.id);
      if (!existing) {
        return NextResponse.json(
          { error: "Versement introuvable." },
          { status: 404 },
        );
      }
      if (!canUseSite(scope, existing.site)) {
        return NextResponse.json(
          { error: "Site non autorisé." },
          { status: 403 },
        );
      }

      if (body.action === "delete") {
        if (!canDeleteVersement(user.role)) {
          return NextResponse.json(
            { error: "Suppression réservée à l'administrateur." },
            { status: 403 },
          );
        }
        if (!isValidAuditReason(body.reason)) {
          return NextResponse.json(
            { error: "Motif d'audit requis (au moins 8 caractères)." },
            { status: 400 },
          );
        }
        await reverseCaisseEntry(body.id, user);
        const entry = await deleteVersementPermanently({
          id: body.id,
          actor: actorFrom(user),
        });
        await logCriticalActivity({
          user,
          kind: "versements",
          title: "Versement supprimé définitivement",
          detail: `Motif : ${String(body.reason).trim()} · ${entry.montant} FCFA · n° ${entry.numeroTransaction} · statut ${entry.statut} · déclaré par ${entry.actorName} (@${entry.actorUsername})`,
          date: entry.date,
          site: entry.site,
          amount: -entry.montant,
        });
        return NextResponse.json({ deleted: true, id: body.id });
      }

      if (body.action === "cancel") {
        if (existing.statut === "confirmee") {
          await reverseCaisseEntry(body.id, user);
        }
        const entry = await cancelVersement({
          id: body.id,
          actor: actorFrom(user),
        });
        await logActivity({
          user,
          kind: "versements",
          title: "Versement annulé",
          detail: `Annulé · ${entry.montant} FCFA · n° ${entry.numeroTransaction} · déclaré par ${entry.actorName} (@${entry.actorUsername})`,
          date: entry.date,
          site: entry.site,
          amount: entry.montant,
        });
        return NextResponse.json({ entry });
      }

      // Un versement confirmé est une entrée d'argent : il doit être tracé dans
      // la caisse du site. Sans caisse ouverte, on refuse AVANT de verrouiller.
      const bypassPast =
        canCorrectClosedFinancialData(user.role) &&
        existing.date < todayIsoDate();
      const { session: caisseSession, allowClosed } =
        await resolveCaisseForDepense({
          site: existing.site,
          date: existing.date,
          allowPastClosed: bypassPast,
        });
      if (existing.statut === "en_attente" && !caisseSession) {
        return NextResponse.json(
          {
            error: `Aucune caisse ouverte pour ${existing.site === "gbegamey" ? "Gbégamey" : "Zogbo"} : ouvrez la caisse avant de confirmer ce versement, sinon l'entrée d'argent ne serait pas tracée.`,
          },
          { status: 409 },
        );
      }

      const entry = await confirmVersement({
        id: body.id,
        actor: actorFrom(user),
      });
      let caisseWarning: string | null = null;
      if (caisseSession && !(await getVersementCaisseMouvement(entry.id))) {
        try {
          const res = await addCaisseMouvement({
            caisseId: caisseSession.id,
            user,
            kind: "versement-entree",
            nature: `Versement confirmé · n° ${entry.numeroTransaction}`,
            beneficiaire: entry.actorName,
            montant: entry.montant,
            allowClosed,
          });
          await setVersementCaisseMouvement(entry.id, res.mouvement.id);
        } catch (e) {
          reportError("versements.confirm.caisse", e, { versementId: entry.id });
          caisseWarning =
            e instanceof Error
              ? e.message
              : "Entrée de caisse non enregistrée.";
        }
      }
      await logActivity({
        user,
        kind: "versements",
        title: "Versement confirmé",
        detail: `Confirmé · ${entry.montant} FCFA · n° ${entry.numeroTransaction} · tx ${entry.heureTransaction} · déclaré par ${entry.actorName} (@${entry.actorUsername})`,
        date: entry.date,
        site: entry.site,
        amount: entry.montant,
      });
      return NextResponse.json({ entry, caisseWarning });
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
      const existing = await getVersement(id);
      if (!existing) {
        return NextResponse.json(
          { error: "Versement introuvable." },
          { status: 404 },
        );
      }
      if (!canUseSite(scope, existing.site) || !canUseSite(scope, site)) {
        return NextResponse.json(
          { error: "Site non autorisé." },
          { status: 403 },
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
        ...(preuves.length > 0 ? { preuves } : {}),
        actor: actorFrom(user),
      });
      await logActivity({
        user,
        kind: "versements",
        title: "Versement modifié",
        detail: `${entry.statut === "en_attente" ? "En attente" : entry.statut} · ${entry.montant} FCFA · n° ${entry.numeroTransaction} · ${entry.trancheHoraire} · présents : ${entry.membresPresents.join(", ")} · ${user.name} (@${user.username})`,
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
});
