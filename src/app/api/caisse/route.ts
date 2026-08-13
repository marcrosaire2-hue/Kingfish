import { NextResponse } from "next/server";
import { authErrorResponse, requireUser } from "@/lib/api-auth";
import {
  CAISSE_LABELS,
  allowedCaisses,
  canUseCaisse,
  defaultCaisse,
  isCaisseKey,
} from "@/lib/caisse-model";
import { logActivity } from "@/lib/log-activity";
import {
  addCaisseMouvement,
  closeCaisse,
  getActiveCaisse,
  getCaisseDetail,
  getCaissesOverview,
  listCaisses,
  openCaisse,
  versementCaisse,
} from "@/lib/caisse-repo";
import type { CaisseKey, CaisseMouvementKind } from "@/lib/types";
import { todayIsoDate } from "@/lib/zogbo-calc";

export const runtime = "nodejs";

/** Caisse demandée, ramenée à ce que le compte a le droit d'ouvrir. */
function resolveCaisse(
  requested: string | null,
  user: Parameters<typeof defaultCaisse>[0],
): CaisseKey {
  if (isCaisseKey(requested) && canUseCaisse(user, requested)) return requested;
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
    if (demandee && isCaisseKey(demandee) && !canUseCaisse(user, demandee)) {
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

    // La consolidation expose les soldes des autres zones : réservée aux
    // comptes qui ont déjà accès au coffre central.
    const overview = canUseCaisse(user, "centrale")
      ? await getCaissesOverview()
      : null;

    return NextResponse.json({
      date,
      caisse,
      site: active?.site ?? null,
      active,
      historique,
      overview,
      allowedCaisses: allowedCaisses(user),
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = (await request.json()) as {
      action?: "open" | "close" | "mouvement" | "versement";
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
      const caisse = body.caisse;
      if (!isCaisseKey(caisse)) {
        return NextResponse.json({ error: "Caisse inconnue" }, { status: 400 });
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
        site: session.site ?? "tous",
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

    if (body.action === "versement") {
      if (!body.id || !isCaisseKey(body.toCaisse)) {
        return NextResponse.json(
          { error: "id et caisse de destination requis" },
          { status: 400 },
        );
      }
      const result = await versementCaisse({
        fromSessionId: body.id,
        toCaisse: body.toCaisse,
        user,
        montant: Number(body.montant) || 0,
        nature: body.nature ?? null,
      });
      await logActivity({
        user,
        kind: "caisse",
        title: `Versement · ${CAISSE_LABELS[result.source.caisse]} → ${CAISSE_LABELS[result.destination.caisse]}`,
        detail: body.nature?.trim() || "Transfert entre caisses",
        date: todayIsoDate(),
        site: result.source.site ?? "tous",
        // Neutre pour le réseau : l'argent change de tiroir, il ne sort pas.
        amount: 0,
      });
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: "action inconnue" }, { status: 400 });
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return authErrorResponse(error);
  }
}
