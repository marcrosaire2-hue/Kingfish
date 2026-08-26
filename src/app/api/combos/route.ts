import { NextResponse } from "next/server";
import { authErrorResponse, requireUser } from "@/lib/api-auth";
import { canAccessPath, type SessionUser } from "@/lib/auth-types";
import {
  comboEconomie,
  comboPrixNormal,
  componentName,
  newComboId,
  normalizeComboDish,
  normalizeCombos,
} from "@/lib/combos-model";
import { logActivity } from "@/lib/log-activity";
import { getParametres, saveParametresToDb } from "@/lib/parametres-repo";
import type { ComboDish } from "@/lib/types";

export const runtime = "nodejs";

function assertCombosAccess(user: SessionUser) {
  if (
    !canAccessPath(
      user.role,
      "/combos",
      user.site,
      user.username,
      user.nav,
    )
  ) {
    throw new Error("Accès refusé aux combos.");
  }
}

export async function GET() {
  try {
    const user = await requireUser();
    assertCombosAccess(user);
    const parametres = await getParametres();
    const combos = normalizeCombos(parametres.combos).map((c) => ({
      ...c,
      prixNormal: comboPrixNormal(c, parametres),
      economie: comboEconomie(c, parametres),
      componentsDetail: c.components.map((comp) => ({
        ...comp,
        name: componentName(comp, parametres),
        unitPrice: (() => {
          if (comp.kind === "plat") {
            return (
              parametres.baseDishes.find((d) => d.id === comp.productId)
                ?.unitPrice ?? 0
            );
          }
          if (comp.kind === "local") {
            return (
              parametres.localDishes.find((d) => d.id === comp.productId)
                ?.unitPrice ?? 0
            );
          }
          return (
            parametres.drinks.find((d) => d.id === comp.productId)?.salePrice ??
            0
          );
        })(),
      })),
    }));
    return NextResponse.json({
      combos,
      catalog: {
        plats: parametres.baseDishes.map((d) => ({
          id: d.id,
          name: d.name,
          unitPrice: d.unitPrice,
        })),
        locaux: parametres.localDishes.map((d) => ({
          id: d.id,
          name: d.name,
          unitPrice: d.unitPrice,
        })),
        boissons: parametres.drinks.map((d) => ({
          id: d.id,
          name: d.name,
          unitPrice: d.salePrice ?? 0,
        })),
      },
      canEdit: canAccessPath(
        user.role,
        "/parametres",
        user.site,
        user.username,
        user.nav,
      ),
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("Accès")) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return authErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const user = await requireUser();
    assertCombosAccess(user);
    if (
      !canAccessPath(
        user.role,
        "/parametres",
        user.site,
        user.username,
        user.nav,
      )
    ) {
      return NextResponse.json(
        { error: "Modification réservée aux comptes Paramètres." },
        { status: 403 },
      );
    }

    const body = (await request.json()) as {
      combos?: ComboDish[];
    };
    if (!Array.isArray(body.combos)) {
      return NextResponse.json(
        { error: "Liste de combos requise." },
        { status: 400 },
      );
    }

    const parametres = await getParametres();
    const combos = body.combos.map((c) =>
      normalizeComboDish({
        ...c,
        id: c.id?.trim() || newComboId(c.name || "formule"),
      }),
    );
    for (const c of combos) {
      if (!c.name.trim()) {
        return NextResponse.json(
          { error: "Chaque combo doit avoir un nom." },
          { status: 400 },
        );
      }
      if (c.unitPrice < 0) {
        return NextResponse.json(
          { error: `Prix invalide pour « ${c.name} ».` },
          { status: 400 },
        );
      }
      if (!c.components.length) {
        return NextResponse.json(
          { error: `« ${c.name} » doit contenir au moins un produit.` },
          { status: 400 },
        );
      }
    }

    const saved = await saveParametresToDb({
      ...parametres,
      combos,
    });

    await logActivity({
      user,
      kind: "parametres",
      title: "Combos / formules",
      detail: `${combos.length} formule(s) enregistrée(s)`,
      site: user.site === "tous" ? "tous" : user.site,
    });

    return NextResponse.json({ combos: saved.combos ?? [] });
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return authErrorResponse(error);
  }
}
