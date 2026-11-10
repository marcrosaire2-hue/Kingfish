import { NextResponse } from "next/server";
import { authErrorResponse, requireUser } from "@/lib/api-auth";
import { canUseSite, effectiveSite } from "@/lib/auth-types";
import { fichesPourCaisse } from "@/lib/magasin-repo";

export const runtime = "nodejs";

/** Compositions utiles à la caisse pour déclarer un manque ou un supplément. */
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const site = new URL(request.url).searchParams.get("site");
    if (site !== "gbegamey" && site !== "zogbo") {
      return NextResponse.json({ error: "Site invalide." }, { status: 400 });
    }
    if (!canUseSite(effectiveSite(user.role, user.site), site)) {
      return NextResponse.json({ error: "Site non autorisé." }, { status: 403 });
    }
    return NextResponse.json({ fiches: await fichesPourCaisse(site) });
  } catch (error) {
    return authErrorResponse(error);
  }
}
