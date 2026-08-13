import { NextResponse } from "next/server";
import { authErrorResponse, requireAdmin } from "@/lib/api-auth";
import {
  getPilotageGlobal,
  type PilotageType,
} from "@/lib/pilotage-global-repo";
import type { VenteSite } from "@/lib/types";
import { previousIsoDate, shiftIsoDate, todayIsoDate } from "@/lib/zogbo-calc";

export const runtime = "nodejs";

const TYPES: PilotageType[] = [
  "vente",
  "caisse",
  "achat",
  "perte",
  "zogbo",
  "gbegamey",
  "stock",
  "transfert",
  "reprise",
  "autre",
];

/** Traduit un préréglage de période en bornes YYYY-MM-DD. */
function resolvePeriod(preset: string | null, from: string | null, to: string | null) {
  const today = todayIsoDate();
  if (preset === "custom" && from && to) return { from, to };
  switch (preset) {
    case "hier": {
      const y = previousIsoDate(today) ?? today;
      return { from: y, to: y };
    }
    case "semaine": {
      const jour = new Date(`${today}T12:00:00`).getDay(); // 0 = dimanche
      const decalage = jour === 0 ? 6 : jour - 1; // lundi = début de semaine
      return { from: shiftIsoDate(today, -decalage) ?? today, to: today };
    }
    case "mois":
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case "annee":
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case "tout":
      // Le début réel des activités est plus tardif, mais une borne fixe et
      // large évite de la recalculer : le filtre `from` n'a besoin que
      // d'être « avant tout » pour ce que la base contient aujourd'hui.
      return { from: "2020-01-01", to: today };
    case "aujourdhui":
    default:
      return { from: today, to: today };
  }
}

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const { searchParams } = new URL(request.url);
    const { from, to } = resolvePeriod(
      searchParams.get("periode"),
      searchParams.get("from"),
      searchParams.get("to"),
    );
    const siteRaw = searchParams.get("site");
    const site: VenteSite | null =
      siteRaw === "zogbo" || siteRaw === "gbegamey" ? siteRaw : null;
    const typeRaw = searchParams.get("type");
    const type: PilotageType | null = TYPES.includes(typeRaw as PilotageType)
      ? (typeRaw as PilotageType)
      : null;
    const q = searchParams.get("q");

    const payload = await getPilotageGlobal({ from, to, site, type, q });
    return NextResponse.json(payload);
  } catch (error) {
    // Refus métier (période invalide) : le message doit atteindre l'écran,
    // pas être avalé par la réponse générique 500.
    if (error instanceof Error && error.message === "Période invalide.") {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return authErrorResponse(error);
  }
}
