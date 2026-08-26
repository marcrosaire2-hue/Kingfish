import { ObjectId, type Filter } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { newId } from "@/lib/format";
import {
  CAISSE_LABELS,
  ZONE_CAISSES,
  assertIndependentCaisseTransfer,
  caisseZone,
  canUseCaisse,
  isZoneCaisse,
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
import {
  isCaisseStale,
  operatingDateFromCaisse,
  todayIsoDate,
} from "@/lib/zogbo-calc";
import { isValidDate } from "@/lib/day-doc";

export type CaisseDoc = Omit<CaisseSession, "id"> & { _id: ObjectId };
export type MouvementDoc = Omit<CaisseMouvement, "id"> & { _id: ObjectId };

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
    cancelledAt: doc.cancelledAt ?? null,
    cancelledById: doc.cancelledById ?? null,
    cancelledByName: doc.cancelledByName ?? null,
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

const SYSTEM_ACTOR_ID = "system";
const SYSTEM_ACTOR_NAME = "Système (jour suivant)";

/**
 * Une caisse restée ouverte après l'heure de coupure du lendemain (cf.
 * isCaisseStale) est considérée oubliée : on la clôture sans compter le
 * tiroir (soldePhysique reste `null`, l'écart n'est pas inventé) puis on en
 * rouvre une pour aujourd'hui, avec son solde théorique reporté comme fond de
 * caisse — l'argent n'a physiquement pas bougé, seule la journée comptable
 * change.
 */
async function rolloverStaleCaisse(
  caisse: CaisseKey,
  session: CaisseSession,
): Promise<CaisseSession | null> {
  const db = await getDb();
  const now = new Date().toISOString();
  const theo = calcSoldeTheorique(session);

  const closeResult = await db.collection<CaisseDoc>("caisses_sessions").updateOne(
    { _id: new ObjectId(session.id), statut: "ouverte" },
    {
      $set: {
        statut: "fermee" satisfies CaisseStatut,
        soldePhysique: null,
        soldeFermeture: theo,
        commentaire:
          "Clôturée automatiquement (changement de jour, décompte physique à faire).",
        closedAt: now,
        closedById: SYSTEM_ACTOR_ID,
        closedByName: SYSTEM_ACTOR_NAME,
        updatedAt: now,
      },
    },
  );
  if (closeResult.modifiedCount !== 1) {
    // Bascule concurrente déjà passée (autre requête simultanée) : état réel.
    return getActiveCaisse(caisse);
  }

  const newDoc: CaisseDoc = {
    _id: new ObjectId(),
    caisse,
    date: todayIsoDate(),
    site: caisseZone(caisse),
    userId: SYSTEM_ACTOR_ID,
    userName: SYSTEM_ACTOR_NAME,
    statut: "ouverte",
    soldeInitial: Math.max(0, Math.round(theo)),
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
  await db.collection<CaisseDoc>("caisses_sessions").insertOne(newDoc);
  return toSession(newDoc);
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
  if (!doc) return null;
  const session = toSession(doc);
  if (isCaisseStale(session.date)) {
    return rolloverStaleCaisse(caisse, session);
  }
  return session;
}

/** Caisse d'encaissement d'une zone — point d'entrée du POS. */
export async function getActiveCaisseForSite(
  site: VenteSite,
): Promise<CaisseSession | null> {
  return getActiveCaisse(site);
}

/**
 * Garantit une caisse ouverte pour la zone : si aucune session n'existe,
 * on en crée une pour aujourd'hui (fond 0). Zogbo et Gbégamey restent
 * indépendantes — chacune s'ouvre à la demande, les deux peuvent coexister.
 * Ainsi le POS encaisse sans étape manuelle « Ouvrir la caisse ».
 */
export async function ensureActiveCaisseForSite(input: {
  site: VenteSite;
  user: SessionUser;
}): Promise<CaisseSession> {
  const existing = await getActiveCaisseForSite(input.site);
  if (existing) return existing;

  try {
    return await openCaisse({
      date: todayIsoDate(),
      caisse: input.site,
      user: input.user,
      soldeInitial: 0,
    });
  } catch (error) {
    // Course entre deux postes : l'autre a ouvert entre-temps.
    const concurrente = await getActiveCaisseForSite(input.site);
    if (concurrente) return concurrente;
    throw error;
  }
}

/** Date à laquelle stock, journal et CA doivent s'écrire pour cette zone. */
export async function resolveOperatingDate(
  site: VenteSite,
  requested?: string | null,
  options?: { allowBackdate?: boolean },
): Promise<string> {
  const today = todayIsoDate();
  // Correction volontaire d'un jour passé : on ne force pas la date de caisse.
  if (
    options?.allowBackdate &&
    requested &&
    /^\d{4}-\d{2}-\d{2}$/.test(requested) &&
    requested < today
  ) {
    return requested;
  }
  const caisse = await getActiveCaisseForSite(site);
  return operatingDateFromCaisse(caisse?.date, requested, today);
}

/** Session de caisse de la zone pour une date donnée (ouverte ou fermée). */
export async function findCaisseSessionForSiteDate(
  site: VenteSite,
  date: string,
): Promise<CaisseSession | null> {
  if (!isValidDate(date)) return null;
  const db = await getDb();
  const doc = await db
    .collection<CaisseDoc>("caisses_sessions")
    .find({ site, date })
    .sort({ openedAt: -1 })
    .limit(1)
    .next();
  return doc ? toSession(doc) : null;
}

/**
 * Caisse sur laquelle rattacher une dépense d’achat / stock.
 * Gérant sur un jour passé : session de cette date (même fermée).
 * Sinon : caisse ouverte actuelle du site.
 */
export async function resolveCaisseForDepense(input: {
  site: VenteSite;
  date: string;
  allowPastClosed?: boolean;
}): Promise<{ session: CaisseSession | null; allowClosed: boolean }> {
  if (
    input.allowPastClosed &&
    isValidDate(input.date) &&
    input.date < todayIsoDate()
  ) {
    const session = await findCaisseSessionForSiteDate(input.site, input.date);
    return { session, allowClosed: true };
  }
  return {
    session: await getActiveCaisseForSite(input.site),
    allowClosed: false,
  };
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

/** État instantané des caisses de zone — jamais consolidées en un seul solde. */
export async function getCaissesOverview(): Promise<CaisseOverviewItem[]> {
  const sessions = await Promise.all(ZONE_CAISSES.map((c) => getActiveCaisse(c)));
  return ZONE_CAISSES.map((caisse, i) => {
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
 * Un `scopeSite` est obligatoire pour ne jamais additionner Zogbo et Gbégamey.
 * Sans scope, on ne remonte que les sessions de zone filtrées… et on refuse
 * l'agrégat silencieux en exigeant le site côté API finance.
 */
export async function sumCaisseDepensesRecettes(input: {
  dateFrom: string;
  dateTo: string;
  /** Zone : obligatoire pour l'indépendance des caisses. */
  scopeSite?: VenteSite | null;
}): Promise<{ totalDepense: number; totalRecette: number; sessions: number }> {
  if (!isValidDate(input.dateFrom) || !isValidDate(input.dateTo)) {
    throw new Error("Date invalide");
  }
  if (!input.scopeSite) {
    throw new Error(
      "Site requis : les totaux de caisse ne mélangent plus Zogbo et Gbégamey.",
    );
  }
  const db = await getDb();
  const filtre: Record<string, unknown> = {
    date: { $gte: input.dateFrom, $lte: input.dateTo },
    site: input.scopeSite,
    // Exclut l'ancienne centrale (site null) même si une date matchait.
    caisse: input.scopeSite,
  };
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
 * Mêmes totaux que `sumCaisseDepensesRecettes`, détaillés caisse par caisse.
 * Sans scope : les deux zones côte à côte (jamais un seul total mélangé).
 * Avec scope : uniquement la caisse du site.
 */
export async function sumCaisseDepensesRecettesParCaisse(input: {
  dateFrom: string;
  dateTo: string;
  scopeSite?: VenteSite | null;
}): Promise<CaisseDepensesRecettesRow[]> {
  if (!isValidDate(input.dateFrom) || !isValidDate(input.dateTo)) {
    throw new Error("Date invalide");
  }
  const caisses: CaisseKey[] = input.scopeSite
    ? [input.scopeSite]
    : [...ZONE_CAISSES];
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
    if (caisse === "centrale") continue;
    const row = parCaisse.get(caisse);
    if (!row) continue; // hors du périmètre de l'utilisateur
    row.totalDepense += Number(d.totalDepense) || 0;
    row.totalRecette += Number(d.totalRecette) || 0;
    row.sessions += 1;
  }
  return caisses.map((caisse) => parCaisse.get(caisse)!);
}

export type MouvementAvecCaisse = {
  mouvement: CaisseMouvement;
  caisse: CaisseKey;
  date: string;
};

/**
 * Dépenses / recettes / versements de toutes les sessions ouvertes dans la
 * plage — brique de base du journal comptable, qui a besoin de chaque
 * mouvement individuel (pas seulement des totaux agrégés par
 * `sumCaisseDepensesRecettes`) pour générer une écriture par opération.
 */
export async function listMouvementsByDateRange(input: {
  dateFrom: string;
  dateTo: string;
  scopeSite?: VenteSite | null;
}): Promise<MouvementAvecCaisse[]> {
  if (!isValidDate(input.dateFrom) || !isValidDate(input.dateTo)) {
    throw new Error("Date invalide");
  }
  if (!input.scopeSite) {
    throw new Error(
      "Site requis : le journal de caisse ne mélange plus Zogbo et Gbégamey.",
    );
  }
  const db = await getDb();
  const filtre: Record<string, unknown> = {
    date: { $gte: input.dateFrom, $lte: input.dateTo },
    site: input.scopeSite,
    caisse: input.scopeSite,
  };
  const sessions = await db
    .collection<CaisseDoc>("caisses_sessions")
    .find(filtre)
    .toArray();
  if (sessions.length === 0) return [];

  const sessionById = new Map(
    sessions.map((s) => [
      s._id.toHexString(),
      { caisse: (s.caisse ?? s.site ?? "zogbo") as CaisseKey, date: s.date },
    ]),
  );
  const ids = [...sessionById.keys()];
  const mouvements = await db
    .collection<MouvementDoc>("caisse_mouvements")
    .find({ caisseId: { $in: ids } })
    .sort({ at: 1 })
    .toArray();

  return mouvements.flatMap((m) => {
    const info = sessionById.get(m.caisseId);
    if (!info) return [];
    return [{ mouvement: toMouvement(m), caisse: info.caisse, date: info.date }];
  });
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
  if (!isZoneCaisse(input.caisse)) {
    throw new Error(
      "La caisse centrale est désactivée : Zogbo et Gbégamey sont indépendantes.",
    );
  }
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

  // Un tiroir physique ne peut pas être négatif : même plancher qu'à l'ouverture.
  const soldePhysique = Math.max(0, Math.round(Number(input.soldePhysique) || 0));
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
  /** Gérant : correction sur une session déjà fermée (jour passé). */
  allowClosed?: boolean;
}): Promise<{ session: CaisseSession; mouvement: CaisseMouvement }> {
  const session = await getCaisseById(input.caisseId);
  if (!session) throw new Error("Caisse introuvable");
  assertAcces(input.user, session.caisse);
  if (session.statut !== "ouverte" && !input.allowClosed) {
    throw new Error("Impossible d’ajouter un mouvement sur une caisse fermée");
  }
  const nature = input.nature.trim();
  if (nature.length < 2) throw new Error("Nature trop courte");
  const montant = Math.round(Number(input.montant) || 0);
  if (montant <= 0) throw new Error("Montant invalide");
  // Un tiroir physique ne peut pas passer en négatif : même règle que pour
  // les versements entre caisses.
  if (input.kind === "depense") {
    const disponible = calcSoldeTheorique(session);
    if (montant > disponible) {
      throw new Error(
        `Dépense supérieure au solde de la caisse (${disponible} FCFA).`,
      );
    }
  }

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
    cancelledAt: null,
    cancelledById: null,
    cancelledByName: null,
  };
  const db = await getDb();
  await db.collection<MouvementDoc>("caisse_mouvements").insertOne(mDoc);

  const field = input.kind === "depense" ? "totalDepense" : "totalRecette";
  if (input.kind === "depense") {
    // Contrôle + incrément dans la même écriture : deux dépenses concurrentes
    // ne peuvent pas passer toutes les deux sur le même solde théorique lu
    // avant l'écriture (même faille que corrigée sur versementCaisse).
    const result = await db.collection<CaisseDoc>("caisses_sessions").updateOne(
      {
        _id: new ObjectId(input.caisseId),
        $expr: {
          $lte: [
            { $add: ["$totalDepense", montant] },
            {
              $subtract: [
                {
                  $add: [
                    "$soldeInitial",
                    "$totalVente",
                    "$totalRecette",
                    "$totalVersementRecu",
                  ],
                },
                "$totalVersementSorti",
              ],
            },
          ],
        },
      },
      { $inc: { totalDepense: montant }, $set: { updatedAt: now } },
    );
    if (result.modifiedCount !== 1) {
      await db
        .collection<MouvementDoc>("caisse_mouvements")
        .deleteOne({ _id: mDoc._id });
      throw new Error("Dépense supérieure au solde de la caisse.");
    }
  } else {
    await db.collection<CaisseDoc>("caisses_sessions").updateOne(
      { _id: new ObjectId(input.caisseId) },
      { $inc: { [field]: montant }, $set: { updatedAt: now } },
    );
  }

  const updated = await getCaisseById(input.caisseId);
  if (!updated) throw new Error("Caisse introuvable");
  return { session: updated, mouvement: toMouvement(mDoc) };
}

/**
 * Annule une dépense ou une recette : le mouvement reste au journal, barré,
 * et le total de la session (théorique) reprend le montant, comme les
 * annulations de vente ou de perte ailleurs dans l'app. Réservée aux
 * dépenses/recettes — un versement se corrige par un versement en sens
 * inverse, jamais par annulation (il touche deux caisses).
 */
export async function cancelCaisseMouvement(input: {
  mouvementId: string;
  user: SessionUser;
  /** Gérant : correction sur une session déjà fermée (jour passé). */
  allowClosed?: boolean;
}): Promise<{ session: CaisseSession; mouvement: CaisseMouvement }> {
  if (!ObjectId.isValid(input.mouvementId)) throw new Error("Mouvement introuvable");
  const db = await getDb();
  const mDoc = await db
    .collection<MouvementDoc>("caisse_mouvements")
    .findOne({ _id: new ObjectId(input.mouvementId), cancelledAt: null });
  if (!mDoc) throw new Error("Mouvement introuvable ou déjà annulé");
  if (mDoc.kind !== "depense" && mDoc.kind !== "recette") {
    throw new Error("Seules les dépenses et recettes peuvent être annulées.");
  }

  const session = await getCaisseById(mDoc.caisseId);
  if (!session) throw new Error("Caisse introuvable");
  assertAcces(input.user, session.caisse);
  if (session.statut !== "ouverte" && !input.allowClosed) {
    throw new Error("Impossible d’annuler un mouvement sur une caisse fermée");
  }

  const now = new Date().toISOString();
  await db.collection<MouvementDoc>("caisse_mouvements").updateOne(
    { _id: mDoc._id },
    {
      $set: {
        cancelledAt: now,
        cancelledById: input.user.id,
        cancelledByName: input.user.name,
      },
    },
  );

  const field = mDoc.kind === "depense" ? "totalDepense" : "totalRecette";
  await db.collection<CaisseDoc>("caisses_sessions").updateOne(
    { _id: new ObjectId(mDoc.caisseId) },
    { $inc: { [field]: -mDoc.montant }, $set: { updatedAt: now } },
  );

  const updated = await getCaisseById(mDoc.caisseId);
  if (!updated) throw new Error("Caisse introuvable");
  return {
    session: updated,
    mouvement: toMouvement({
      ...mDoc,
      cancelledAt: now,
      cancelledById: input.user.id,
      cancelledByName: input.user.name,
    }),
  };
}

/**
 * Versements inter-caisses désactivés : chaque site garde son argent.
 * Conservé pour ne pas casser les appels API ; renvoie toujours une erreur.
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
  assertIndependentCaisseTransfer(source.caisse, input.toCaisse);
  // Injoignable : assertIndependentCaisseTransfer lève toujours.
  throw new Error("Versement inter-caisses désactivé.");
}

/**
 * Incrémente le CA caisse lors d’une vente POS validée.
 * Renvoie `false` si la caisse a été fermée entre la lecture de la session
 * (au début de la validation du ticket) et cet appel : l'appelant doit alors
 * créditer la session malgré tout (`adjustCaisseVenteAmount`) pour ne pas
 * perdre silencieusement une vente déjà encaissée.
 */
export async function addCaisseVenteAmount(
  caisseId: string,
  amount: number,
): Promise<boolean> {
  if (!ObjectId.isValid(caisseId)) return true;
  const delta = Math.round(Number(amount) || 0);
  if (!delta) return true;
  const db = await getDb();
  const result = await db.collection<CaisseDoc>("caisses_sessions").updateOne(
    { _id: new ObjectId(caisseId), statut: "ouverte" },
    {
      $inc: { totalVente: delta },
      $set: { updatedAt: new Date().toISOString() },
    },
  );
  return result.modifiedCount === 1;
}

/**
 * Ajuste le total ventes d'une session même fermée — réservé aux corrections
 * gérant / admin sur un jour passé.
 */
export async function adjustCaisseVenteAmount(
  caisseId: string,
  amount: number,
): Promise<void> {
  if (!ObjectId.isValid(caisseId)) return;
  const delta = Math.round(Number(amount) || 0);
  if (!delta) return;
  const db = await getDb();
  await db.collection<CaisseDoc>("caisses_sessions").updateOne(
    { _id: new ObjectId(caisseId) },
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
