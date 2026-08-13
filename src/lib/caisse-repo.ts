import { ObjectId, type Filter } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { newId } from "@/lib/format";
import {
  CAISSES,
  CAISSE_LABELS,
  caisseZone,
  canUseCaisse,
  soldeTheorique as calcSoldeTheorique,
} from "@/lib/caisse-model";
import type { SessionUser } from "@/lib/auth-types";
import type {
  CaisseKey,
  CaisseMouvement,
  CaisseMouvementKind,
  CaisseOverviewItem,
  CaisseSession,
  CaisseStatut,
  VenteSite,
} from "@/lib/types";

export type CaisseDoc = Omit<CaisseSession, "id"> & { _id: ObjectId };
export type MouvementDoc = Omit<CaisseMouvement, "id"> & { _id: ObjectId };

function isValidDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

function toSession(doc: CaisseDoc): CaisseSession {
  // Les sessions antérieures aux caisses nommées ne portent qu'un site : il
  // devient la caisse de la zone, sans migration obligatoire pour lire.
  const caisse = (doc.caisse ?? doc.site ?? "gbegamey") as CaisseKey;
  return {
    id: doc._id.toHexString(),
    caisse,
    date: doc.date,
    site: doc.site ?? caisseZone(caisse),
    userId: doc.userId,
    userName: doc.userName,
    statut: doc.statut,
    soldeInitial: Number(doc.soldeInitial) || 0,
    totalVente: Number(doc.totalVente) || 0,
    totalDepense: Number(doc.totalDepense) || 0,
    totalRecette: Number(doc.totalRecette) || 0,
    totalVersementSorti: Number(doc.totalVersementSorti) || 0,
    totalVersementRecu: Number(doc.totalVersementRecu) || 0,
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
    closedById: doc.closedById ?? null,
    closedByName: doc.closedByName ?? null,
    updatedAt: doc.updatedAt ?? null,
  };
}

export function toMouvement(doc: MouvementDoc): CaisseMouvement {
  return {
    id: doc._id.toHexString(),
    caisseId: doc.caisseId,
    kind: doc.kind,
    nature: doc.nature,
    beneficiaire: doc.beneficiaire,
    montant: Number(doc.montant) || 0,
    at: doc.at,
    actorId: doc.actorId ?? null,
    actorName: doc.actorName ?? null,
    transfertId: doc.transfertId ?? null,
    contrepartie: doc.contrepartie ?? null,
  };
}

export function soldeTheorique(s: CaisseSession): number {
  return calcSoldeTheorique(s);
}

/**
 * Sélecteur d'une caisse. Les sessions écrites avant les caisses nommées ne
 * portent qu'un site : sur une zone, il fait foi — l'écran reste juste sans
 * attendre la migration.
 */
function filtreCaisse(caisse: CaisseKey): Filter<CaisseDoc> {
  if (caisse === "centrale") return { caisse };
  return { $or: [{ caisse }, { caisse: { $exists: false }, site: caisse }] };
}

function assertAcces(user: SessionUser, caisse: CaisseKey): void {
  if (!canUseCaisse(user, caisse)) {
    throw new Error(`Accès refusé à la ${CAISSE_LABELS[caisse].toLowerCase()}.`);
  }
}

/**
 * Session ouverte d'une caisse. Une caisse est un tiroir partagé : qui l'ouvre
 * l'ouvre pour toute la zone, et le POS y encaisse quel que soit le vendeur.
 */
export async function getActiveCaisse(
  caisse: CaisseKey,
): Promise<CaisseSession | null> {
  const db = await getDb();
  const doc = await db.collection<CaisseDoc>("caisses_sessions").findOne({
    ...filtreCaisse(caisse),
    statut: "ouverte" satisfies CaisseStatut,
  });
  return doc ? toSession(doc) : null;
}

/** Caisse d'encaissement d'une zone — point d'entrée du POS. */
export async function getActiveCaisseForSite(
  site: VenteSite,
): Promise<CaisseSession | null> {
  return getActiveCaisse(site);
}

export async function listCaisses(input: {
  caisse: CaisseKey;
  limit?: number;
}): Promise<CaisseSession[]> {
  const db = await getDb();
  const docs = await db
    .collection<CaisseDoc>("caisses_sessions")
    .find(filtreCaisse(input.caisse))
    .sort({ openedAt: -1 })
    .limit(Math.min(200, Math.max(1, input.limit ?? 40)))
    .toArray();
  return docs.map(toSession);
}

/** État instantané des trois caisses — bandeau de consolidation. */
export async function getCaissesOverview(): Promise<CaisseOverviewItem[]> {
  const sessions = await Promise.all(CAISSES.map((c) => getActiveCaisse(c)));
  return CAISSES.map((caisse, i) => {
    const session = sessions[i] ?? null;
    return {
      caisse,
      session,
      soldeTheorique: session ? calcSoldeTheorique(session) : 0,
    };
  });
}

/**
 * Totaux caisse sur une plage de dates. Les versements en sont volontairement
 * absents : ils déplacent de l'argent, ils ne créent ni charge ni produit.
 * La caisse centrale n'a pas de site — elle n'entre donc que dans les vues
 * non filtrées par zone.
 */
export async function sumCaisseDepensesRecettes(input: {
  dateFrom: string;
  dateTo: string;
  /** Zone de l'utilisateur : null = tout le réseau, centrale comprise. */
  scopeSite?: VenteSite | null;
}): Promise<{ totalDepense: number; totalRecette: number; sessions: number }> {
  if (!isValidDate(input.dateFrom) || !isValidDate(input.dateTo)) {
    throw new Error("Date invalide");
  }
  const db = await getDb();
  const filtre: Record<string, unknown> = {
    date: { $gte: input.dateFrom, $lte: input.dateTo },
  };
  if (input.scopeSite) filtre.site = input.scopeSite;
  const docs = await db
    .collection<CaisseDoc>("caisses_sessions")
    .find(filtre)
    .toArray();
  let totalDepense = 0;
  let totalRecette = 0;
  for (const d of docs) {
    totalDepense += Number(d.totalDepense) || 0;
    totalRecette += Number(d.totalRecette) || 0;
  }
  return { totalDepense, totalRecette, sessions: docs.length };
}

export type CaisseDepensesRecettesRow = {
  caisse: CaisseKey;
  totalDepense: number;
  totalRecette: number;
  sessions: number;
};

/**
 * Mêmes totaux que `sumCaisseDepensesRecettes`, mais détaillés caisse par
 * caisse plutôt qu'additionnés — le compte de résultat les affiche côte à
 * côte pour ne pas perdre, dans un seul chiffre, la visibilité que le modèle
 * à trois caisses est censé apporter.
 */
export async function sumCaisseDepensesRecettesParCaisse(input: {
  dateFrom: string;
  dateTo: string;
  /** Zone de l'utilisateur : null = les trois caisses (admin global). */
  scopeSite?: VenteSite | null;
}): Promise<CaisseDepensesRecettesRow[]> {
  if (!isValidDate(input.dateFrom) || !isValidDate(input.dateTo)) {
    throw new Error("Date invalide");
  }
  // Un admin de zone ne voit que sa propre caisse, jamais le coffre central
  // ni l'autre zone — même règle d'accès que l'écran Caisse.
  const caisses: CaisseKey[] = input.scopeSite ? [input.scopeSite] : CAISSES;
  const db = await getDb();
  const docs = await db
    .collection<CaisseDoc>("caisses_sessions")
    .find({ date: { $gte: input.dateFrom, $lte: input.dateTo } })
    .toArray();

  const parCaisse = new Map<CaisseKey, CaisseDepensesRecettesRow>(
    caisses.map((caisse) => [
      caisse,
      { caisse, totalDepense: 0, totalRecette: 0, sessions: 0 },
    ]),
  );
  for (const d of docs) {
    // Session antérieure aux caisses nommées : le site fait foi.
    const caisse = (d.caisse ?? d.site ?? "zogbo") as CaisseKey;
    const row = parCaisse.get(caisse);
    if (!row) continue; // hors du périmètre de l'utilisateur
    row.totalDepense += Number(d.totalDepense) || 0;
    row.totalRecette += Number(d.totalRecette) || 0;
    row.sessions += 1;
  }
  return caisses.map((caisse) => parCaisse.get(caisse)!);
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
  caisse: CaisseKey;
  user: SessionUser;
  soldeInitial: number;
}): Promise<CaisseSession> {
  if (!isValidDate(input.date)) throw new Error("Date invalide");
  assertAcces(input.user, input.caisse);
  const soldeInitial = Math.max(0, Math.round(Number(input.soldeInitial) || 0));
  const existing = await getActiveCaisse(input.caisse);
  if (existing) {
    throw new Error(
      `${CAISSE_LABELS[input.caisse]} déjà ouverte par ${existing.userName}.`,
    );
  }
  const now = new Date().toISOString();
  const doc: CaisseDoc = {
    _id: new ObjectId(),
    caisse: input.caisse,
    date: input.date,
    site: caisseZone(input.caisse),
    userId: input.user.id,
    userName: input.user.name,
    statut: "ouverte",
    soldeInitial,
    totalVente: 0,
    totalDepense: 0,
    totalRecette: 0,
    totalVersementSorti: 0,
    totalVersementRecu: 0,
    soldePhysique: null,
    soldeFermeture: null,
    commentaire: null,
    openedAt: now,
    closedAt: null,
    closedById: null,
    closedByName: null,
    updatedAt: now,
  };
  const db = await getDb();
  await db.collection<CaisseDoc>("caisses_sessions").insertOne(doc);
  return toSession(doc);
}

export async function closeCaisse(input: {
  id: string;
  user: SessionUser;
  soldePhysique: number;
  commentaire?: string | null;
}): Promise<CaisseSession> {
  const session = await getCaisseById(input.id);
  if (!session) throw new Error("Caisse introuvable");
  // Caisse partagée : ce n'est plus l'ouvreur qui ferme, c'est celui qui
  // compte le tiroir. Son nom est consigné.
  assertAcces(input.user, session.caisse);
  if (session.statut !== "ouverte") throw new Error("Caisse déjà fermée");

  const soldePhysique = Math.round(Number(input.soldePhysique) || 0);
  const now = new Date().toISOString();
  const db = await getDb();
  await db.collection<CaisseDoc>("caisses_sessions").updateOne(
    { _id: new ObjectId(input.id), statut: "ouverte" },
    {
      $set: {
        statut: "fermee" satisfies CaisseStatut,
        soldePhysique,
        soldeFermeture: soldePhysique,
        commentaire: input.commentaire?.trim() || null,
        closedAt: now,
        closedById: input.user.id,
        closedByName: input.user.name,
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
  user: SessionUser;
  kind: Extract<CaisseMouvementKind, "depense" | "recette">;
  nature: string;
  beneficiaire: string;
  montant: number;
}): Promise<{ session: CaisseSession; mouvement: CaisseMouvement }> {
  const session = await getCaisseById(input.caisseId);
  if (!session) throw new Error("Caisse introuvable");
  assertAcces(input.user, session.caisse);
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
    actorId: input.user.id,
    actorName: input.user.name,
    transfertId: null,
    contrepartie: null,
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

/**
 * Versement d'une caisse à une autre — typiquement la recette d'une zone qui
 * monte au coffre central.
 *
 * Deux jambes liées par un même `transfertId` : l'argent sort d'un tiroir et
 * entre dans l'autre, sans jamais passer par les dépenses ni les recettes. On
 * exige que la caisse d'arrivée soit ouverte : sans cela l'argent quitterait la
 * zone sans se poser nulle part.
 */
export async function versementCaisse(input: {
  fromSessionId: string;
  toCaisse: CaisseKey;
  user: SessionUser;
  montant: number;
  nature?: string | null;
}): Promise<{
  source: CaisseSession;
  destination: CaisseSession;
  mouvement: CaisseMouvement;
}> {
  const source = await getCaisseById(input.fromSessionId);
  if (!source) throw new Error("Caisse source introuvable");
  // Le droit se juge sur la caisse d'où l'argent part : verser sa recette au
  // coffre reste une opération de zone, même sans accès au coffre.
  assertAcces(input.user, source.caisse);
  // Mais la destination d'une zone est interdite hors de son périmètre :
  // on ne touche jamais la caisse de l'autre zone.
  if (input.toCaisse !== "centrale") {
    assertAcces(input.user, input.toCaisse);
  }
  if (source.statut !== "ouverte") {
    throw new Error("Caisse source fermée : versement impossible.");
  }
  if (source.caisse === input.toCaisse) {
    throw new Error("Choisissez une autre caisse de destination.");
  }

  const destination = await getActiveCaisse(input.toCaisse);
  if (!destination) {
    throw new Error(
      `${CAISSE_LABELS[input.toCaisse]} fermée : ouvrez-la avant de verser.`,
    );
  }

  const montant = Math.round(Number(input.montant) || 0);
  if (montant <= 0) throw new Error("Montant invalide");
  const disponible = calcSoldeTheorique(source);
  if (montant > disponible) {
    throw new Error(
      `Montant supérieur au solde de la caisse (${disponible} FCFA).`,
    );
  }

  const now = new Date().toISOString();
  const transfertId = newId("vers");
  const nature = input.nature?.trim() || "Versement";
  const db = await getDb();

  const sortie: MouvementDoc = {
    _id: new ObjectId(),
    caisseId: source.id,
    kind: "versement-sortie",
    nature,
    beneficiaire: CAISSE_LABELS[input.toCaisse],
    montant,
    at: now,
    actorId: input.user.id,
    actorName: input.user.name,
    transfertId,
    contrepartie: input.toCaisse,
  };
  const entree: MouvementDoc = {
    _id: new ObjectId(),
    caisseId: destination.id,
    kind: "versement-entree",
    nature,
    beneficiaire: CAISSE_LABELS[source.caisse],
    montant,
    at: now,
    actorId: input.user.id,
    actorName: input.user.name,
    transfertId,
    contrepartie: source.caisse,
  };

  await db
    .collection<MouvementDoc>("caisse_mouvements")
    .insertMany([sortie, entree]);

  // La sortie n'est validée que si la caisse est toujours ouverte ; sinon on
  // défait tout plutôt que de laisser un versement à moitié écrit.
  const debit = await db.collection<CaisseDoc>("caisses_sessions").updateOne(
    { _id: new ObjectId(source.id), statut: "ouverte" },
    { $inc: { totalVersementSorti: montant }, $set: { updatedAt: now } },
  );
  if (debit.modifiedCount !== 1) {
    await db
      .collection<MouvementDoc>("caisse_mouvements")
      .deleteMany({ transfertId });
    throw new Error("Caisse source fermée : versement impossible.");
  }

  const credit = await db.collection<CaisseDoc>("caisses_sessions").updateOne(
    { _id: new ObjectId(destination.id), statut: "ouverte" },
    { $inc: { totalVersementRecu: montant }, $set: { updatedAt: now } },
  );
  if (credit.modifiedCount !== 1) {
    await db.collection<CaisseDoc>("caisses_sessions").updateOne(
      { _id: new ObjectId(source.id) },
      { $inc: { totalVersementSorti: -montant }, $set: { updatedAt: now } },
    );
    await db
      .collection<MouvementDoc>("caisse_mouvements")
      .deleteMany({ transfertId });
    throw new Error(
      `${CAISSE_LABELS[input.toCaisse]} fermée : versement impossible.`,
    );
  }

  const [sourceMaj, destinationMaj] = await Promise.all([
    getCaisseById(source.id),
    getCaisseById(destination.id),
  ]);
  if (!sourceMaj || !destinationMaj) throw new Error("Caisse introuvable");
  return {
    source: sourceMaj,
    destination: destinationMaj,
    mouvement: toMouvement(sortie),
  };
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
  const theo = calcSoldeTheorique(session);
  const ecart =
    session.soldePhysique === null ? null : session.soldePhysique - theo;
  return { session, mouvements, soldeTheorique: theo, ecart };
}

/** Génère un id de mouvement client-side si besoin */
export function newMouvementId(): string {
  return newId("cm");
}
