import { withLiveBump } from "@/lib/live-route";
import { NextResponse } from "next/server";
import { authErrorResponse, requireUser } from "@/lib/api-auth";
import {
  canManagePastVentes,
  effectiveSite,
  type SessionUser,
} from "@/lib/auth-types";
import { canCorrectClosedFinancialData } from "@/lib/security-policy";
import { logActivity } from "@/lib/log-activity";
import { getPosConfig } from "@/lib/pos-config-repo";
import {
  addCaisseMouvement,
  resolveCaisseForDepense,
} from "@/lib/caisse-repo";
import {
  applyMatieresOtherPurchase,
  applyMatieresPurchase,
  getMatieresDayPayload,
  linkMatieresMovementDepense,
  listMatieresMovements,
  saveMatieresDay,
} from "@/lib/matieres-repo";
import type { MatieresLine, VenteSite } from "@/lib/types";
import { todayIsoDate } from "@/lib/zogbo-calc";

export const runtime = "nodejs";

function siteOf(user: { site: string }): "zogbo" | "gbegamey" {
  return user.site === "gbegamey" ? "gbegamey" : "zogbo";
}

/**
 * Site d'un achat : celui du compte rattaché à un site ; un compte multi-sites
 * (administrateur) doit préciser le site concerné.
 */
function resolveAchatSite(
  user: SessionUser,
  requested: unknown,
): { site: VenteSite } | { error: string } {
  const scope = effectiveSite(user.role, user.site);
  if (scope === "zogbo" || scope === "gbegamey") return { site: scope };
  if (requested === "zogbo" || requested === "gbegamey") {
    return { site: requested };
  }
  return { error: "Précisez le site concerné par l'achat." };
}

/** Site affiché en lecture : celui du compte, ou celui choisi par l'admin. */
function readSite(user: SessionUser, requested: string | null): VenteSite {
  const res = resolveAchatSite(user, requested);
  return "site" in res ? res.site : siteOf(user);
}

function managerBypass(
  user: { role: SessionUser["role"] },
  date: string,
): boolean {
  return canManagePastVentes(user.role) && date < todayIsoDate();
}

async function attachDepense(input: {
  user: SessionUser;
  date: string;
  movementId: string;
  name: string;
  qty: number;
  fournisseurNom: string | null;
  montant: number;
  bypassPast: boolean;
  site: VenteSite;
}): Promise<{ id: string; montant: number } | { error: string } | null> {
  if (input.montant <= 0) return null;
  try {
    const { session, allowClosed } = await resolveCaisseForDepense({
      site: input.site,
      date: input.date,
      allowPastClosed: input.bypassPast,
    });
    if (!session) return null;
    const res = await addCaisseMouvement({
      caisseId: session.id,
      user: input.user,
      kind: "depense",
      nature: `Achat stock · ${input.name} +${input.qty}`,
      beneficiaire: input.fournisseurNom ?? "Fournisseur non précisé",
      montant: input.montant,
      allowClosed,
    });
    await linkMatieresMovementDepense({
      date: input.date,
      movementId: input.movementId,
      depenseId: res.mouvement.id,
    });
    return { id: res.mouvement.id, montant: input.montant };
  } catch (e) {
    // Plus de silence : l'appelant prévient l'utilisateur et le journal.
    return {
      error:
        e instanceof Error ? e.message : "Sortie de caisse non enregistrée.",
    };
  }
}

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date");
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const canManagePast = canManagePastVentes(user.role);
    if (from && to) {
      const historique = await listMatieresMovements({
        dateFrom: from,
        dateTo: to,
        site: readSite(user, searchParams.get("site")),
      });
      return NextResponse.json({ historique, canManagePast });
    }
    if (!date) {
      return NextResponse.json({ error: "Date requise." }, { status: 400 });
    }
    const full = await getMatieresDayPayload(date);
    // Chaque point de vente ne voit que ses propres achats.
    const mine = readSite(user, searchParams.get("site"));
    const payload = {
      ...full,
      day: {
        ...full.day,
        movements: full.day.movements.filter((m) => m.site === mine),
      },
    };
    return NextResponse.json({
      ...payload,
      canManagePast,
      backdate: canManagePast && date < todayIsoDate(),
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export const PUT = withLiveBump(async function PUT(request: Request) {
  try {
    const user = await requireUser();
    const body = (await request.json()) as {
      date?: string;
      status?: "ouverte" | "cloturee";
      lines?: MatieresLine[];
    };
    if (!body.date || !Array.isArray(body.lines)) {
      return NextResponse.json({ error: "Payload invalide." }, { status: 400 });
    }
    const payload = await saveMatieresDay({
      date: body.date,
      status: body.status,
      lines: body.lines,
    });
    await logActivity({
      user,
      kind: "matieres",
      title: `Matières · ${body.date}`,
      detail: `${body.lines.length} ligne(s) · ${body.status ?? "ouverte"}`,
      date: body.date,
      site: "zogbo",
    });
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof Error && error.message.includes("invalide")) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return authErrorResponse(error);
  }
});

export const POST = withLiveBump(async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = (await request.json()) as {
      action?: string;
      date?: string;
      productId?: string;
      name?: string;
      qty?: number;
      unitPrice?: number;
      movementId?: string;
      fournisseurId?: string;
      site?: string;
    };

    if (!body.date) {
      return NextResponse.json({ error: "Date requise." }, { status: 400 });
    }

    const bypass = managerBypass(user, body.date);
    const siteChoice = resolveAchatSite(user, body.site);

    if (body.action === "cancel") {
      return NextResponse.json(
        {
          error:
            "L’annulation d’un achat n’est plus autorisée. Contactez un responsable si une correction est nécessaire.",
        },
        { status: 403 },
      );
    }

    if (body.action === "edit") {
      return NextResponse.json(
        {
          error:
            "La modification d’un achat n’est plus autorisée. Contactez un responsable si une correction est nécessaire.",
        },
        { status: 403 },
      );
    }

    if (!body.productId || body.qty == null) {
      return NextResponse.json(
        { error: "productId et qty requis." },
        { status: 400 },
      );
    }
    if ("error" in siteChoice) {
      return NextResponse.json({ error: siteChoice.error }, { status: 400 });
    }
    const site = siteChoice.site;
    const fournisseur = body.fournisseurId
      ? (await getPosConfig()).fournisseurs.find(
          (f) => f.id === body.fournisseurId,
        )
      : null;
    // Un achat sort de l'argent : sans caisse ouverte il ne serait tracé nulle
    // part. On refuse AVANT d'enregistrer l'achat (qui n'est plus annulable).
    const { session: caisseDuJour } = await resolveCaisseForDepense({
      site,
      date: body.date,
      allowPastClosed: bypass,
    });
    if (!caisseDuJour) {
      return NextResponse.json(
        {
          error:
            "Aucune caisse ouverte : ouvrez la caisse du site avant d'enregistrer cet achat, sinon la sortie d'argent ne serait pas tracée.",
        },
        { status: 409 },
      );
    }
    const payload =
      body.productId === "autre"
        ? await applyMatieresOtherPurchase({
            date: body.date,
            site,
            name: String(body.name ?? ""),
            qty: Number(body.qty),
            unitPrice: body.unitPrice,
            fournisseurId: fournisseur?.id ?? null,
            fournisseurNom: fournisseur?.nom ?? null,
            bypassClosedDay: canCorrectClosedFinancialData(user.role),
          })
        : await applyMatieresPurchase({
            date: body.date,
            site,
            productId: body.productId,
            qty: Number(body.qty),
            unitPrice: body.unitPrice,
            fournisseurId: fournisseur?.id ?? null,
            fournisseurNom: fournisseur?.nom ?? null,
            bypassClosedDay: canCorrectClosedFinancialData(user.role),
          });

    const montant = Math.round(
      payload.movement.qty * payload.movement.unitPrice,
    );
    const depense = await attachDepense({
      user,
      date: body.date,
      movementId: payload.movement.id,
      name: payload.movement.name,
      qty: payload.movement.qty,
      fournisseurNom: payload.movement.fournisseurNom ?? null,
      montant,
      bypassPast: bypass,
      site,
    });

    await logActivity({
      user,
      kind: "matieres",
      title: body.productId === "autre" ? "Achat libre" : "Achat matières",
      detail:
        body.productId === "autre"
          ? `${body.name} · +${Number(body.qty)}`
          : `Produit ${body.productId} · +${Number(body.qty)}`,
      date: body.date,
      site,
      amount: montant > 0 ? montant : null,
    });
    const depenseError =
      depense && "error" in depense
        ? `Achat enregistré mais sortie de caisse refusée : ${depense.error}`
        : null;
    if (depenseError) {
      await logActivity({
        user,
        kind: "matieres",
        title: "Achat sans écriture de caisse",
        detail: depenseError,
        date: body.date,
        site,
        amount: montant > 0 ? montant : null,
      });
    }
    return NextResponse.json({
      ...payload,
      depense: depense && "id" in depense ? depense : null,
      depenseError,
    });
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return authErrorResponse(error);
  }
});
