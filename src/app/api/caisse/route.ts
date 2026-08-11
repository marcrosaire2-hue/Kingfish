import { NextResponse } from "next/server";
import { authErrorResponse, requireUser } from "@/lib/api-auth";
import { canUseSite } from "@/lib/auth-types";
import { logActivity } from "@/lib/log-activity";
import {
  addCaisseMouvement,
  closeCaisse,
  getActiveCaisse,
  getCaisseDetail,
  listCaisses,
  openCaisse,
} from "@/lib/caisse-repo";
import type { CaisseMouvementKind, VenteSite } from "@/lib/types";
import { todayIsoDate } from "@/lib/zogbo-calc";

export const runtime = "nodejs";

function resolveSite(
  requested: VenteSite | null,
  userSite: "zogbo" | "gbegamey" | "tous",
): VenteSite {
  if (userSite === "zogbo" || userSite === "gbegamey") return userSite;
  return requested === "gbegamey" ? "gbegamey" : "zogbo";
}

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date") || todayIsoDate();
    const requested = (searchParams.get("site") || "gbegamey") as VenteSite;
    const site = resolveSite(requested, user.site);
    if (!canUseSite(user.site, site)) {
      return NextResponse.json({ error: "Site non autorisé." }, { status: 403 });
    }

    const id = searchParams.get("id");
    if (id) {
      const detail = await getCaisseDetail(id);
      return NextResponse.json(detail);
    }

    const [active, historique] = await Promise.all([
      getActiveCaisse(user.id, site),
      listCaisses({ site, userId: user.id, limit: 40 }),
    ]);

    return NextResponse.json({
      date,
      site,
      active,
      historique,
      lockedSite: user.site !== "tous",
      allowedSites:
        user.site === "tous"
          ? (["zogbo", "gbegamey"] as VenteSite[])
          : [user.site],
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = (await request.json()) as {
      action?: "open" | "close" | "mouvement";
      date?: string;
      site?: VenteSite;
      id?: string;
      soldeInitial?: number;
      soldePhysique?: number;
      commentaire?: string;
      kind?: CaisseMouvementKind;
      nature?: string;
      beneficiaire?: string;
      montant?: number;
    };

    const site = resolveSite(body.site ?? null, user.site);
    if (!canUseSite(user.site, site)) {
      return NextResponse.json({ error: "Site non autorisé." }, { status: 403 });
    }
    const siteLabel = site === "zogbo" ? "Zogbo" : "Gbégamey";

    if (body.action === "open") {
      const date = body.date || todayIsoDate();
      const session = await openCaisse({
        date,
        site,
        userId: user.id,
        userName: user.name,
        soldeInitial: Number(body.soldeInitial) || 0,
      });
      await logActivity({
        user,
        kind: "caisse",
        title: `Ouverture caisse · ${siteLabel}`,
        detail: `Solde initial ${Number(body.soldeInitial) || 0} FCFA`,
        date,
        site,
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
        userId: user.id,
        soldePhysique: Number(body.soldePhysique) || 0,
        commentaire: body.commentaire ?? null,
      });
      await logActivity({
        user,
        kind: "caisse",
        title: `Clôture caisse · ${siteLabel}`,
        detail: body.commentaire?.trim() || "Caisse fermée",
        date: session.date,
        site,
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
        userId: user.id,
        kind: body.kind,
        nature: body.nature,
        beneficiaire: body.beneficiaire || "",
        montant: Number(body.montant) || 0,
      });
      const montant = Number(body.montant) || 0;
      await logActivity({
        user,
        kind: "caisse",
        title: `${body.kind === "depense" ? "Dépense" : "Recette"} caisse · ${body.nature}`,
        detail: body.beneficiaire?.trim()
          ? `Bénéficiaire ${body.beneficiaire.trim()}`
          : siteLabel,
        date: todayIsoDate(),
        site,
        amount: body.kind === "depense" ? -montant : montant,
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
