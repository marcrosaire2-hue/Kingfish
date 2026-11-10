import { NextResponse } from "next/server";
import { canUseSite, effectiveSite, type SessionUser } from "@/lib/auth-types";
import { magasinActif } from "@/lib/magasin-calc";
import type { VenteSite } from "@/lib/types";

type SiteResolu =
  | { ok: true; site: VenteSite }
  | { ok: false; response: NextResponse };

/** Site demandé, s'il a le magasin et si le compte y a droit. */
export function resoudreSiteMagasin(
  user: SessionUser,
  demande: string | null,
): SiteResolu {
  const site = demande || "gbegamey";
  if ((site !== "gbegamey" && site !== "zogbo") || !magasinActif(site)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Le magasin n'est pas encore ouvert sur ce site." },
        { status: 400 },
      ),
    };
  }
  if (!canUseSite(effectiveSite(user.role, user.site), site)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Site non autorisé." }, { status: 403 }),
    };
  }
  return { ok: true, site };
}
