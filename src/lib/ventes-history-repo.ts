import { getDb } from "@/lib/mongodb";
import type { VenteSite } from "@/lib/types";
import { ObjectId } from "mongodb";

export type VenteHistoryStatut = "valide" | "annule" | "encours" | "all";
export type VenteHistorySource = "kingfish" | "aquapro" | "all";

export type VenteHistoryLine = {
  name: string;
  qty: number;
  unitPrice: number;
  amount: number;
};

export type VenteHistoryTicket = {
  id: string;
  source: "kingfish" | "aquapro";
  numero: string;
  date: string;
  at: string;
  site: VenteSite | "gbegamey";
  statut: "valide" | "annule" | "encours";
  statutLabel: string;
  typeVente: string;
  montant: number;
  reduction: number;
  paiement: string | null;
  serveur: string | null;
  caissier: string | null;
  client: string | null;
  table: string | null;
  lines: VenteHistoryLine[];
};

export type VenteHistoryFilters = {
  from: string;
  to: string;
  site?: "all" | VenteSite;
  statut?: VenteHistoryStatut;
  source?: VenteHistorySource;
  serveur?: string;
  paiement?: string;
  q?: string;
  limit?: number;
};

export type VenteHistoryResult = {
  tickets: VenteHistoryTicket[];
  totals: {
    count: number;
    montant: number;
    valide: number;
    annule: number;
    encours: number;
  };
  facets: {
    serveurs: string[];
    paiements: string[];
  };
};

function normStatutAqua(raw: string): {
  statut: VenteHistoryTicket["statut"];
  label: string;
} {
  const s = String(raw || "").toLowerCase();
  if (s.startsWith("annul")) return { statut: "annule", label: "Annulé" };
  if (s.includes("cours")) return { statut: "encours", label: "En cours" };
  return { statut: "valide", label: "Validé" };
}

function matchesText(hay: string, needle: string): boolean {
  return hay.toLowerCase().includes(needle.toLowerCase());
}

export async function listVentesHistory(
  filters: VenteHistoryFilters,
): Promise<VenteHistoryResult> {
  const from = filters.from;
  const to = filters.to;
  const limit = Math.min(500, Math.max(1, filters.limit ?? 200));
  const site = filters.site || "all";
  const statut = filters.statut || "all";
  const source = filters.source || "all";
  const q = (filters.q || "").trim();
  const serveurF = (filters.serveur || "").trim();
  const paiementF = (filters.paiement || "").trim();

  const db = await getDb();
  const dateMatch = { date: { $gte: from, $lte: to } };

  const tickets: VenteHistoryTicket[] = [];
  const serveurs = new Set<string>();
  const paiements = new Set<string>();

  if (source === "all" || source === "kingfish") {
    const kfFilter: Record<string, unknown> = { ...dateMatch };
    if (site !== "all") kfFilter.site = site;
    if (statut === "valide") kfFilter.statut = "valide";
    if (statut === "annule") kfFilter.statut = "annule";
    if (statut === "encours") kfFilter.statut = "__none__";

    const docs = await db
      .collection("pos_tickets")
      .find(kfFilter)
      .sort({ at: -1 })
      .limit(limit * 2)
      .toArray();

    for (const d of docs) {
      const st = d.statut === "annule" ? "annule" : "valide";
      const label = st === "annule" ? "Annulé" : "Validé";
      const serveur = (d.serveurNom as string) || null;
      const paiement = (d.paymentLabel as string) || null;
      if (serveur) serveurs.add(serveur);
      if (paiement) paiements.add(paiement);

      if (serveurF && (!serveur || !matchesText(serveur, serveurF))) continue;
      if (paiementF && (!paiement || !matchesText(paiement, paiementF))) continue;

      const lines: VenteHistoryLine[] = (d.lines || []).map(
        (l: {
          name?: string;
          qty?: number;
          unitPrice?: number;
          amount?: number;
        }) => ({
          name: String(l.name || ""),
          qty: Number(l.qty) || 0,
          unitPrice: Number(l.unitPrice) || 0,
          amount: Number(l.amount) || 0,
        }),
      );

      const ticket: VenteHistoryTicket = {
        id: `kf-${String(d._id)}`,
        source: "kingfish",
        numero: String(d.numero || ""),
        date: String(d.date),
        at: String(d.at || d.date),
        site: d.site as VenteSite,
        statut: st,
        statutLabel: label,
        typeVente: String(d.saleType || "Sur place"),
        montant: Number(d.montant) || 0,
        reduction: Number(d.reduction) || 0,
        paiement,
        serveur,
        caissier: (d.userName as string) || null,
        client: (d.clientNom as string) || null,
        table: (d.tableLabel as string) || null,
        lines,
      };

      if (q) {
        const blob = [
          ticket.numero,
          ticket.client,
          ticket.serveur,
          ticket.paiement,
          ...lines.map((l) => l.name),
        ]
          .filter(Boolean)
          .join(" ");
        if (!matchesText(blob, q)) continue;
      }

      tickets.push(ticket);
    }
  }

  if (source === "all" || source === "aquapro") {
    if (site === "all" || site === "gbegamey") {
      const aquaFilter: Record<string, unknown> = { ...dateMatch };
      const docs = await db
        .collection("aquapro_tickets")
        .find(aquaFilter)
        .sort({ at: -1 })
        .limit(limit * 2)
        .toArray();

      for (const d of docs) {
        const mapped = normStatutAqua(String(d.statut || ""));
        if (statut !== "all" && mapped.statut !== statut) continue;

        const serveur = (d.serveur as string) || null;
        const paiement = (d.paiement as string) || null;
        if (serveur) serveurs.add(serveur);
        if (paiement) paiements.add(paiement);

        if (serveurF && (!serveur || !matchesText(serveur, serveurF))) continue;
        if (paiementF && (!paiement || !matchesText(paiement, paiementF)))
          continue;

        const lines: VenteHistoryLine[] = (d.lignes || []).map(
          (l: {
            produit?: string;
            qty?: number;
            unitPrice?: number;
            amount?: number;
          }) => ({
            name: String(l.produit || ""),
            qty: Number(l.qty) || 0,
            unitPrice: Number(l.unitPrice) || 0,
            amount: Number(l.amount) || 0,
          }),
        );

        const ticket: VenteHistoryTicket = {
          id: `aqua-${String(d.aquaId ?? d._id)}`,
          source: "aquapro",
          numero: String(d.numero || ""),
          date: String(d.date),
          at: String(d.at || d.date),
          site: "gbegamey",
          statut: mapped.statut,
          statutLabel: mapped.label,
          typeVente: String(d.typeVente || "Sur place"),
          montant: Number(d.montant) || 0,
          reduction: Number(d.reduction) || 0,
          paiement,
          serveur,
          caissier: (d.caissier as string) || null,
          client: (d.nomclient as string) || null,
          table: (d.table as string) || null,
          lines,
        };

        if (q) {
          const blob = [
            ticket.numero,
            ticket.client,
            ticket.serveur,
            ticket.paiement,
            ticket.caissier,
            ...lines.map((l) => l.name),
          ]
            .filter(Boolean)
            .join(" ");
          if (!matchesText(blob, q)) continue;
        }

        tickets.push(ticket);
      }
    }
  }

  tickets.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const sliced = tickets.slice(0, limit);

  const totals = {
    count: sliced.length,
    montant: 0,
    valide: 0,
    annule: 0,
    encours: 0,
  };
  for (const t of sliced) {
    if (t.statut === "valide") {
      totals.montant += t.montant;
      totals.valide += 1;
    } else if (t.statut === "annule") totals.annule += 1;
    else totals.encours += 1;
  }

  return {
    tickets: sliced,
    totals,
    facets: {
      serveurs: [...serveurs].sort((a, b) => a.localeCompare(b, "fr")),
      paiements: [...paiements].sort((a, b) => a.localeCompare(b, "fr")),
    },
  };
}

export async function getVenteHistoryTicket(
  id: string,
): Promise<VenteHistoryTicket | null> {
  const db = await getDb();
  if (id.startsWith("kf-")) {
    const raw = id.slice(3);
    if (!ObjectId.isValid(raw)) return null;
    const d = await db.collection("pos_tickets").findOne({ _id: new ObjectId(raw) });
    if (!d) return null;
    const st = d.statut === "annule" ? "annule" : "valide";
    return {
      id,
      source: "kingfish",
      numero: String(d.numero || ""),
      date: String(d.date),
      at: String(d.at || d.date),
      site: d.site as VenteSite,
      statut: st,
      statutLabel: st === "annule" ? "Annulé" : "Validé",
      typeVente: String(d.saleType || "Sur place"),
      montant: Number(d.montant) || 0,
      reduction: Number(d.reduction) || 0,
      paiement: (d.paymentLabel as string) || null,
      serveur: (d.serveurNom as string) || null,
      caissier: (d.userName as string) || null,
      client: (d.clientNom as string) || null,
      table: (d.tableLabel as string) || null,
      lines: (d.lines || []).map(
        (l: {
          name?: string;
          qty?: number;
          unitPrice?: number;
          amount?: number;
        }) => ({
          name: String(l.name || ""),
          qty: Number(l.qty) || 0,
          unitPrice: Number(l.unitPrice) || 0,
          amount: Number(l.amount) || 0,
        }),
      ),
    };
  }
  if (id.startsWith("aqua-")) {
    const aquaId = Number(id.slice(5));
    if (!Number.isFinite(aquaId)) return null;
    const d = await db.collection("aquapro_tickets").findOne({ aquaId });
    if (!d) return null;
    const mapped = normStatutAqua(String(d.statut || ""));
    return {
      id,
      source: "aquapro",
      numero: String(d.numero || ""),
      date: String(d.date),
      at: String(d.at || d.date),
      site: "gbegamey",
      statut: mapped.statut,
      statutLabel: mapped.label,
      typeVente: String(d.typeVente || "Sur place"),
      montant: Number(d.montant) || 0,
      reduction: Number(d.reduction) || 0,
      paiement: (d.paiement as string) || null,
      serveur: (d.serveur as string) || null,
      caissier: (d.caissier as string) || null,
      client: (d.nomclient as string) || null,
      table: (d.table as string) || null,
      lines: (d.lignes || []).map(
        (l: {
          produit?: string;
          qty?: number;
          unitPrice?: number;
          amount?: number;
        }) => ({
          name: String(l.produit || ""),
          qty: Number(l.qty) || 0,
          unitPrice: Number(l.unitPrice) || 0,
          amount: Number(l.amount) || 0,
        }),
      ),
    };
  }
  return null;
}
