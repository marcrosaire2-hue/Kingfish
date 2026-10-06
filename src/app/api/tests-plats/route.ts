import { NextResponse } from "next/server";
import { authErrorResponse, requireUser } from "@/lib/api-auth";
import { canUseSite, effectiveSite } from "@/lib/auth-types";
import { containsMongoOperator } from "@/lib/security-policy";
import { logActivity } from "@/lib/log-activity";
import { reportError } from "@/lib/report-error";
import {
  cancelTestPlat,
  listTestProducts,
  listTestsPlats,
  recordTestPlat,
} from "@/lib/tests-plats-repo";
import type { TestPlatKind } from "@/lib/tests-plats-types";
import type { VenteSite } from "@/lib/types";
import { todayIsoDate } from "@/lib/zogbo-calc";

export const runtime = "nodejs";

/** Refus de saisie attendus : renvoyés tels quels, en 400. */
const REFUS = [
  "Date invalide",
  "Ajoutez au moins",
  "Trop de lignes",
  "Quantité invalide",
  "Article introuvable",
  "Test introuvable",
];

function resolveSite(raw: unknown, userSite: string): VenteSite {
  if (raw === "zogbo" || raw === "gbegamey") return raw;
  return userSite === "zogbo" ? "zogbo" : "gbegamey";
}

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date") || todayIsoDate();
    const scope = effectiveSite(user.role, user.site);
    const [tests, products] = await Promise.all([
      listTestsPlats({ date, site: scope === "tous" ? "all" : scope }),
      listTestProducts(),
    ]);
    return NextResponse.json({
      date,
      tests,
      products,
      allowedSites:
        scope === "tous" ? (["zogbo", "gbegamey"] as VenteSite[]) : [scope],
    });
  } catch (error) {
    if (error instanceof Error && REFUS.some((m) => error.message.startsWith(m))) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    reportError("GET /api/tests-plats", error);
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = (await request.json()) as {
      action?: "create" | "cancel";
      id?: string;
      date?: string;
      site?: VenteSite;
      lines?: { kind: TestPlatKind; productId: string; qty: number }[];
      objet?: string;
      observations?: string;
      testeur?: string;
    };
    if (containsMongoOperator(body)) {
      return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
    }
    const actor = { id: user.id, name: user.name };
    const scope = effectiveSite(user.role, user.site);

    if (body.action === "cancel") {
      if (!body.id) {
        return NextResponse.json({ error: "id requis." }, { status: 400 });
      }
      const entry = await cancelTestPlat({
        id: body.id,
        actor,
        site: scope === "tous" ? "all" : scope,
      });
      await logActivity({
        user,
        kind: "test_plat",
        title: "Annulation d’un test de plat",
        detail: entry.numero,
        date: entry.date,
        site: entry.site,
      });
      return NextResponse.json({ entry });
    }

    const site = resolveSite(body.site, user.site);
    if (!canUseSite(scope, site)) {
      return NextResponse.json({ error: "Site non autorisé." }, { status: 403 });
    }
    const entry = await recordTestPlat({
      date: body.date || todayIsoDate(),
      site,
      lines: body.lines ?? [],
      objet: body.objet,
      observations: body.observations,
      testeur: body.testeur,
      actor,
    });
    await logActivity({
      user,
      kind: "test_plat",
      title: "Test de plat enregistré",
      detail: `${entry.numero} · ${entry.lines.map((l) => `${l.qty} × ${l.name}`).join(", ")}`,
      date: entry.date,
      site: entry.site,
    });
    return NextResponse.json({ entry });
  } catch (error) {
    if (error instanceof Error && REFUS.some((m) => error.message.startsWith(m))) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    reportError("POST /api/tests-plats", error);
    return authErrorResponse(error);
  }
}
