import { NextResponse } from "next/server";
import { authErrorResponse, requireUser } from "@/lib/api-auth";
import { canUseSite, resolveUserSiteScope } from "@/lib/auth-types";
import {
  listHistorique,
  type HistoriqueKind,
} from "@/lib/historique-repo";
import { listUsers } from "@/lib/users-repo";
import type { VenteSite } from "@/lib/types";

export const runtime = "nodejs";

const KINDS: Array<HistoriqueKind | "all"> = [
  "all",
  "vente",
  "vente_annulee",
  "transfert",
  "zogbo",
  "gbegamey",
  "boissons",
  "parametres",
  "charges",
  "user",
  "caisse",
  "pos",
  "matieres",
  "immobilisations",
  "pertes",
  "versements",
  "reprise",
  "connexion",
];

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const from = searchParams.get("from") || undefined;
    const to = searchParams.get("to") || undefined;
    const kindRaw = (searchParams.get("kind") || "all") as HistoriqueKind | "all";
    const siteRaw = (searchParams.get("site") || "all") as VenteSite | "all";
    const actorId = searchParams.get("actorId") || undefined;
    const q = searchParams.get("q") || undefined;
    const limit = Number(searchParams.get("limit") || "200");

    if (!KINDS.includes(kindRaw)) {
      return NextResponse.json({ error: "Type invalide." }, { status: 400 });
    }
    if (siteRaw !== "all" && siteRaw !== "zogbo" && siteRaw !== "gbegamey") {
      return NextResponse.json({ error: "Site invalide." }, { status: 400 });
    }
    if (siteRaw !== "all" && !canUseSite(user.site, siteRaw)) {
      return NextResponse.json({ error: "Site non autorisé." }, { status: 403 });
    }

    const scope = resolveUserSiteScope(user.site);
    const site: VenteSite | "all" = scope ?? siteRaw;

    const [result, users] = await Promise.all([
      listHistorique({
        from,
        to,
        kind: kindRaw,
        site,
        actorId,
        q,
        limit: Number.isFinite(limit) ? limit : 200,
      }),
      listUsers().catch(() => []),
    ]);

    const actors = users
      .filter((u) => u.active)
      .filter((u) => {
        if (user.site === "tous") return true;
        return u.site === user.site || u.site === "tous" || u.id === user.id;
      })
      .map((u) => ({
        id: u.id,
        name: u.name,
        username: u.username,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "fr"));

    return NextResponse.json({
      ...result,
      actors,
      lockedSite: user.site !== "tous",
      allowedSites:
        user.site === "tous"
          ? (["zogbo", "gbegamey"] as const)
          : ([user.site] as const),
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
