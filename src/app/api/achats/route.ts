import { NextResponse } from "next/server";
import { authErrorResponse, requireUser } from "@/lib/api-auth";
import type { SessionUser } from "@/lib/auth-types";
import {
  CAISSE_LABELS,
  allowedCaisses,
  canUseCaisse,
  isCaisseKey,
} from "@/lib/caisse-model";
import { addCaisseMouvement } from "@/lib/caisse-repo";
import {
  getOpenCaisse,
  listDepensesByCaisse,
} from "@/lib/achats-repo";
import { logActivity } from "@/lib/log-activity";
import type { CaisseKey, VenteSite } from "@/lib/types";
import { todayIsoDate } from "@/lib/zogbo-calc";

export const runtime = "nodejs";

const ZONE_CAISSES: CaisseKey[] = ["zogbo", "gbegamey"];

function isValidDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

/** Caisse de zone par défaut : le site du compte, sinon Zogbo. */
function defaultZoneCaisse(user: SessionUser): CaisseKey {
  if (
    (user.site === "zogbo" || user.site === "gbegamey") &&
    canUseCaisse(user, user.site)
  ) {
    return user.site;
  }
  const first = ZONE_CAISSES.find((c) => canUseCaisse(user, c));
  if (first) return first;
  return "zogbo";
}

function resolveZoneCaisse(
  requested: string | null,
  user: SessionUser,
): CaisseKey | null {
  if (isCaisseKey(requested) && ZONE_CAISSES.includes(requested) && canUseCaisse(user, requested)) {
    return requested;
  }
  return defaultZoneCaisse(user);
}

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date") || todayIsoDate();
    if (!isValidDate(date)) {
      return NextResponse.json(
        { error: "Date invalide (attendu YYYY-MM-DD)." },
        { status: 400 },
      );
    }
    const caisse = resolveZoneCaisse(searchParams.get("caisse"), user);
    if (!caisse) {
      return NextResponse.json(
        { error: "Caisse de site non autorisée." },
        { status: 403 },
      );
    }

    const [depenses, active] = await Promise.all([
      listDepensesByCaisse({ caisse, date }),
      getOpenCaisse(caisse),
    ]);
    const total = depenses
      .filter((d) => !d.mouvement.cancelledAt)
      .reduce((s, d) => s + d.mouvement.montant, 0);

    return NextResponse.json({
      date,
      caisse,
      depenses,
      total,
      caisseOpen: active !== null,
      activeDate: active?.date ?? null,
      allowedCaisses: allowedCaisses(user).filter((c) => ZONE_CAISSES.includes(c)),
      defaultCaisse: defaultZoneCaisse(user),
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = (await request.json()) as {
      action?: "depense";
      caisse?: CaisseKey;
      date?: string;
      nature?: string;
      beneficiaire?: string;
      montant?: number;
    };

    if (body.action !== "depense") {
      return NextResponse.json(
        { error: "action inconnue (attendu depense)." },
        { status: 400 },
      );
    }
    const caisse = resolveZoneCaisse(body.caisse ?? null, user);
    if (!caisse) {
      return NextResponse.json(
        { error: "Caisse de site non autorisée." },
        { status: 403 },
      );
    }
    const date = body.date || todayIsoDate();
    if (!isValidDate(date)) {
      return NextResponse.json(
        { error: "Date invalide (attendu YYYY-MM-DD)." },
        { status: 400 },
      );
    }
    const nature = (body.nature ?? "").trim();
    if (nature.length < 2) {
      return NextResponse.json(
        { error: "Expliquez la dépense (au moins 2 caractères)." },
        { status: 400 },
      );
    }
    const montant = Math.round(Number(body.montant) || 0);
    if (montant <= 0) {
      return NextResponse.json(
        { error: "Montant invalide." },
        { status: 400 },
      );
    }

    const active = await getOpenCaisse(caisse);
    if (!active) {
      return NextResponse.json(
        { error: `Caisse ${CAISSE_LABELS[caisse]} fermée : ouvrez-la avant d’enregistrer une dépense.` },
        { status: 400 },
      );
    }
    if (active.date !== date) {
      return NextResponse.json(
        {
          error: `Caisse ouverte au ${active.date} — enregistrez sur ce jour ou clôturez-la.`,
        },
        { status: 400 },
      );
    }

    const result = await addCaisseMouvement({
      caisseId: active.id,
      user,
      kind: "depense",
      nature,
      beneficiaire: body.beneficiaire ?? "",
      montant,
    });
    await logActivity({
      user,
      kind: "caisse",
      title: `Dépense · ${nature}`,
      detail: body.beneficiaire?.trim()
        ? `${CAISSE_LABELS[caisse]} · bénéficiaire ${body.beneficiaire.trim()}`
        : CAISSE_LABELS[caisse],
      date,
      site: caisse as VenteSite,
      amount: -montant,
    });

    const depenses = await listDepensesByCaisse({ caisse, date });
    const totalDepenses = depenses
      .filter((d) => !d.mouvement.cancelledAt)
      .reduce((s, d) => s + d.mouvement.montant, 0);

    return NextResponse.json({
      mouvement: result.mouvement,
      session: result.session,
      depenses,
      total: totalDepenses,
    });
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return authErrorResponse(error);
  }
}