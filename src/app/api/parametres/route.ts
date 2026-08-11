import { NextResponse } from "next/server";
import { authErrorResponse, requireUser } from "@/lib/api-auth";
import {
  getParametres,
  resetParametresToSeed,
  saveParametresToDb,
} from "@/lib/parametres-repo";
import type { Parametres } from "@/lib/types";
import { logActivity } from "@/lib/log-activity";

export const runtime = "nodejs";

function isParametres(body: unknown): body is Parametres {
  if (!body || typeof body !== "object") return false;
  const b = body as Parametres;
  return (
    Array.isArray(b.baseDishes) &&
    Array.isArray(b.combos) &&
    Array.isArray(b.drinks) &&
    Array.isArray(b.localDishes)
  );
}

export async function GET() {
  try {
    await requireUser();
    const data = await getParametres();
    return NextResponse.json(data);
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json();
    if (!isParametres(body)) {
      return NextResponse.json(
        { error: "Payload paramètres invalide." },
        { status: 400 },
      );
    }
    const saved = await saveParametresToDb(body);
    await logActivity({
      user,
      kind: "parametres",
      title: "Catalogue paramètres enregistré",
      detail: `plats ${body.baseDishes.length} · combos ${body.combos.length} · boissons ${body.drinks.length} · locaux ${body.localDishes.length}`,
      site: "tous",
    });
    return NextResponse.json(saved);
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
    };
    if (body.action === "reset") {
      const saved = await resetParametresToSeed();
      await logActivity({
        user,
        kind: "parametres",
        title: "Paramètres réinitialisés",
        detail: "Retour aux valeurs d’origine",
        site: "tous",
      });
      return NextResponse.json(saved);
    }
    return NextResponse.json({ error: "Action inconnue." }, { status: 400 });
  } catch (error) {
    return authErrorResponse(error);
  }
}
