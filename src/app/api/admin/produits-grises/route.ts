import { NextResponse } from "next/server";
import {
  AuthError,
  authErrorResponse,
  requireUserManagementAdmin,
} from "@/lib/api-auth";
import { canUseSite, effectiveSite, SITE_LABELS } from "@/lib/auth-types";
import { withLiveBump } from "@/lib/live-route";
import { logActivity } from "@/lib/log-activity";
import { estKindGrisable } from "@/lib/produits-grises-calc";
import { definirProduitGrise } from "@/lib/produits-grises-repo";
import { containsMongoOperator } from "@/lib/security-policy";
import type { VenteSite } from "@/lib/types";

export const runtime = "nodejs";

export const POST = withLiveBump(async function POST(request: Request) {
  try {
    const admin = await requireUserManagementAdmin();
    const body = (await request.json()) as Record<string, unknown>;
    if (containsMongoOperator(body)) {
      return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
    }
    const site = body.site as VenteSite;
    if (site !== "zogbo" && site !== "gbegamey") {
      return NextResponse.json({ error: "Site invalide." }, { status: 400 });
    }
    if (!canUseSite(effectiveSite(admin.role, admin.site), site)) {
      throw new AuthError("Ce site n'est pas dans votre périmètre.", 403);
    }
    const kind = body.kind;
    const productId = String(body.productId ?? "").trim();
    const name = String(body.name ?? "").trim().slice(0, 160);
    if (!estKindGrisable(kind) || !productId || !name) {
      return NextResponse.json({ error: "Article invalide." }, { status: 400 });
    }
    if (typeof body.grise !== "boolean") {
      return NextResponse.json({ error: "Paramètre grise manquant." }, { status: 400 });
    }
    await definirProduitGrise({ site, kind, productId, name, grise: body.grise, byName: admin.name });
    await logActivity({
      user: admin,
      kind: "parametres",
      title: body.grise ? "Article grisé à la vente" : "Article remis en vente",
      detail: `${name} · ${SITE_LABELS[site]} · par ${admin.name}`,
      site,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return authErrorResponse(error);
  }
});
