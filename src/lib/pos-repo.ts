import { ObjectId } from "mongodb";
import { getActiveCaisse, addCaisseVenteAmount } from "@/lib/caisse-repo";
import { getDb } from "@/lib/mongodb";
import { getPosConfig } from "@/lib/pos-config-repo";
import { getVenteBoard, recordExtraVente, recordVente, undoVente } from "@/lib/vente-repo";
import type { SessionUser } from "@/lib/auth-types";
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
    at: doc.at,
    cancelledAt: doc.cancelledAt ?? null,
  };
}

async function nextNumero(date: string): Promise<string> {
  const db = await getDb();
  const count = await db.collection("pos_tickets").countDocuments({ date });
  return `T-${date.replace(/-/g, "").slice(2)}-${String(count + 1).padStart(3, "0")}`;
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
  // ticket existant au lieu d'en créer un second.
  if (input.clientRef) {
    const db = await getDb();
    const existant = await db
      .collection<TicketDoc>("pos_tickets")
      .findOne({ clientRef: input.clientRef });
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
  };
  const caisse = await getActiveCaisse(input.user.id, input.site);
  if (!caisse) {
    throw new Error("Ouvrez une caisse avant de valider une commande.");
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

  const createdLogIds: string[] = [];
  const ticketLines: PosTicketLine[] = [];

  try {
    for (const line of input.lines) {
      const qty = Math.round(Number(line.qty) || 0);
      if (qty <= 0) continue;

      if (line.kind === "extra") {
        const result = await recordExtraVente({
          date: input.date,
          site: input.site,
          description: line.name || line.productId || "Extra",
          unitPrice: Math.round(Number(line.unitPrice) || 0),
          actor,
        });
        createdLogIds.push(result.entry.id);
        ticketLines.push({
          kind: "extra",
          productId: result.entry.productId,
          name: result.entry.name,
          qty: 1,
          unitPrice: result.entry.unitPrice,
          amount: result.entry.amount,
          venteLogId: result.entry.id,
        });
      } else {
        const result = await recordVente({
          date: input.date,
          site: input.site,
          kind: line.kind,
          productId: line.productId,
          qty,
          actor,
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
    for (const id of createdLogIds.reverse()) {
      try {
        await undoVente({
          id,
          date: input.date,
          site: input.site,
          actor,
        });
      } catch {
        /* best effort rollback */
      }
    }
    throw error;
  }

  if (!ticketLines.length) throw new Error("Aucune ligne valide");

  const montantBrut = ticketLines.reduce((s, l) => s + l.amount, 0);
  const reduction = Math.max(
    0,
    Math.min(montantBrut, Math.round(Number(input.reduction) || 0)),
  );
  const montant = montantBrut - reduction;
  const now = new Date().toISOString();
  const numero = await nextNumero(input.date);

  const doc: TicketDoc = {
    _id: new ObjectId(),
    numero,
    date: input.date,
    site: input.site,
    statut: "valide",
    saleType,
    caisseId: caisse.id,
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
    at: now,
    cancelledAt: null,
    clientRef: input.clientRef ?? null,
  };

  const db = await getDb();
  await db.collection<TicketDoc>("pos_tickets").insertOne(doc);
  await addCaisseVenteAmount(caisse.id, montant);

  const board = await getVenteBoard(input.date, input.site);
  return { ticket: toTicket(doc), board, caisseId: caisse.id };
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
    date: input.date,
    site: input.site,
  });
  if (!doc) throw new Error("Ticket introuvable");
  if (doc.statut === "annule") throw new Error("Ticket déjà annulé");

  const actor = {
    id: input.user.id,
    name: input.user.name,
    username: input.user.username,
  };

  for (const line of doc.lines || []) {
    if (!line.venteLogId) continue;
    try {
      await undoVente({
        id: line.venteLogId,
        date: input.date,
        site: input.site,
        actor,
      });
    } catch {
      /* line may already be undone */
    }
  }

  if (doc.caisseId) {
    await addCaisseVenteAmount(doc.caisseId, -doc.montant);
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

  const board = await getVenteBoard(input.date, input.site);
  return {
    board,
    ticket: { numero: doc.numero, montant: doc.montant },
  };
}

export async function getPosContext(input: {
  date: string;
  site: VenteSite;
  userId: string;
}) {
  const [config, caisse, tickets, board] = await Promise.all([
    getPosConfig(),
    getActiveCaisse(input.userId, input.site),
    listTickets({ date: input.date, site: input.site }),
    getVenteBoard(input.date, input.site),
  ]);
  return { config, caisse, tickets, board };
}
