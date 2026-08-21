import { ObjectId } from "mongodb";
import {
  canManagePastVentes,
  effectiveShift,
  type SessionUser,
} from "@/lib/auth-types";
import {
  adjustCaisseVenteAmount,
  addCaisseVenteAmount,
  findCaisseSessionForSiteDate,
  getActiveCaisseForSite,
  getCaisseById,
} from "@/lib/caisse-repo";
import { getDb } from "@/lib/mongodb";
import { getPosConfig } from "@/lib/pos-config-repo";
import {
  assertSameTeamCancellation,
  getVenteBoard,
  recordExtraVente,
  recordVente,
  undoVente,
} from "@/lib/vente-repo";
import { todayIsoDate } from "@/lib/zogbo-calc";
import type {
  PosTicket,
  PosTicketLine,
  SaleType,
  VenteKind,
  VenteSite,
} from "@/lib/types";

type TicketDoc = Omit<PosTicket, "id"> & {
  _id: ObjectId;
  /**
   * Référence produite par le poste de vente. Une vente encaissée hors ligne
   * puis rejouée porte la même référence : elle sert de clé d'idempotence pour
   * ne pas encaisser deux fois la même commande.
   */
  clientRef?: string | null;
};

function toTicket(doc: TicketDoc): PosTicket {
  return {
    id: doc._id.toHexString(),
    numero: doc.numero,
    date: doc.date,
    site: doc.site,
    statut: doc.statut,
    saleType: doc.saleType,
    caisseId: doc.caisseId,
    paymentMethodId: doc.paymentMethodId,
    paymentLabel: doc.paymentLabel,
    tableId: doc.tableId,
    tableLabel: doc.tableLabel,
    serveurId: doc.serveurId,
    serveurNom: doc.serveurNom,
    clientNom: doc.clientNom,
    reduction: Number(doc.reduction) || 0,
    lines: doc.lines ?? [],
    montantBrut: Number(doc.montantBrut) || 0,
    montant: Number(doc.montant) || 0,
    userId: doc.userId,
    userName: doc.userName,
    shift: doc.shift,
    at: doc.at,
    cancelledAt: doc.cancelledAt ?? null,
  };
}

type CounterDoc = { _id: string; count: number };

export function formatTicketNumero(date: string, count: number): string {
  return `T-${date.replace(/-/g, "").slice(2)}-${String(count).padStart(3, "0")}`;
}

/**
 * Compteur atomique par jour : deux validations simultanées (Zogbo et
 * Gbégamey encaissent en parallèle) ne peuvent pas lire le même total avant
 * d'écrire, contrairement à un `countDocuments` suivi d'une insertion — la
 * fenêtre entre lecture et écriture y permettait un doublon de numéro.
 */
async function nextNumero(date: string): Promise<string> {
  const db = await getDb();
  const doc = await db
    .collection<CounterDoc>("pos_counters")
    .findOneAndUpdate(
      { _id: date },
      { $inc: { count: 1 } },
      { upsert: true, returnDocument: "after" },
    );
  return formatTicketNumero(date, doc?.count ?? 1);
}

export async function listTickets(input: {
  date: string;
  site: VenteSite;
  limit?: number;
}): Promise<PosTicket[]> {
  const db = await getDb();
  const docs = await db
    .collection<TicketDoc>("pos_tickets")
    .find({ date: input.date, site: input.site })
    .sort({ at: -1 })
    .limit(Math.min(100, input.limit ?? 30))
    .toArray();
  return docs.map(toTicket);
}

export async function validatePosTicket(input: {
  date: string;
  site: VenteSite;
  user: SessionUser;
  saleType: SaleType;
  paymentMethodId?: string | null;
  tableId?: string | null;
  serveurId?: string | null;
  clientNom?: string | null;
  reduction?: number;
  /** Référence du poste de vente, pour les ventes rejouées après coupure. */
  clientRef?: string | null;
  lines: Array<{
    kind: VenteKind;
    productId: string;
    name?: string;
    qty: number;
    unitPrice?: number;
  }>;
}): Promise<{
  ticket: PosTicket;
  board: Awaited<ReturnType<typeof getVenteBoard>>;
  caisseId: string | null;
}> {
  if (!input.lines.length) throw new Error("Panier vide");

  // Vente rejouée après une coupure : si elle a déjà abouti, on renvoie le
  // ticket existant au lieu d'en créer un second. La déduplication se fait
  // par référence de poste ET site — une référence d'un autre point ne peut
  // pas absorber la vente de celui-ci.
  if (input.clientRef) {
    const db = await getDb();
    const existant = await db
      .collection<TicketDoc>("pos_tickets")
      .findOne({ clientRef: input.clientRef, site: input.site });
    if (existant) {
      return {
        ticket: toTicket(existant),
        board: await getVenteBoard(existant.date, existant.site),
        caisseId: existant.caisseId,
      };
    }
  }

  const actor = {
    id: input.user.id,
    name: input.user.name,
    username: input.user.username,
    shift: input.user.shift,
  };

  const today = todayIsoDate();
  const isBackdate =
    canManagePastVentes(input.user.role) &&
    Boolean(input.date) &&
    input.date < today;

  let date: string;
  let caisseId: string | null = null;
  let creditCaisseOpen = false;
  const bypassClosedDay = isBackdate;

  if (isBackdate) {
    // Correction d'un jour passé : stock + journal sur la date choisie,
    // sans exiger la caisse ouverte aujourd'hui.
    date = input.date;
    const pastSession = await findCaisseSessionForSiteDate(input.site, date);
    caisseId = pastSession?.id ?? null;
  } else {
    // La caisse est celle de la zone : tout l'encaissé du point tombe dedans.
    const caisse = await getActiveCaisseForSite(input.site);
    if (!caisse) {
      throw new Error(
        "Ouvrez la caisse de la zone avant de valider une commande.",
      );
    }
    // Jour de service = date d'ouverture de la caisse, pas le calendrier.
    date = caisse.date;
    caisseId = caisse.id;
    creditCaisseOpen = true;
  }

  const config = await getPosConfig();
  const payment = input.paymentMethodId
    ? config.paymentMethods.find((p) => p.id === input.paymentMethodId)
    : config.paymentMethods[0] ?? null;
  const table = input.tableId
    ? config.tables.find((t) => t.id === input.tableId)
    : null;
  const serveur = input.serveurId
    ? config.serveurs.find((s) => s.id === input.serveurId)
    : null;

  const saleType = input.saleType || "Sur place";

  const reductionRaw = Math.round(Number(input.reduction) || 0);
  // Réduction = argent qui sort de la caisse : réservée au gérant et à
  // l'administrateur. Contrôlé AVANT la moindre écriture — refuser plus tard
  // laisserait des lignes vendues (stock déduit, CA gonflé) sans ticket.
  if (reductionRaw > 0 && !["gerant", "admin"].includes(input.user.role)) {
    throw new Error("Réduction réservée au gérant ou à l'administrateur.");
  }

  const createdLogIds: string[] = [];
  const ticketLines: PosTicketLine[] = [];

  /** Reprend les lignes déjà vendues quand le ticket n'aboutit pas. */
  async function reprendreLignes() {
    for (const id of [...createdLogIds].reverse()) {
      try {
        await undoVente({
          id,
          date,
          site: input.site,
          actor,
          bypassClosedDay,
          bypassTeam: isBackdate,
        });
      } catch {
        /* best effort rollback */
      }
    }
  }

  try {
    for (const line of input.lines) {
      const qty = Math.round(Number(line.qty) || 0);
      if (qty <= 0) continue;

      if (line.kind === "extra") {
        const result = await recordExtraVente({
          date,
          site: input.site,
          description: line.name || line.productId || "Extra",
          unitPrice: Math.round(Number(line.unitPrice) || 0),
          qty,
          actor,
        });
        createdLogIds.push(result.entry.id);
        ticketLines.push({
          kind: "extra",
          productId: result.entry.productId,
          name: result.entry.name,
          qty: result.entry.qty,
          unitPrice: result.entry.unitPrice,
          amount: result.entry.amount,
          venteLogId: result.entry.id,
        });
      } else {
        const result = await recordVente({
          date,
          site: input.site,
          kind: line.kind,
          productId: line.productId,
          qty,
          unitPrice: line.unitPrice,
          actor,
          bypassClosedDay,
          bypassStock: isBackdate,
        });
        createdLogIds.push(result.entry.id);
        ticketLines.push({
          kind: line.kind,
          productId: line.productId,
          name: result.entry.name,
          qty,
          unitPrice: result.entry.unitPrice,
          amount: result.entry.amount,
          venteLogId: result.entry.id,
        });
      }
    }
  } catch (error) {
    await reprendreLignes();
    throw error;
  }

  if (!ticketLines.length) throw new Error("Aucune ligne valide");

  const montantBrut = ticketLines.reduce((s, l) => s + l.amount, 0);
  const reduction = reductionRaw > 0 ? Math.min(montantBrut, reductionRaw) : 0;
  const montant = montantBrut - reduction;
  const now = new Date().toISOString();

  // Le ticket lui-même : tant qu'il n'est pas écrit et la caisse créditée, les
  // lignes vendues n'ont aucune commande en face — le moindre échec ici doit
  // les reprendre, sinon le stock et le CA du jour partent en vrille.
  const db = await getDb();
  let doc: TicketDoc | null = null;
  try {
    doc = {
      _id: new ObjectId(),
      numero: await nextNumero(date),
      date,
      site: input.site,
      statut: "valide",
      saleType,
      caisseId,
      paymentMethodId: payment?.id ?? null,
      paymentLabel: payment?.libelle ?? null,
      tableId: table?.id ?? null,
      tableLabel: table
        ? `${table.reference} · ${table.emplacement}`
        : null,
      serveurId: serveur?.id ?? null,
      serveurNom: serveur?.nom ?? null,
      clientNom: input.clientNom?.trim() || null,
      reduction,
      lines: ticketLines,
      montantBrut,
      montant,
      userId: input.user.id,
      userName: input.user.name,
      shift: effectiveShift(input.user.shift),
      at: now,
      cancelledAt: null,
      clientRef: input.clientRef ?? null,
    };

    await db.collection<TicketDoc>("pos_tickets").insertOne(doc);
    if (caisseId) {
      if (creditCaisseOpen) {
        // La caisse a pu être fermée entre la lecture initiale et cet appel
        // (autre poste). La vente est déjà encaissée côté client : on
        // crédite quand même la session capturée plutôt que de la perdre.
        const credited = await addCaisseVenteAmount(caisseId, montant);
        if (!credited) {
          await adjustCaisseVenteAmount(caisseId, montant);
        }
      } else {
        await adjustCaisseVenteAmount(caisseId, montant);
      }
    }
  } catch (error) {
    if (doc) {
      try {
        await db
          .collection<TicketDoc>("pos_tickets")
          .deleteOne({ _id: doc._id });
      } catch {
        /* best effort rollback */
      }
    }
    await reprendreLignes();
    throw error;
  }

  const board = await getVenteBoard(date, input.site);
  return { ticket: toTicket(doc), board, caisseId };
}

export async function cancelPosTicket(input: {
  id: string;
  user: SessionUser;
  date: string;
  site: VenteSite;
}): Promise<{
  board: Awaited<ReturnType<typeof getVenteBoard>>;
  ticket: { numero: string; montant: number };
}> {
  if (!ObjectId.isValid(input.id)) throw new Error("Ticket invalide");
  const db = await getDb();
  const doc = await db.collection<TicketDoc>("pos_tickets").findOne({
    _id: new ObjectId(input.id),
    site: input.site,
  });
  if (!doc) throw new Error("Ticket introuvable");
  if (doc.statut === "annule") throw new Error("Ticket déjà annulé");

  // Une équipe ne peut pas annuler un ticket encaissé par l'autre équipe.
  const manager = canManagePastVentes(input.user.role);
  assertSameTeamCancellation({
    saleShift: doc.shift,
    cancellerShift: input.user.shift,
    bypassTeam: manager,
  });

  // Caisse fermée : le gérant peut quand même corriger un jour passé.
  if (doc.caisseId && !manager) {
    const caisse = await getCaisseById(doc.caisseId);
    if (caisse && caisse.statut !== "ouverte") {
      throw new Error("Caisse déjà clôturée : annulation impossible.");
    }
  }

  const actor = {
    id: input.user.id,
    name: input.user.name,
    username: input.user.username,
    shift: input.user.shift,
  };

  for (const line of doc.lines || []) {
    if (!line.venteLogId) continue;
    try {
      await undoVente({
        id: line.venteLogId,
        date: doc.date,
        site: input.site,
        actor,
        bypassClosedDay: manager,
        bypassTeam: manager,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      // Ligne déjà annulée (double clic, rejeu) : le reste suit.
      if (message.includes("déjà annulée")) continue;
      throw error;
    }
  }

  if (doc.caisseId) {
    if (manager) {
      await adjustCaisseVenteAmount(doc.caisseId, -doc.montant);
    } else {
      // Même filet que côté validation : si la caisse s'est fermée pendant
      // l'annulation, on corrige quand même la session concernée au lieu de
      // laisser son total de vente désynchronisé du journal.
      const credited = await addCaisseVenteAmount(doc.caisseId, -doc.montant);
      if (!credited) {
        await adjustCaisseVenteAmount(doc.caisseId, -doc.montant);
      }
    }
  }

  await db.collection<TicketDoc>("pos_tickets").updateOne(
    { _id: doc._id },
    {
      $set: {
        statut: "annule",
        cancelledAt: new Date().toISOString(),
        cancelledById: input.user.id,
        cancelledByName: input.user.name,
        cancelledByUsername: input.user.username,
      },
    },
  );

  const board = await getVenteBoard(doc.date, input.site);
  return {
    board,
    ticket: { numero: doc.numero, montant: doc.montant },
  };
}

export async function getPosContext(input: {
  date: string;
  site: VenteSite;
  allowBackdate?: boolean;
}) {
  const today = todayIsoDate();
  const caisse = await getActiveCaisseForSite(input.site);
  const requestedPast =
    Boolean(input.allowBackdate) &&
    Boolean(input.date) &&
    input.date < today;
  // Jour affiché : backdate volontaire, sinon date de la caisse ouverte.
  const date = requestedPast ? input.date : (caisse?.date ?? input.date);
  // Si le tiroir ouvert porte exactement ce jour, on l'expose toujours —
  // même si le calendrier a avancé (ex. caisse du 18 encore ouverte le 20).
  // Avant, le mode backdate renvoyait caisse:null → « fermée » à l'écran
  // alors que l'ouverture échouait avec « déjà ouverte ».
  const caisseForUi =
    caisse && caisse.date === date ? caisse : requestedPast ? null : caisse;
  const backdate = requestedPast && !(caisse && caisse.date === date);
  const [config, tickets, board] = await Promise.all([
    getPosConfig(),
    listTickets({ date, site: input.site }),
    getVenteBoard(date, input.site),
  ]);
  return {
    date,
    config,
    caisse: caisseForUi,
    /** Session ouverte de la zone, même si le jour affiché diffère. */
    caisseActive: caisse,
    tickets,
    board,
    backdate,
  };
}
