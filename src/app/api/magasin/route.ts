import { NextResponse } from "next/server";
import { AuthError, authErrorResponse, requireStockWrite, requireUser } from "@/lib/api-auth";
import { withLiveBump } from "@/lib/live-route";
import { logActivity } from "@/lib/log-activity";
import { resoudreSiteMagasin } from "@/lib/magasin-acces";
import { attachDepense } from "@/lib/achat-depense";
import { resolveCaisseForDepense } from "@/lib/caisse-repo";
import { applyMatieresOtherPurchase } from "@/lib/matieres-repo";
import { todayIsoDate } from "@/lib/zogbo-calc";
import {
  annulerProduction,
  article,
  declarerProduction,
  enregistrerComptage,
  enregistrerEntree,
  etatMagasin,
  saveArticle,
} from "@/lib/magasin-repo";
import { reportError } from "@/lib/report-error";
import { containsMongoOperator } from "@/lib/security-policy";

export const runtime = "nodejs";

function erreur(operation: string, error: unknown): NextResponse {
  if (error instanceof AuthError) return authErrorResponse(error) as NextResponse;
  reportError(operation, error);
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Opération impossible." },
    { status: 400 },
  );
}

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const resolu = resoudreSiteMagasin(user, new URL(request.url).searchParams.get("site"));
    if (!resolu.ok) return resolu.response;
    return NextResponse.json(await etatMagasin(resolu.site));
  } catch (error) {
    return erreur("GET /api/magasin", error);
  }
}

export const POST = withLiveBump(async function POST(request: Request) {
  try {
    const user = await requireUser();
    requireStockWrite(user);
    const resolu = resoudreSiteMagasin(user, new URL(request.url).searchParams.get("site"));
    if (!resolu.ok) return resolu.response;
    const { site } = resolu;
    const body = (await request.json()) as Record<string, unknown>;
    if (containsMongoOperator(body)) {
      return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
    }
    const actor = { id: user.id, name: user.name };
    let avertissement: string | null = null;

    switch (body.action) {
      case "article": {
        const saved = await saveArticle({
          site,
          id: body.id ? String(body.id) : null,
          name: body.name,
          unit: body.unit,
          unitPrice: body.unitPrice,
          threshold: body.threshold,
          active: body.active,
        });
        await logActivity({ user, kind: "gbegamey", title: `Magasin · article ${saved.name}`, detail: `unité ${saved.unit}`, site });
        break;
      }
      case "entree": {
        const a = await article(site, String(body.articleId ?? ""));
        const qty = Number(body.qty);
        if (!Number.isFinite(qty) || qty <= 0) {
          return NextResponse.json({ error: "Quantité invalide." }, { status: 400 });
        }
        const unitPrice = Number(body.unitPrice) || a.unitPrice;
        if (!(unitPrice > 0)) {
          return NextResponse.json({ error: "Indiquez le prix d'achat." }, { status: 400 });
        }
        const date = todayIsoDate();
        // Même règle que les autres achats : pas de sortie d'argent sans caisse.
        const { session } = await resolveCaisseForDepense({ site, date, allowPastClosed: false });
        if (!session) {
          return NextResponse.json(
            { error: "Aucune caisse ouverte : ouvrez la caisse du site avant d'enregistrer cet achat." },
            { status: 409 },
          );
        }
        // Achat libre : il entre au registre des achats et en comptabilité,
        // sans créer de ligne dans l'ancien stock des matières.
        const achat = await applyMatieresOtherPurchase({ date, site, name: a.name, qty, unitPrice });
        await enregistrerEntree({ site, articleId: a.id, qty, reference: achat.movement.id, unitPrice, actor });
        const montant = Math.round(achat.movement.qty * achat.movement.unitPrice);
        const depense = await attachDepense({
          user,
          date,
          movementId: achat.movement.id,
          name: achat.movement.name,
          qty: achat.movement.qty,
          fournisseurNom: null,
          montant,
          bypassPast: false,
          site,
        });
        if (depense && "error" in depense) avertissement = `Achat enregistré mais sortie de caisse refusée : ${depense.error}`;
        await logActivity({ user, kind: "matieres", title: "Achat condiment", detail: `${a.name} · +${qty} ${a.unit}`, date, site, amount: montant });
        break;
      }
      case "comptage":
        await enregistrerComptage({ site, family: body.family, itemId: String(body.itemId ?? ""), qty: body.qty, actor });
        await logActivity({ user, kind: "gbegamey", title: "Magasin · comptage", detail: `${String(body.itemId)} · ${String(body.qty)}`, site });
        break;
      case "production": {
        const saved = await declarerProduction({
          site,
          ficheId: String(body.ficheId ?? ""),
          lots: body.lots,
          portions: body.portions,
          saisies: Array.isArray(body.saisies) ? body.saisies : [],
          actor,
        });
        await logActivity({ user, kind: "gbegamey", title: `Production · ${saved.productName}`, detail: `${saved.lots} lot(s) · ${saved.portions} portion(s)`, site });
        break;
      }
      case "annuler-production":
        await annulerProduction({ site, id: String(body.id ?? ""), actor });
        await logActivity({ user, kind: "gbegamey", title: "Production annulée", detail: String(body.id), site });
        break;
      default:
        return NextResponse.json({ error: "Action inconnue." }, { status: 400 });
    }
    return NextResponse.json({ ...(await etatMagasin(site)), avertissement });
  } catch (error) {
    return erreur("POST /api/magasin", error);
  }
});
