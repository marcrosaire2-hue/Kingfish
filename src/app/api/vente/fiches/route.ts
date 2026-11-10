import { NextResponse } from "next/server";
import { authErrorResponse, requireUser } from "@/lib/api-auth";
import { canUseSite, effectiveSite } from "@/lib/auth-types";
import { fichesPourCaisse, supplementsPourCaisse } from "@/lib/magasin-repo";

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
    const [fiches, supplements] = await Promise.all([
      fichesPourCaisse(site),
      supplementsPourCaisse(site),
    ]);
    return NextResponse.json({ fiches, supplements });
  } catch (error) {
    return authErrorResponse(error);
  }
}
