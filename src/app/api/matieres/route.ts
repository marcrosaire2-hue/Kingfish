import { NextResponse } from "next/server";
import { authErrorResponse, requireUser } from "@/lib/api-auth";
import { logActivity } from "@/lib/log-activity";
import { getPosConfig } from "@/lib/pos-config-repo";
import {
  addCaisseMouvement,
  cancelCaisseMouvement,
  getActiveCaisseForSite,
} from "@/lib/caisse-repo";
import {
  applyMatieresOtherPurchase,
  applyMatieresPurchase,
  cancelMatieresMovement,
  getMatieresDayPayload,
  linkMatieresMovementDepense,
  listMatieresMovements,
  saveMatieresDay,
} from "@/lib/matieres-repo";
import type { MatieresLine } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireUser();
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date");
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    if (from && to) {
      const historique = await listMatieresMovements({
        dateFrom: from,
        dateTo: to,
      });
      return NextResponse.json({ historique });
    }
    if (!date) {
      return NextResponse.json({ error: "Date requise." }, { status: 400 });
    }
    const payload = await getMatieresDayPayload(date);
    return NextResponse.json(payload);
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function PUT(request: Request) {
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
}

export async function POST(request: Request) {
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
    };

    if (!body.date) {
      return NextResponse.json({ error: "Date requise." }, { status: 400 });
    }

    if (body.action === "cancel") {
      if (!body.movementId) {
        return NextResponse.json(
          { error: "movementId requis." },
          { status: 400 },
        );
      }
      const payload = await cancelMatieresMovement({
        date: body.date,
        movementId: body.movementId,
      });
      // Dépense de caisse liée à l'achat : on la barre aussi, si la caisse
      // est encore ouverte. Fermée, la dépense reste au journal (T10).
      const cancelled = payload.day.movements.find(
        (m) => m.id === body.movementId,
      );
      let depenseWarning: string | null = null;
      if (cancelled?.depenseId) {
        try {
          await cancelCaisseMouvement({
            mouvementId: cancelled.depenseId,
            user,
          });
        } catch (e) {
          depenseWarning =
            e instanceof Error
              ? `Achat annulé, mais dépense liée non barrée : ${e.message}`
              : "Achat annulé, mais dépense liée non barrée.";
        }
      }
      await logActivity({
        user,
        kind: "matieres",
        title: "Annulation achat matières",
        detail: `Mouvement ${body.movementId}`,
        date: body.date,
        site: "zogbo",
      });
      return NextResponse.json({ ...payload, depenseWarning });
    }

    if (!body.productId || body.qty == null) {
      return NextResponse.json(
        { error: "productId et qty requis." },
        { status: 400 },
      );
    }
    // Le nom est résolu ici et figé sur le mouvement : renommer un
    // fournisseur plus tard ne doit pas réécrire l'historique d'achat.
    const fournisseur = body.fournisseurId
      ? (await getPosConfig()).fournisseurs.find(
          (f) => f.id === body.fournisseurId,
        )
      : null;
    // Achat hors catalogue : le nom est écrit à la main, sans ligne de stock.
    const payload =
      body.productId === "autre"
        ? await applyMatieresOtherPurchase({
            date: body.date,
            name: String(body.name ?? ""),
            qty: Number(body.qty),
            unitPrice: body.unitPrice,
            fournisseurId: fournisseur?.id ?? null,
            fournisseurNom: fournisseur?.nom ?? null,
          })
        : await applyMatieresPurchase({
            date: body.date,
            productId: body.productId,
            qty: Number(body.qty),
            unitPrice: body.unitPrice,
            fournisseurId: fournisseur?.id ?? null,
            fournisseurNom: fournisseur?.nom ?? null,
          });

    // Dépense de trésorerie auto-générée : le stock et la caisse se
    // recoupent. Caisse fermée, l'achat reste valable mais sans dépense
    // (signalée à l'écran).
    const montant = Math.round(
      payload.movement.qty * payload.movement.unitPrice,
    );
    let depense: { id: string; montant: number } | null = null;
    if (montant > 0) {
      try {
        const site: "zogbo" | "gbegamey" =
          user.site === "gbegamey" ? "gbegamey" : "zogbo";
        const session = await getActiveCaisseForSite(site);
        if (session) {
          const res = await addCaisseMouvement({
            caisseId: session.id,
            user,
            kind: "depense",
            nature: `Achat stock · ${payload.movement.name} +${payload.movement.qty}`,
            beneficiaire:
              payload.movement.fournisseurNom ?? "Fournisseur non précisé",
            montant,
          });
          depense = { id: res.mouvement.id, montant };
          await linkMatieresMovementDepense({
            date: body.date,
            movementId: payload.movement.id,
            depenseId: res.mouvement.id,
          });
        }
      } catch {
        // Caisse inaccessible ou session fermée : l'achat reste enregistré.
        depense = null;
      }
    }

    await logActivity({
      user,
      kind: "matieres",
      title: body.productId === "autre" ? "Achat libre" : "Achat matières",
      detail:
        body.productId === "autre"
          ? `${body.name} · +${Number(body.qty)}`
          : `Produit ${body.productId} · +${Number(body.qty)}`,
      date: body.date,
      site: "zogbo",
      amount: montant > 0 ? montant : null,
    });
    return NextResponse.json({ ...payload, depense });
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return authErrorResponse(error);
  }
}
