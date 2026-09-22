import { NextResponse } from "next/server";
import { authErrorResponse, requireUser } from "@/lib/api-auth";
import {
  CAISSE_LABELS,
  allowedCaisses,
  canUseCaisse,
  isZoneCaisse,
  soldeGlobalSites,
  soldeTotaux,
} from "@/lib/caisse-model";
import { logActivity } from "@/lib/log-activity";
import {
  addFondsCaisse,
  getActiveCaisse,
  getCaissesOverview,
  listMouvementsReseau,
  openCaisse,
  setCaisseCapital,
} from "@/lib/caisse-repo";
import type { CaisseKey } from "@/lib/types";
import { todayIsoDate } from "@/lib/zogbo-calc";

export const runtime = "nodejs";

function assertAdmin(user: { role: string }) {
  if (user.role !== "admin") {
    throw new Error("Accès réservé à l'administrateur.");
  }
}

function sitesAutorises(user: Parameters<typeof allowedCaisses>[0]) {
  return allowedCaisses(user);
}

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    assertAdmin(user);

    const { searchParams } = new URL(request.url);
    const dateFrom =
      searchParams.get("dateFrom") || todayIsoDate().slice(0, 8) + "01";
    const dateTo = searchParams.get("dateTo") || todayIsoDate();
    const sites = sitesAutorises(user);

    const [overviewPack, mouvements] = await Promise.all([
      getCaissesOverview(),
      listMouvementsReseau({ dateFrom, dateTo, sites }),
    ]);

    const filteredOverview = overviewPack.items.filter((o) =>
      isZoneCaisse(o.caisse) ? canUseCaisse(user, o.caisse) : false,
    );

    const sitesDetail = await Promise.all(
      sites.map(async (caisse) => {
        const session = await getActiveCaisse(caisse);
        return {
          caisse,
          session,
          totaux: session ? soldeTotaux(session) : null,
          soldeCourant: session ? soldeTotaux(session).soldeCourant : 0,
        };
      }),
    );

    return NextResponse.json({
      dateFrom,
      dateTo,
      sites,
      overview: filteredOverview,
      soldeGlobal: soldeGlobalSites(filteredOverview),
      sitesDetail,
      mouvements: mouvements.map((row) => ({
        ...row.mouvement,
        caisse: row.caisse,
        sessionDate: row.date,
      })),
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("réservé")) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return authErrorResponse(error);
  }
}

/**
 * Admin : capital initial, ajout de fonds, ou remplacement du capital.
 * Pas de saisie de versements, achats ou dépenses (réservée à la caisse / achats).
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    assertAdmin(user);

    const body = (await request.json()) as {
      action?: "open-capital" | "open-capitaux" | "add-fonds" | "set-capital";
      date?: string;
      caisse?: CaisseKey;
      soldeInitial?: number;
      montant?: number;
      motif?: string;
      capitaux?: Partial<Record<"zogbo" | "gbegamey", number>>;
    };

    if (body.action === "open-capital") {
      if (!isZoneCaisse(body.caisse) || !canUseCaisse(user, body.caisse)) {
        return NextResponse.json(
          { error: "Caisse non autorisée." },
          { status: 403 },
        );
      }
      const date = body.date || todayIsoDate();
      const session = await openCaisse({
        date,
        caisse: body.caisse,
        user,
        soldeInitial: Number(body.soldeInitial) || 0,
      });
      await logActivity({
        user,
        kind: "caisse",
        title: `Capital initial · ${CAISSE_LABELS[body.caisse]}`,
        detail: `${Number(body.soldeInitial) || 0} FCFA`,
        date,
        site: session.site ?? body.caisse,
        amount: Number(body.soldeInitial) || 0,
      });
      return NextResponse.json({ session });
    }

    if (body.action === "open-capitaux") {
      const date = body.date || todayIsoDate();
      const sites = sitesAutorises(user);
      const opened = [];
      const errors: string[] = [];

      for (const caisse of sites) {
        const montant = Number(body.capitaux?.[caisse]);
        if (!Number.isFinite(montant) || montant < 0) {
          errors.push(`${CAISSE_LABELS[caisse]} : capital manquant.`);
          continue;
        }
        const existing = await getActiveCaisse(caisse);
        if (existing) {
          errors.push(
            `${CAISSE_LABELS[caisse]} déjà ouverte (capital ${existing.soldeInitial} FCFA).`,
          );
          continue;
        }
        try {
          const session = await openCaisse({
            date,
            caisse,
            user,
            soldeInitial: montant,
          });
          opened.push(session);
          await logActivity({
            user,
            kind: "caisse",
            title: `Capital initial · ${CAISSE_LABELS[caisse]}`,
            detail: `${montant} FCFA`,
            date,
            site: session.site ?? caisse,
            amount: montant,
          });
        } catch (e) {
          errors.push(
            e instanceof Error
              ? e.message
              : `Échec ouverture ${CAISSE_LABELS[caisse]}`,
          );
        }
      }

      if (opened.length === 0) {
        return NextResponse.json(
          {
            error:
              errors[0] ||
              "Aucun capital enregistré. Vérifiez les montants et les caisses.",
            errors,
          },
          { status: 400 },
        );
      }

      return NextResponse.json({ sessions: opened, errors });
    }

    if (body.action === "add-fonds") {
      if (!isZoneCaisse(body.caisse) || !canUseCaisse(user, body.caisse)) {
        return NextResponse.json(
          { error: "Caisse non autorisée." },
          { status: 403 },
        );
      }
      const date = body.date || todayIsoDate();
      const montant = Math.round(Number(body.montant) || 0);
      const result = await addFondsCaisse({
        caisse: body.caisse,
        user,
        montant,
        date,
        motif: body.motif ?? null,
      });
      await logActivity({
        user,
        kind: "caisse",
        title: `Fonds ajoutés · ${CAISSE_LABELS[body.caisse]}`,
        detail: [
          `+${montant} FCFA`,
          `${result.capitalAvant} → ${result.capitalApres} FCFA`,
          `effet au ${date}`,
          body.motif?.trim() || null,
        ]
          .filter(Boolean)
          .join(" · "),
        date,
        site: result.session.site ?? body.caisse,
        amount: montant,
      });
      return NextResponse.json(result);
    }

    if (body.action === "set-capital") {
      if (!isZoneCaisse(body.caisse) || !canUseCaisse(user, body.caisse)) {
        return NextResponse.json(
          { error: "Caisse non autorisée." },
          { status: 403 },
        );
      }
      const date = body.date || todayIsoDate();
      const soldeInitial = Math.max(
        0,
        Math.round(Number(body.soldeInitial) || 0),
      );
      const avant = await getActiveCaisse(body.caisse);
      const session = await setCaisseCapital({
        caisse: body.caisse,
        user,
        soldeInitial,
        date,
        motif: body.motif ?? null,
      });
      await logActivity({
        user,
        kind: "caisse",
        title: `Capital modifié · ${CAISSE_LABELS[body.caisse]}`,
        detail: [
          avant
            ? `${avant.soldeInitial} → ${soldeInitial} FCFA`
            : `Nouveau capital ${soldeInitial} FCFA`,
          `effet au ${date}`,
          body.motif?.trim() || null,
        ]
          .filter(Boolean)
          .join(" · "),
        date,
        site: session.site ?? body.caisse,
        amount: soldeInitial,
      });
      return NextResponse.json({ session });
    }

    return NextResponse.json(
      {
        error:
          "Action inconnue. L'admin gère le capital / les fonds, pas les versements ni les dépenses.",
      },
      { status: 400 },
    );
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes("réservé")) {
        return NextResponse.json({ error: error.message }, { status: 403 });
      }
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return authErrorResponse(error);
  }
}
