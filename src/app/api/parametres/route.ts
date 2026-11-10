import { withLiveBump } from "@/lib/live-route";
import { NextResponse } from "next/server";
import { authErrorResponse, requireUser } from "@/lib/api-auth";
import {
  getParametres,
  resetParametresToSeed,
  saveParametresToDb,
} from "@/lib/parametres-repo";
import { effectiveSite } from "@/lib/auth-types";
import { resolveCatalogueSite } from "@/lib/catalogue-sites";
import type { Parametres } from "@/lib/types";
import { logActivity } from "@/lib/log-activity";

export const runtime = "nodejs";

function isParametres(body: unknown): body is Parametres {
  if (!body || typeof body !== "object") return false;
  const b = body as Parametres;
  return (
    Array.isArray(b.baseDishes) &&
    Array.isArray(b.drinks) &&
    Array.isArray(b.localDishes)
  );
}

function siteDemande(request: Request): string | null {
  return new URL(request.url).searchParams.get("site");
}

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const decision = resolveCatalogueSite(
      siteDemande(request),
      effectiveSite(user.role, user.site),
    );
    if (!decision.ok) {
      return NextResponse.json(
        { error: decision.error },
        { status: decision.status },
      );
    }
    const data = await getParametres(decision.site);
    return NextResponse.json(data);
  } catch (error) {
    return authErrorResponse(error);
  }
}

export const PUT = withLiveBump(async function PUT(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json();
    if (!isParametres(body)) {
      return NextResponse.json(
        { error: "Payload paramètres invalide." },
        { status: 400 },
      );
    }
    const decision = resolveCatalogueSite(
      siteDemande(request),
      effectiveSite(user.role, user.site),
    );
    if (!decision.ok) {
      return NextResponse.json(
        { error: decision.error },
        { status: decision.status },
      );
    }
    // Un écran resté ouvert sur l'ancienne version enverrait un catalogue sans
    // site : il ne doit surtout pas écraser l'un des deux.
    if (!decision.site) {
      return NextResponse.json(
        { error: "Rechargez la page, puis choisissez le site à modifier." },
        { status: 400 },
      );
    }
    const saved = await saveParametresToDb(body, decision.site);
    await logActivity({
      user,
      kind: "parametres",
      title: "Catalogue paramètres enregistré",
      detail: `plats ${body.baseDishes.length} · boissons ${body.drinks.length} · locaux ${body.localDishes.length}`,
      site: decision.site,
    });
    return NextResponse.json(saved);
  } catch (error) {
    return authErrorResponse(error);
  }
});

export const POST = withLiveBump(async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
    };
    if (body.action === "reset") {
      const decision = resolveCatalogueSite(
        siteDemande(request),
        effectiveSite(user.role, user.site),
      );
      if (!decision.ok) {
        return NextResponse.json(
          { error: decision.error },
          { status: decision.status },
        );
      }
      if (!decision.site) {
        return NextResponse.json(
          { error: "Rechargez la page, puis choisissez le site à réinitialiser." },
          { status: 400 },
        );
      }
      const saved = await resetParametresToSeed(decision.site);
      await logActivity({
        user,
        kind: "parametres",
        title: "Paramètres réinitialisés",
        detail: "Retour aux valeurs d’origine",
        site: decision.site,
      });
      return NextResponse.json(saved);
    }
    return NextResponse.json({ error: "Action inconnue." }, { status: 400 });
  } catch (error) {
    return authErrorResponse(error);
  }
});
