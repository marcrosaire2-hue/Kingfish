import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { newId } from "@/lib/format";
import type {
  CaisseMouvement,
  CaisseMouvementKind,
  CaisseSession,
  CaisseStatut,
  VenteSite,
} from "@/lib/types";

type CaisseDoc = Omit<CaisseSession, "id"> & { _id: ObjectId };
type MouvementDoc = Omit<CaisseMouvement, "id"> & { _id: ObjectId };

function isValidDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

function toSession(doc: CaisseDoc): CaisseSession {
  return {
    id: doc._id.toHexString(),
    date: doc.date,
    site: doc.site,
    userId: doc.userId,
    userName: doc.userName,
    statut: doc.statut,
    soldeInitial: Number(doc.soldeInitial) || 0,
    totalVente: Number(doc.totalVente) || 0,
    totalDepense: Number(doc.totalDepense) || 0,
    totalRecette: Number(doc.totalRecette) || 0,
    soldePhysique:
      doc.soldePhysique === null || doc.soldePhysique === undefined
        ? null
        : Number(doc.soldePhysique),
    soldeFermeture:
      doc.soldeFermeture === null || doc.soldeFermeture === undefined
        ? null
        : Number(doc.soldeFermeture),
    commentaire: doc.commentaire ?? null,
    openedAt: doc.openedAt,
    closedAt: doc.closedAt ?? null,
    updatedAt: doc.updatedAt ?? null,
  };
}

function toMouvement(doc: MouvementDoc): CaisseMouvement {
  return {
    id: doc._id.toHexString(),
    caisseId: doc.caisseId,
    kind: doc.kind,
    nature: doc.nature,
    beneficiaire: doc.beneficiaire,
    montant: Number(doc.montant) || 0,
    at: doc.at,
  };
}

export function soldeTheorique(s: CaisseSession): number {
  return (
    s.soldeInitial + s.totalVente + s.totalRecette - s.totalDepense
  );
}

export async function getActiveCaisse(
  userId: string,
  site: VenteSite,
): Promise<CaisseSession | null> {
  const db = await getDb();
  const doc = await db.collection<CaisseDoc>("caisses_sessions").findOne({
    userId,
    site,
    statut: "ouverte" satisfies CaisseStatut,
  });
  return doc ? toSession(doc) : null;
}

export async function listCaisses(input: {
  site: VenteSite;
  userId?: string | null;
  limit?: number;
}): Promise<CaisseSession[]> {
  const db = await getDb();
  const filter: Record<string, unknown> = { site: input.site };
  if (input.userId) filter.userId = input.userId;
  const docs = await db
    .collection<CaisseDoc>("caisses_sessions")
    .find(filter)
    .sort({ openedAt: -1 })
    .limit(Math.min(200, Math.max(1, input.limit ?? 40)))
    .toArray();
  return docs.map(toSession);
}

/** Totaux caisse sur une plage de dates (tous sites / utilisateurs). */
export async function sumCaisseDepensesRecettes(input: {
  dateFrom: string;
  dateTo: string;
}): Promise<{ totalDepense: number; totalRecette: number; sessions: number }> {
  if (!isValidDate(input.dateFrom) || !isValidDate(input.dateTo)) {
    throw new Error("Date invalide");
  }
  const db = await getDb();
  const docs = await db
    .collection<CaisseDoc>("caisses_sessions")
    .find({ date: { $gte: input.dateFrom, $lte: input.dateTo } })
    .toArray();
  let totalDepense = 0;
  let totalRecette = 0;
  for (const d of docs) {
    totalDepense += Number(d.totalDepense) || 0;
    totalRecette += Number(d.totalRecette) || 0;
  }
  return { totalDepense, totalRecette, sessions: docs.length };
}

export async function getCaisseById(id: string): Promise<CaisseSession | null> {
  if (!ObjectId.isValid(id)) return null;
  const db = await getDb();
  const doc = await db
    .collection<CaisseDoc>("caisses_sessions")
    .findOne({ _id: new ObjectId(id) });
  return doc ? toSession(doc) : null;
}

export async function openCaisse(input: {
  date: string;
  site: VenteSite;
  userId: string;
  userName: string;
  soldeInitial: number;
}): Promise<CaisseSession> {
  if (!isValidDate(input.date)) throw new Error("Date invalide");
  const soldeInitial = Math.max(0, Math.round(Number(input.soldeInitial) || 0));
  const existing = await getActiveCaisse(input.userId, input.site);
  if (existing) {
    throw new Error("Une caisse est déjà ouverte sur ce site.");
  }
  const now = new Date().toISOString();
  const doc: CaisseDoc = {
    _id: new ObjectId(),
    date: input.date,
    site: input.site,
    userId: input.userId,
    userName: input.userName,
    statut: "ouverte",
    soldeInitial,
    totalVente: 0,
    totalDepense: 0,
    totalRecette: 0,
    soldePhysique: null,
    soldeFermeture: null,
    commentaire: null,
    openedAt: now,
    closedAt: null,
    updatedAt: now,
  };
  const db = await getDb();
  await db.collection<CaisseDoc>("caisses_sessions").insertOne(doc);
  return toSession(doc);
}

export async function closeCaisse(input: {
  id: string;
  userId: string;
  soldePhysique: number;
  commentaire?: string | null;
}): Promise<CaisseSession> {
  const session = await getCaisseById(input.id);
  if (!session) throw new Error("Caisse introuvable");
  if (session.userId !== input.userId) {
    throw new Error("Cette caisse appartient à un autre utilisateur.");
  }
  if (session.statut !== "ouverte") throw new Error("Caisse déjà fermée");

  const soldePhysique = Math.round(Number(input.soldePhysique) || 0);
  const now = new Date().toISOString();
  const db = await getDb();
  await db.collection<CaisseDoc>("caisses_sessions").updateOne(
    { _id: new ObjectId(input.id) },
    {
      $set: {
        statut: "fermee" satisfies CaisseStatut,
        soldePhysique,
        soldeFermeture: soldePhysique,
        commentaire: input.commentaire?.trim() || null,
        closedAt: now,
        updatedAt: now,
      },
    },
  );
  const updated = await getCaisseById(input.id);
  if (!updated) throw new Error("Caisse introuvable après fermeture");
  return updated;
}

export async function listMouvements(
  caisseId: string,
): Promise<CaisseMouvement[]> {
  const db = await getDb();
  const docs = await db
    .collection<MouvementDoc>("caisse_mouvements")
    .find({ caisseId })
    .sort({ at: -1 })
    .toArray();
  return docs.map(toMouvement);
}

export async function addCaisseMouvement(input: {
  caisseId: string;
  userId: string;
  kind: CaisseMouvementKind;
  nature: string;
  beneficiaire: string;
  montant: number;
}): Promise<{ session: CaisseSession; mouvement: CaisseMouvement }> {
  const session = await getCaisseById(input.caisseId);
  if (!session) throw new Error("Caisse introuvable");
  if (session.userId !== input.userId) {
    throw new Error("Cette caisse appartient à un autre utilisateur.");
  }
  if (session.statut !== "ouverte") {
    throw new Error("Impossible d’ajouter un mouvement sur une caisse fermée");
  }
  const nature = input.nature.trim();
  if (nature.length < 2) throw new Error("Nature trop courte");
  const montant = Math.round(Number(input.montant) || 0);
  if (montant <= 0) throw new Error("Montant invalide");

  const now = new Date().toISOString();
  const mDoc: MouvementDoc = {
    _id: new ObjectId(),
    caisseId: input.caisseId,
    kind: input.kind,
    nature,
    beneficiaire: input.beneficiaire.trim() || "—",
    montant,
    at: now,
  };
  const db = await getDb();
  await db.collection<MouvementDoc>("caisse_mouvements").insertOne(mDoc);

  const field = input.kind === "depense" ? "totalDepense" : "totalRecette";
  await db.collection<CaisseDoc>("caisses_sessions").updateOne(
    { _id: new ObjectId(input.caisseId) },
    { $inc: { [field]: montant }, $set: { updatedAt: now } },
  );

  const updated = await getCaisseById(input.caisseId);
  if (!updated) throw new Error("Caisse introuvable");
  return { session: updated, mouvement: toMouvement(mDoc) };
}

/** Incrémente le CA caisse lors d’une vente POS validée */
export async function addCaisseVenteAmount(
  caisseId: string,
  amount: number,
): Promise<void> {
  if (!ObjectId.isValid(caisseId)) return;
  const delta = Math.round(Number(amount) || 0);
  if (!delta) return;
  const db = await getDb();
  await db.collection<CaisseDoc>("caisses_sessions").updateOne(
    { _id: new ObjectId(caisseId), statut: "ouverte" },
    {
      $inc: { totalVente: delta },
      $set: { updatedAt: new Date().toISOString() },
    },
  );
}

export async function getCaisseDetail(id: string): Promise<{
  session: CaisseSession;
  mouvements: CaisseMouvement[];
  soldeTheorique: number;
  ecart: number | null;
}> {
  const session = await getCaisseById(id);
  if (!session) throw new Error("Caisse introuvable");
  const mouvements = await listMouvements(id);
  const theo = soldeTheorique(session);
  const ecart =
    session.soldePhysique === null ? null : session.soldePhysique - theo;
  return { session, mouvements, soldeTheorique: theo, ecart };
}

/** Génère un id de mouvement client-side si besoin */
export function newMouvementId(): string {
  return newId("cm");
}
