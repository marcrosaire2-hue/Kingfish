import { getDb } from "@/lib/mongodb";
import type { VenteKind, VenteSite } from "@/lib/types";
import { ObjectId } from "mongodb";

export type VenteHistoryStatut = "valide" | "annule" | "encours" | "all";
export type VenteHistorySource = "kingfish" | "aquapro" | "all";

export type VenteHistoryLine = {
  name: string;
  qty: number;
  unitPrice: number;
  amount: number;
  /** Absent pour les lignes importées (AquaPro) : aucune catégorie fiable
   *  n'y est associée côté source. */
  kind?: VenteKind;
  /** id ventes_log — présent sur les tickets King Fish pour correction. */
  venteLogId?: string | null;
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
  /**
   * id réel du ticket POS (pos_tickets), pour l'annuler — `null` pour les
   * tickets synthétisés depuis ventes_log (carnets, devis, imports), qui
   * peuvent regrouper plusieurs documents indépendants sans identifiant
   * d'annulation unique.
   */
  ticketId: string | null;
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
  /** "all" = toutes les ventes (export Excel), sinon nombre (plafonné à 500) */
  limit?: number | "all";
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

type VentesLogRow = {
  _id: ObjectId;
  date: string;
  site: VenteSite;
  kind?: VenteKind;
  name?: string;
  qty?: number;
  unitPrice?: number;
  amount?: number;
  at?: string;
  cancelledAt?: string | null;
  caExcluded?: boolean;
  source?: string | null;
  actorName?: string | null;
  ticketId?: string | null;
  posTicketId?: string | null;
};

function journalSourceLabel(source: string | null | undefined): string {
  const s = String(source || "journal").trim();
  if (!s || s === "journal") return "Journal";
  return s
    .replace(/^carnet-/i, "Carnet ")
    .replace(/^devis-/i, "Devis ")
    .replace(/-/g, " ");
}

/**
 * Tickets synthétiques depuis `ventes_log` (ventes caisse, carnets, devis…).
 * Exclut les lignes AquaPro déjà couvertes par `aquapro_tickets`.
 */
function ticketsFromVentesLog(
  docs: VentesLogRow[],
  filters: {
    statut: VenteHistoryStatut;
    q: string;
    serveurF: string;
    paiementF: string;
  },
): VenteHistoryTicket[] {
  const { statut, q, serveurF, paiementF } = filters;
  const groups = new Map<string, VentesLogRow[]>();

  for (const d of docs) {
    if (d.caExcluded === true) continue;
    const cancelled = !!d.cancelledAt;
    if (statut === "valide" && cancelled) continue;
    if (statut === "annule" && !cancelled) continue;
    if (statut === "encours") continue;

    const src = String(d.source || "journal");
    if (/^aquapro/i.test(src)) continue;

    const key = d.ticketId
      ? `ticket:${d.ticketId}:${cancelled ? "x" : "ok"}`
      : d.posTicketId
        ? `pos:${d.posTicketId}:${cancelled ? "x" : "ok"}`
        : `src:${d.date}|${d.site}|${src}|${cancelled ? "x" : "ok"}`;

    const list = groups.get(key);
    if (list) list.push(d);
    else groups.set(key, [d]);
  }

  const out: VenteHistoryTicket[] = [];
  for (const [key, rows] of groups) {
    rows.sort((a, b) => String(a.at).localeCompare(String(b.at)));
    const first = rows[0]!;
    const cancelled = !!first.cancelledAt;
    const st: VenteHistoryTicket["statut"] = cancelled ? "annule" : "valide";
    const lines: VenteHistoryLine[] = rows.map((r) => ({
      name: String(r.name || ""),
      qty: Number(r.qty) || 0,
      unitPrice: Number(r.unitPrice) || 0,
      amount: Number(r.amount) || 0,
      kind: r.kind,
    }));
    const montant = lines.reduce((s, l) => s + l.amount, 0);
    const serveur = first.actorName || null;
    const srcLabel = journalSourceLabel(first.source);
    const ticket: VenteHistoryTicket = {
      id: `vl-${key.replace(/[^a-zA-Z0-9._|-]+/g, "_").slice(0, 96)}`,
      source: "kingfish",
      numero: first.ticketId
        ? String(first.ticketId)
        : `${srcLabel} · ${first.date}`,
      date: String(first.date),
      at: String(first.at || first.cancelledAt || first.date),
      site: first.site,
      statut: st,
      statutLabel: cancelled ? "Annulé" : "Validé",
      typeVente: srcLabel,
      montant,
      reduction: 0,
      paiement: null,
      serveur,
      caissier: serveur,
      client: null,
      table: null,
      lines,
      ticketId: null,
    };

    if (serveurF && (!serveur || !matchesText(serveur, serveurF))) continue;
    if (paiementF) continue;

    if (q) {
      const blob = [
        ticket.numero,
        ticket.typeVente,
        ticket.serveur,
        ...lines.map((l) => l.name),
      ]
        .filter(Boolean)
        .join(" ");
      if (!matchesText(blob, q)) continue;
    }

    out.push(ticket);
  }
  return out;
}

export async function listVentesHistory(
  filters: VenteHistoryFilters,
): Promise<VenteHistoryResult> {
  const from = filters.from;
  const to = filters.to;
  const all = filters.limit === "all";
  const limit = Math.min(
    500,
    Math.max(1, typeof filters.limit === "number" ? filters.limit : 200),
  );
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
      .limit(all ? 0 : limit * 2)
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
          kind?: VenteKind;
          name?: string;
          qty?: number;
          unitPrice?: number;
          amount?: number;
          venteLogId?: string | null;
        }) => ({
          name: String(l.name || ""),
          qty: Number(l.qty) || 0,
          unitPrice: Number(l.unitPrice) || 0,
          amount: Number(l.amount) || 0,
          kind: l.kind,
          venteLogId: l.venteLogId ? String(l.venteLogId) : null,
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
        ticketId: String(d._id),
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

    // Journal King Fish (ventes_log) : carnets, devis, ventes caisse…
    // Les lignes des tickets POS sont aussi écrites dans ventes_log (avec un
    // venteLogId dans le ticket) : les exclure, sinon chaque vente POS est
    // comptée deux fois — une fois comme ticket POS, une fois comme journal.
    const posLogIds = await db
      .collection("pos_tickets")
      .aggregate<{ _id: string }>([
        { $match: kfFilter },
        { $unwind: { path: "$lines", preserveNullAndEmptyArrays: false } },
        { $match: { "lines.venteLogId": { $ne: null } } },
        { $group: { _id: "$lines.venteLogId" } },
      ])
      .toArray();

    const vlFilter: Record<string, unknown> = {
      ...dateMatch,
      caExcluded: { $ne: true },
    };
    if (site !== "all") vlFilter.site = site;
    if (posLogIds.length > 0) {
      vlFilter._id = {
        $nin: posLogIds
          .map((r) => r._id)
          .filter(Boolean)
          .map((id) => new ObjectId(id)),
      };
    }

    const vlDocs = (await db
      .collection("ventes_log")
      .find(vlFilter)
      .sort({ at: -1 })
      .limit(all ? 0 : Math.min(5000, limit * 40))
      .toArray()) as VentesLogRow[];

    for (const t of ticketsFromVentesLog(vlDocs, {
      statut,
      q,
      serveurF,
      paiementF,
    })) {
      if (t.serveur) serveurs.add(t.serveur);
      tickets.push(t);
    }
  }

  if (source === "all" || source === "aquapro") {
    if (site === "all" || site === "gbegamey") {
      const aquaFilter: Record<string, unknown> = { ...dateMatch };
      const docs = await db
        .collection("aquapro_tickets")
        .find(aquaFilter)
        .sort({ at: -1 })
        .limit(all ? 0 : limit * 2)
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
          ticketId: null,
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
  const sliced = all ? tickets : tickets.slice(0, limit);

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

export type JournalVenteLine = {
  at: string;
  date: string;
  numero: string;
  site: VenteSite | "gbegamey";
  statut: "valide" | "annule" | "encours";
  statutLabel: string;
  source: "kingfish" | "aquapro";
  typeVente: string;
  serveur: string | null;
  paiement: string | null;
  client: string | null;
  table: string | null;
  produit: string;
  kind?: VenteKind;
  qty: number;
  unitPrice: number;
  montant: number;
  /** id du ticket POS pour annulation — `null` si non annulable d'ici. */
  ticketId: string | null;
};

export type JournalVenteDay = {
  date: string;
  lines: JournalVenteLine[];
  nbTickets: number;
  nbLignes: number;
  montant: number;
};

export type JournalVenteResult = {
  days: JournalVenteDay[];
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

/**
 * Journal des ventes détaillé : une ligne par produit vendu, groupée par
 * jour. Réutilise la synthèse de tickets puis aplatit les lignes.
 */
export async function listJournalVentes(
  filters: Omit<VenteHistoryFilters, "limit"> & { limit?: number | "all" },
): Promise<JournalVenteResult> {
  const result = await listVentesHistory({ ...filters, limit: "all" });

  const byDay = new Map<string, JournalVenteDay>();
  for (const t of result.tickets) {
    if (!t.lines.length) continue;
    let day = byDay.get(t.date);
    if (!day) {
      day = { date: t.date, lines: [], nbTickets: 0, nbLignes: 0, montant: 0 };
      byDay.set(t.date, day);
    }
    day.nbTickets += 1;
    for (const l of t.lines) {
      day.lines.push({
        at: t.at,
        date: t.date,
        numero: t.numero,
        site: t.site,
        statut: t.statut,
        statutLabel: t.statutLabel,
        source: t.source,
        typeVente: t.typeVente,
        serveur: t.serveur,
        paiement: t.paiement,
        client: t.client,
        table: t.table,
        produit: l.name,
        kind: l.kind,
        qty: l.qty,
        unitPrice: l.unitPrice,
        montant: l.amount,
        ticketId: t.ticketId,
      });
      day.nbLignes += 1;
      if (t.statut === "valide") day.montant += l.amount;
    }
  }

  const days = [...byDay.values()].sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
  );

  const totals = { count: 0, montant: 0, valide: 0, annule: 0, encours: 0 };
  for (const d of days) {
    totals.count += d.nbTickets;
    totals.montant += d.montant;
  }
  for (const t of result.tickets) {
    if (t.statut === "valide") totals.valide += 1;
    else if (t.statut === "annule") totals.annule += 1;
    else totals.encours += 1;
  }

  return { days, totals, facets: result.facets };
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
      ticketId: raw,
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
      ticketId: null,
    };
  }
  return null;
}
