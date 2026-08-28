import { ObjectId } from "mongodb";
import { isoDateInTimeZone, isBackdatedRecord } from "@/lib/datetime-fr";
import { getDb } from "@/lib/mongodb";
import type { VenteKind, VenteSite } from "@/lib/types";

export type RegularisationLine = {
  id: string;
  at: string;
  businessDate: string;
  saisiTardif: boolean;
  name: string;
  kind: VenteKind;
  qty: number;
  unitPrice: number;
  amount: number;
  actorName: string | null;
  actorUsername: string | null;
  ticketNumero: string | null;
  ticketId: string | null;
  statut: "valide" | "annule";
  statutLabel: string;
};

export type RegularisationTicket = {
  id: string;
  numero: string;
  at: string;
  businessDate: string;
  saisiTardif: boolean;
  montant: number;
  saleType: string;
  userName: string | null;
  statut: "valide" | "annule";
  statutLabel: string;
  lines: Array<{
    name: string;
    qty: number;
    unitPrice: number;
    amount: number;
    kind?: VenteKind;
    venteLogId?: string | null;
  }>;
};

export type RegularisationReport = {
  date: string;
  site: VenteSite;
  tickets: RegularisationTicket[];
  lines: RegularisationLine[];
  totals: {
    tickets: number;
    ticketsValides: number;
    lignes: number;
    montantValide: number;
    saisiTardif: { tickets: number; lignes: number; montant: number };
  };
};

const KIND_LABELS: Record<VenteKind, string> = {
  plat: "Plat",
  local: "Accompagnement",
  boisson: "Boisson",
  combo: "Combo",
  extra: "Extra",
};

export function kindLabel(kind: VenteKind | string): string {
  return KIND_LABELS[kind as VenteKind] ?? String(kind);
}

export async function buildRegularisationReport(
  date: string,
  site: VenteSite,
): Promise<RegularisationReport> {
  const db = await getDb();

  const ticketDocs = await db
    .collection("pos_tickets")
    .find({ date, site })
    .sort({ at: 1 })
    .toArray();

  const logDocs = await db
    .collection("ventes_log")
    .find({ date, site, caExcluded: { $ne: true } })
    .sort({ at: 1 })
    .toArray();

  const ticketByLogId = new Map<string, { numero: string; id: string }>();
  for (const t of ticketDocs) {
    for (const l of (t.lines as Array<{ venteLogId?: string | null }>) || []) {
      if (l.venteLogId) {
        ticketByLogId.set(String(l.venteLogId), {
          numero: String(t.numero || ""),
          id: String(t._id),
        });
      }
    }
  }

  const lines: RegularisationLine[] = logDocs.map((d) => {
    const id = String(d._id);
    const ticket = ticketByLogId.get(id);
    const cancelled = Boolean(d.cancelledAt);
    const at = cancelled ? String(d.cancelledAt) : String(d.at);
    return {
      id,
      at,
      businessDate: String(d.date),
      saisiTardif: isBackdatedRecord(String(d.date), at),
      name: String(d.name || ""),
      kind: d.kind as VenteKind,
      qty: Number(d.qty) || 0,
      unitPrice: Number(d.unitPrice) || 0,
      amount: Number(d.amount) || 0,
      actorName: cancelled
        ? ((d.cancelledByName as string) ?? (d.actorName as string) ?? null)
        : ((d.actorName as string) ?? null),
      actorUsername: cancelled
        ? ((d.cancelledByUsername as string) ??
          (d.actorUsername as string) ??
          null)
        : ((d.actorUsername as string) ?? null),
      ticketNumero: ticket?.numero ?? null,
      ticketId: ticket?.id ?? null,
      statut: cancelled ? "annule" : "valide",
      statutLabel: cancelled ? "Annulé" : "Validé",
    };
  });

  const tickets: RegularisationTicket[] = ticketDocs.map((t) => {
    const businessDate = String(t.date);
    const at = String(t.at || t.date);
    const annule = t.statut === "annule";
    return {
      id: String(t._id),
      numero: String(t.numero || ""),
      at,
      businessDate,
      saisiTardif: isBackdatedRecord(businessDate, at),
      montant: Number(t.montant) || 0,
      saleType: String(t.saleType || "Sur place"),
      userName: (t.userName as string) ?? null,
      statut: annule ? "annule" : "valide",
      statutLabel: annule ? "Annulé" : "Validé",
      lines: ((t.lines as Array<{
        name?: string;
        qty?: number;
        unitPrice?: number;
        amount?: number;
        kind?: VenteKind;
        venteLogId?: string | null;
      }>) || []).map((l) => ({
        name: String(l.name || ""),
        qty: Number(l.qty) || 0,
        unitPrice: Number(l.unitPrice) || 0,
        amount: Number(l.amount) || 0,
        kind: l.kind,
        venteLogId: l.venteLogId ? String(l.venteLogId) : null,
      })),
    };
  });

  const ticketsValides = tickets.filter((t) => t.statut === "valide");
  const lignesValides = lines.filter((l) => l.statut === "valide");
  const saisiTardifTickets = ticketsValides.filter((t) => t.saisiTardif);
  const saisiTardifLines = lignesValides.filter((l) => l.saisiTardif);

  return {
    date,
    site,
    tickets,
    lines,
    totals: {
      tickets: tickets.length,
      ticketsValides: ticketsValides.length,
      lignes: lignesValides.length,
      montantValide: ticketsValides.reduce((s, t) => s + t.montant, 0),
      saisiTardif: {
        tickets: saisiTardifTickets.length,
        lignes: saisiTardifLines.length,
        montant: saisiTardifTickets.reduce((s, t) => s + t.montant, 0),
      },
    },
  };
}

/** Jour calendaire de la saisie (fuseau restaurant). */
export function recordedDay(iso: string): string {
  return isoDateInTimeZone(iso);
}
