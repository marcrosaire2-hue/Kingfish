import { NextResponse } from "next/server";
import { AuthError, authErrorResponse, requireUserManagementAdmin } from "@/lib/api-auth";
import { withLiveBump } from "@/lib/live-route";
import { logActivity } from "@/lib/log-activity";
import { resoudreSiteMagasin } from "@/lib/magasin-acces";
import { deleteFiche, listArticles, listFiches, saveFiche } from "@/lib/magasin-repo";
import { getParametres } from "@/lib/parametres-repo";
import { reportError } from "@/lib/report-error";
import { containsMongoOperator } from "@/lib/security-policy";
import type { VenteSite } from "@/lib/types";

export const runtime = "nodejs";

function erreur(operation: string, error: unknown): NextResponse {
  if (error instanceof AuthError) return authErrorResponse(error) as NextResponse;
  reportError(operation, error);
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Opération impossible." },
    { status: 400 },
  );
}

async function charger(site: VenteSite) {
  const [parametres, articles, fiches] = await Promise.all([
    getParametres(site),
    listArticles(site),
    listFiches(site),
  ]);
  return {
    site,
    articles: articles.filter((a) => a.active),
    fiches,
    produits: [
      ...parametres.baseDishes.map((d) => ({ kind: "plat" as const, id: d.id, name: d.name })),
      ...parametres.localDishes.map((d) => ({ kind: "local" as const, id: d.id, name: d.name })),
    ],
  };
}

export async function GET(request: Request) {
  try {
    const user = await requireUserManagementAdmin();
    const resolu = resoudreSiteMagasin(user, new URL(request.url).searchParams.get("site"));
    if (!resolu.ok) return resolu.response;
    return NextResponse.json(await charger(resolu.site));
  } catch (error) {
    return erreur("GET /api/composition", error);
  }
}

export const PUT = withLiveBump(async function PUT(request: Request) {
  try {
    const user = await requireUserManagementAdmin();
    const resolu = resoudreSiteMagasin(user, new URL(request.url).searchParams.get("site"));
    if (!resolu.ok) return resolu.response;
    const body = (await request.json()) as Record<string, unknown>;
    if (containsMongoOperator(body)) {
      return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
    }
    const saved = await saveFiche({
      site: resolu.site,
      productKind: body.productKind,
      productId: body.productId,
      productName: body.productName,
      mode: body.mode,
      portions: body.portions,
      lines: body.lines,
    });
    await logActivity({ user, kind: "gbegamey", title: `Composition · ${saved.productName}`, detail: `${saved.lines.length} ingrédient(s)`, site: resolu.site });
    return NextResponse.json(await charger(resolu.site));
  } catch (error) {
    return erreur("PUT /api/composition", error);
  }
});

export const DELETE = withLiveBump(async function DELETE(request: Request) {
  try {
    const user = await requireUserManagementAdmin();
    const url = new URL(request.url);
    const resolu = resoudreSiteMagasin(user, url.searchParams.get("site"));
    if (!resolu.ok) return resolu.response;
    const id = url.searchParams.get("id") ?? "";
    await deleteFiche(resolu.site, id);
    await logActivity({ user, kind: "gbegamey", title: "Composition supprimée", detail: id, site: resolu.site });
    return NextResponse.json(await charger(resolu.site));
  } catch (error) {
    return erreur("DELETE /api/composition", error);
  }
});
