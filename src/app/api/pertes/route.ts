import { NextResponse } from "next/server";
import { AuthError, authErrorResponse, requireUser } from "@/lib/api-auth";
import { canManagePastVentes, canUseSite, effectiveSite } from "@/lib/auth-types";
import { logActivity } from "@/lib/log-activity";
import { cancelPerte, listPertes, recordPerte } from "@/lib/pertes-repo";
import { reportError } from "@/lib/report-error";
import { PERTE_MOTIF_LABELS } from "@/lib/types";
import type { PerteKind, PerteMotif, VenteSite } from "@/lib/types";
import { todayIsoDate } from "@/lib/zogbo-calc";

export const runtime = "nodejs";

const KINDS: PerteKind[] = [
  "plat",
  "local",
  "combo",
  "boisson",
  "matiere",
  "immobilisation",
  "libre",
];

function resolveSite(raw: string | null, userSite: string): VenteSite {
  if (raw === "zogbo" || raw === "gbegamey") return raw;
  return userSite === "zogbo" ? "zogbo" : "gbegamey";
}

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date") || todayIsoDate();
    const scope = effectiveSite(user.role, user.site);

    const pertes = await listPertes({
      date,
      // Un compte rattaché à un site ne voit que les pertes de son site.
      site: scope === "tous" ? "all" : scope,
    });
    // `site` = périmètre réel du compte (« tous » ou sa zone) : le front
    // verrouille la page sur cette zone, sans sélecteur de site.
    return NextResponse.json({ date, pertes, motifs: PERTE_MOTIF_LABELS, site: scope });
  } catch (error) {
    if (error instanceof AuthError) return authErrorResponse(error);
    reportError("GET /api/pertes", error);
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = (await request.json()) as {
      action?: "declare" | "cancel";
      date?: string;
      site?: VenteSite;
      kind?: PerteKind;
      productId?: string;
      qty?: number;
      motif?: PerteMotif;
      commentaire?: string;
      id?: string;
      /** kind "libre" uniquement : jour où l'achat hors-catalogue a été saisi. */
      sourceDate?: string;
    };

    const actor = { id: user.id, name: user.name };

    if (body.action === "cancel") {
      if (!body.id) {
        return NextResponse.json({ error: "id requis." }, { status: 400 });
      }
      // Bypass clôture réservé gérant/admin (date lue après annulation côté repo).
      const entry = await cancelPerte({
        id: body.id,
        actor,
        bypassClosedDay: canManagePastVentes(user.role),
      });
      await logActivity({
        user,
        kind: "pertes",
        title: "Annulation d’une perte",
        detail: `${entry.qty} × ${entry.name}`,
        date: entry.date,
        site: entry.site,
      });
      return NextResponse.json({ entry });
    }

    const site = resolveSite(body.site ?? null, user.site);
    if (!canUseSite(effectiveSite(user.role, user.site), site)) {
      return NextResponse.json({ error: "Site non autorisé." }, { status: 403 });
    }
    if (!body.kind || !KINDS.includes(body.kind)) {
      return NextResponse.json({ error: "Famille invalide." }, { status: 400 });
    }
    if (!body.productId || body.qty == null || !body.motif) {
      return NextResponse.json(
        { error: "Produit, quantité et motif requis." },
        { status: 400 },
      );
    }
    if (body.kind === "libre" && !body.sourceDate) {
      return NextResponse.json(
        { error: "Achat source requis." },
        { status: 400 },
      );
    }

    const date = body.date || todayIsoDate();
    const entry = await recordPerte({
      date,
      site,
      kind: body.kind,
      productId: body.productId,
      qty: Number(body.qty),
      motif: body.motif,
      commentaire: body.commentaire,
      actor,
      bypassClosedDay:
        canManagePastVentes(user.role) && date < todayIsoDate(),
      sourceDate: body.sourceDate,
    });

    await logActivity({
      user,
      kind: "pertes",
      title: "Perte déclarée",
      detail: `${entry.qty} × ${entry.name} — ${PERTE_MOTIF_LABELS[entry.motif]}`,
      date: entry.date,
      site: entry.site,
      amount: entry.cost || null,
    });

    return NextResponse.json({ entry });
  } catch (error) {
    if (error instanceof AuthError) return authErrorResponse(error);
    // Refus de saisie attendus : quantité, motif, produit inconnu.
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    reportError("POST /api/pertes", error);
    return authErrorResponse(error);
  }
}
