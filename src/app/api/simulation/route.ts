import { NextResponse } from "next/server";
import { authErrorResponse, requireUser } from "@/lib/api-auth";
import { reportError } from "@/lib/report-error";
import {
  reinitialiserSimulation,
  supprimerSimulation,
} from "@/lib/simulation-repo";

export const runtime = "nodejs";

/**
 * Bac à sable de formation de l'utilisateur connecté.
 * POST {action:"reset"}  → recrée une base jetable (copie de référence).
 * POST {action:"drop"}   → la supprime.
 * L'accès à /api/simulation est déjà limité par le middleware aux comptes
 * qui ont la page Simulation.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = (await request.json().catch(() => ({}))) as { action?: unknown };
    if (body.action === "drop") {
      await supprimerSimulation(user.username);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "reset") {
      const res = await reinitialiserSimulation(user.username);
      return NextResponse.json({ ok: true, ...res });
    }
    return NextResponse.json({ error: "Action inconnue." }, { status: 400 });
  } catch (e) {
    reportError("POST /api/simulation", e);
    return authErrorResponse(e);
  }
}
