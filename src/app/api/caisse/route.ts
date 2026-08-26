import { NextResponse } from "next/server";
import { authErrorResponse, requireUser } from "@/lib/api-auth";
import {
  CAISSE_LABELS,
  ZONE_CAISSES,
  allowedCaisses,
  canUseCaisse,
  defaultCaisse,
  isZoneCaisse,
} from "@/lib/caisse-model";
import { logActivity } from "@/lib/log-activity";
import {
  addCaisseMouvement,
  cancelCaisseMouvement,
  closeCaisse,
  getActiveCaisse,
  getCaisseDetail,
  getCaissesOverview,
  listCaisses,
  openCaisse,
} from "@/lib/caisse-repo";
import type { CaisseKey, CaisseMouvementKind } from "@/lib/types";
import { todayIsoDate } from "@/lib/zogbo-calc";

export const runtime = "nodejs";

/** Caisse de zone demandée, ramenée au périmètre du compte. */
function resolveCaisse(
  requested: string | null,
  user: Parameters<typeof defaultCaisse>[0],
): "zogbo" | "gbegamey" {
  if (isZoneCaisse(requested) && canUseCaisse(user, requested)) return requested;
  return defaultCaisse(user);
}

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date") || todayIsoDate();

    const id = searchParams.get("id");
    if (id) {
      const detail = await getCaisseDetail(id);
      if (!canUseCaisse(user, detail.session.caisse)) {
        return NextResponse.json(
          { error: "Caisse non autorisée." },
          { status: 403 },
        );
      }
      return NextResponse.json(detail);
    }

    const demandee = searchParams.get("caisse");
    if (demandee === "centrale") {
      return NextResponse.json(
        {
          error:
            "La caisse centrale est désactivée : chaque site a sa propre caisse.",
        },
        { status: 400 },
      );
    }
    if (demandee && isZoneCaisse(demandee) && !canUseCaisse(user, demandee)) {
      return NextResponse.json(
        { error: "Caisse non autorisée." },
        { status: 403 },
      );
    }
    const caisse = resolveCaisse(demandee, user);

    const [active, historique] = await Promise.all([
      getActiveCaisse(caisse),
      listCaisses({ caisse, limit: 40 }),
    ]);

    // Admin multi-sites : aperçu séparé des deux caisses (jamais un solde unique).
    const overview =
      user.site === "tous" ? await getCaissesOverview() : null;

    return NextResponse.json({
      date,
      caisse,
      site: active?.site ?? caisse,
      active,
      historique,
      overview,
      allowedCaisses: allowedCaisses(user),
      independentSites: true,
      zoneCaisses: ZONE_CAISSES,
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = (await request.json()) as {
      action?: "open" | "close" | "mouvement" | "versement" | "annuler-mouvement";
      mouvementId?: string;
      date?: string;
      caisse?: CaisseKey;
      toCaisse?: CaisseKey;
      id?: string;
      soldeInitial?: number;
      soldePhysique?: number;
      commentaire?: string;
      kind?: CaisseMouvementKind;
      nature?: string;
      beneficiaire?: string;
      montant?: number;
    };

    if (body.action === "open") {
      let caisse = body.caisse;
      if (!isZoneCaisse(caisse)) {
        return NextResponse.json(
          {
            error:
              "Caisse inconnue ou centrale désactivée. Utilisez Zogbo ou Gbégamey.",
          },
          { status: 400 },
        );
      }
      // Compte rattaché à une zone : toujours sa caisse (l'UI Vente démarrait
      // parfois sur Gbégamey et provoquait « Accès refusé » pour Zogbo).
      if (user.site === "zogbo" || user.site === "gbegamey") {
        caisse = user.site;
      } else if (!canUseCaisse(user, caisse)) {
        return NextResponse.json(
          { error: `Accès refusé à la ${CAISSE_LABELS[caisse].toLowerCase()}.` },
          { status: 403 },
        );
      }
      const date = body.date || todayIsoDate();
      const session = await openCaisse({
        date,
        caisse,
        user,
        soldeInitial: Number(body.soldeInitial) || 0,
      });
      await logActivity({
        user,
        kind: "caisse",
        title: `Ouverture · ${CAISSE_LABELS[caisse]}`,
        detail: `Fond de caisse ${Number(body.soldeInitial) || 0} FCFA`,
        date,
        site: session.site ?? caisse,
        amount: Number(body.soldeInitial) || 0,
      });
      return NextResponse.json({ session });
    }

    if (body.action === "close") {
      if (!body.id) {
        return NextResponse.json({ error: "id requis" }, { status: 400 });
      }
      const session = await closeCaisse({
        id: body.id,
        user,
        soldePhysique: Number(body.soldePhysique) || 0,
        commentaire: body.commentaire ?? null,
      });
      await logActivity({
        user,
        kind: "caisse",
        title: `Clôture · ${CAISSE_LABELS[session.caisse]}`,
        detail: body.commentaire?.trim() || "Caisse fermée",
        date: session.date,
        site: session.site ?? "tous",
        amount: Number(body.soldePhysique) || 0,
      });
      return NextResponse.json({ session });
    }

    if (body.action === "mouvement") {
      if (!body.id || !body.kind || !body.nature) {
        return NextResponse.json(
          { error: "id, kind et nature requis" },
          { status: 400 },
        );
      }
      if (body.kind !== "depense" && body.kind !== "recette") {
        return NextResponse.json({ error: "kind invalide" }, { status: 400 });
      }
      const result = await addCaisseMouvement({
        caisseId: body.id,
        user,
        kind: body.kind,
        nature: body.nature,
        beneficiaire: body.beneficiaire || "",
        montant: Number(body.montant) || 0,
      });
      const montant = Number(body.montant) || 0;
      await logActivity({
        user,
        kind: "caisse",
        title: `${body.kind === "depense" ? "Dépense" : "Recette"} · ${body.nature}`,
        detail: body.beneficiaire?.trim()
          ? `${CAISSE_LABELS[result.session.caisse]} · bénéficiaire ${body.beneficiaire.trim()}`
          : CAISSE_LABELS[result.session.caisse],
        date: todayIsoDate(),
        site: result.session.site ?? "tous",
        amount: body.kind === "depense" ? -montant : montant,
      });
      return NextResponse.json(result);
    }

    if (body.action === "annuler-mouvement") {
      if (!body.mouvementId) {
        return NextResponse.json(
          { error: "mouvementId requis" },
          { status: 400 },
        );
      }
      const result = await cancelCaisseMouvement({
        mouvementId: body.mouvementId,
        user,
      });
      await logActivity({
        user,
        kind: "caisse",
        title: `Annulation ${result.mouvement.kind === "depense" ? "dépense" : "recette"} · ${result.mouvement.nature}`,
        detail: CAISSE_LABELS[result.session.caisse],
        date: result.session.date,
        site: result.session.site ?? "tous",
        amount:
          result.mouvement.kind === "depense"
            ? result.mouvement.montant
            : -result.mouvement.montant,
      });
      return NextResponse.json(result);
    }

    if (body.action === "versement") {
      return NextResponse.json(
        {
          error:
            "Versements entre caisses désactivés : Zogbo et Gbégamey sont indépendantes.",
        },
        { status: 403 },
      );
    }

    return NextResponse.json({ error: "action inconnue" }, { status: 400 });
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return authErrorResponse(error);
  }
}
