/**
 * Flux live des ventes POS pour l’espace admin (polling).
 */
import { ObjectId } from "mongodb";
import { effectiveSite, isGlobalAdmin, type SessionUser } from "@/lib/auth-types";
import { getDb } from "@/lib/mongodb";
import type { VenteSite } from "@/lib/types";
import type { VenteLiveEvent, VentesLiveBoard } from "@/lib/ventes-live-types";

export type { VenteLiveEvent, VentesLiveBoard } from "@/lib/ventes-live-types";

type TicketDoc = {
  _id: ObjectId;
  at: string;
  date: string;
  site: VenteSite;
  numero: string;
  montant?: number;
  statut?: string;
  lines?: unknown[];
  serveurNom?: string | null;
  userName?: string;
  saleType?: string;
  paymentLabel?: string | null;
};

function toEvent(doc: TicketDoc): VenteLiveEvent {
  return {
    id: doc._id.toHexString(),
    at: doc.at,
    date: doc.date,
    site: doc.site,
    numero: doc.numero,
    montant: Number(doc.montant) || 0,
    nbLignes: Array.isArray(doc.lines) ? doc.lines.length : 0,
    serveurNom: doc.serveurNom ?? null,
    userName: doc.userName ?? "—",
    saleType: doc.saleType ?? "—",
    paymentLabel: doc.paymentLabel ?? null,
  };
}

function siteFilterForAdmin(admin: SessionUser): VenteSite | null {
  if (isGlobalAdmin(admin)) return null;
  const zone = effectiveSite(admin.role, admin.site);
  if (zone === "tous") return null;
  if (zone === "zogbo" || zone === "gbegamey") return zone;
  return null;
}

/**
 * Tickets validés récents. `since` = ISO exclusif (nouveautés strictement après).
 * Sans `since`, renvoie les derniers tickets (baseline, sans « nouveauté »).
 */
export async function getVentesLiveBoard(
  admin: SessionUser,
  options?: { since?: string | null; limit?: number },
): Promise<VentesLiveBoard> {
  const limit = Math.min(Math.max(options?.limit ?? 30, 1), 80);
  const since = options?.since?.trim() || null;
  const site = siteFilterForAdmin(admin);

  const filter: Record<string, unknown> = { statut: "valide" };
  if (site) filter.site = site;
  if (since) filter.at = { $gt: since };

  const db = await getDb();
  const docs = (await db
    .collection("pos_tickets")
    .find(filter)
    .project({
      at: 1,
      date: 1,
      site: 1,
      numero: 1,
      montant: 1,
      lines: 1,
      serveurNom: 1,
      userName: 1,
      saleType: 1,
      paymentLabel: 1,
    })
    .sort({ at: -1 })
    .limit(limit)
    .toArray()) as TicketDoc[];

  return {
    events: docs.map(toEvent),
    serverTime: new Date().toISOString(),
  };
}
