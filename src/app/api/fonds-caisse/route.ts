import { NextResponse } from "next/server";
import { authErrorResponse, requireUser } from "@/lib/api-auth";
import { logActivity } from "@/lib/log-activity";
import { CAISSE_LABELS, canUseCaisse, isZoneCaisse } from "@/lib/caisse-model";
import { formatFcfa } from "@/lib/format";
import {
  createFondsCaisse,
  deleteFondsCaisse,
  getFondsCaisseById,
  getFondsCaisseForToday,
  listFondsCaisseAll,
  listFondsCaisseByCaisse,
  updateFondsCaisse,
} from "@/lib/fonds-caisse-repo";
import type { CaisseKey } from "@/lib/types";
import { todayIsoDate } from "@/lib/zogbo-calc";

export const runtime = "nodejs";

/** L'admin suit les fonds en lecture seule : la saisie revient aux équipes. */
function ecritureInterdite(user: { role: string }) {
  if (user.role === "admin") {
    return NextResponse.json(
      { error: "L'administrateur consulte les fonds de caisse en lecture seule." },
      { status: 403 },
    );
  }
  return null;
}

function caisseInterdite(user: Parameters<typeof canUseCaisse>[0], caisse: unknown) {
  if (!isZoneCaisse(caisse as CaisseKey) || !canUseCaisse(user, caisse as CaisseKey)) {
    return NextResponse.json({ error: "Caisse non autorisée." }, { status: 403 });
  }
  return null;
}

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action");
    const date = searchParams.get("date") || todayIsoDate();
    const caisse = searchParams.get("caisse") as CaisseKey | null;
    const id = searchParams.get("id");

    if (action === "all") {
      if (user.role !== "admin") {
        return NextResponse.json(
          { error: "Accès réservé à l'administrateur." },
          { status: 403 },
        );
      }
      const list = await listFondsCaisseAll(
        searchParams.get("dateFrom") || undefined,
        searchParams.get("dateTo") || undefined,
      );
      return NextResponse.json({ fondsCaisses: list });
    }

    if (id) {
      const fondsCaisse = await getFondsCaisseById(id);
      const refus = caisseInterdite(user, fondsCaisse.caisse);
      if (refus) return refus;
      return NextResponse.json({ fondsCaisse });
    }

    if (caisse) {
      const refus = caisseInterdite(user, caisse);
      if (refus) return refus;
    }

    if (action === "today" && caisse) {
      const fondsCaisse = await getFondsCaisseForToday(caisse, date);
      return NextResponse.json({ fondsCaisse });
    }

    if (caisse) {
      const dateFrom = searchParams.get("dateFrom") || undefined;
      const dateTo = searchParams.get("dateTo") || undefined;
      const list = await listFondsCaisseByCaisse(caisse, dateFrom, dateTo);
      return NextResponse.json({ fondsCaisses: list });
    }

    return NextResponse.json(
      { error: "Missing caisse parameter" },
      { status: 400 },
    );
  } catch (err) {
    console.error("GET /api/fonds-caisse failed:", err);
    return authErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const lectureSeule = ecritureInterdite(user);
    if (lectureSeule) return lectureSeule;
    const data = await request.json();

    const refus = caisseInterdite(user, data.caisse);
    if (refus) return refus;
    const date = data.date || todayIsoDate();
    if (await getFondsCaisseForToday(data.caisse, date)) {
      return NextResponse.json(
        { error: "Un fonds de caisse existe déjà pour cette date." },
        { status: 409 },
      );
    }

    const fondsCaisse = await createFondsCaisse({
      date,
      caisse: data.caisse,
      site: data.site || null,
      soldePrevision: data.soldePrevision || 0,
      soldeReel: data.soldeReel || 0,
      ecart: (data.soldeReel || 0) - (data.soldePrevision || 0),
      justificationEcart: data.justificationEcart || null,
      actorId: user.id,
      actorName: user.name,
      createdAt: new Date().toISOString(),
    });

    await logActivity({
      user,
      kind: "caisse",
      title: "Fonds de caisse créé",
      detail: `${CAISSE_LABELS[fondsCaisse.caisse]} - ${formatFcfa(fondsCaisse.soldeReel)}`,
    });

    return NextResponse.json({ fondsCaisse }, { status: 201 });
  } catch (err) {
    console.error("POST /api/fonds-caisse failed:", err);
    return authErrorResponse(err);
  }
}

export async function PUT(request: Request) {
  try {
    const user = await requireUser();
    const lectureSeule = ecritureInterdite(user);
    if (lectureSeule) return lectureSeule;
    const { id, ...updates } = await request.json();

    if (!id) {
      return NextResponse.json(
        { error: "Missing id parameter" },
        { status: 400 },
      );
    }

    const existant = await getFondsCaisseById(id);
    const refus = caisseInterdite(user, existant.caisse);
    if (refus) return refus;

    const fondsCaisse = await updateFondsCaisse(id, {
      date: existant.date,
      soldePrevision: updates.soldePrevision || 0,
      soldeReel: updates.soldeReel || 0,
      justificationEcart: updates.justificationEcart || null,
      ecart: (updates.soldeReel || 0) - (updates.soldePrevision || 0),
      updatedById: user.id,
      updatedByName: user.name,
    });

    await logActivity({
      user,
      kind: "caisse",
      title: "Fonds de caisse modifié",
      detail: `${CAISSE_LABELS[fondsCaisse.caisse]} - ${formatFcfa(fondsCaisse.soldeReel)}`,
    });

    return NextResponse.json({ fondsCaisse });
  } catch (err) {
    console.error("PUT /api/fonds-caisse failed:", err);
    return authErrorResponse(err);
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireUser();
    const lectureSeule = ecritureInterdite(user);
    if (lectureSeule) return lectureSeule;
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "Missing id parameter" },
        { status: 400 },
      );
    }

    const fondsCaisse = await getFondsCaisseById(id);
    const refus = caisseInterdite(user, fondsCaisse.caisse);
    if (refus) return refus;
    await deleteFondsCaisse(id);

    await logActivity({
      user,
      kind: "caisse",
      title: "Fonds de caisse supprimé",
      detail: `${CAISSE_LABELS[fondsCaisse.caisse]}`,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/fonds-caisse failed:", err);
    return authErrorResponse(err);
  }
}
