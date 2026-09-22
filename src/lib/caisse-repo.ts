import { ObjectId, type Filter } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { newId } from "@/lib/format";
import {
  CAISSE_LABELS,
  ZONE_CAISSES,
  assertClotureValide,
  assertIndependentCaisseTransfer,
  assertSortieDansSolde,
  canReceiveCaisseSales,
  caisseZone,
  canUseCaisse,
  isCaisseSessionActive,
  isZoneCaisse,
  soldeApresMouvement,
  soldeGlobalSites,
  soldeTheorique as calcSoldeTheorique,
  soldeTotaux,
} from "@/lib/caisse-model";
import type { SessionUser } from "@/lib/auth-types";
import type {
  CaisseKey,
  CaisseMouvement,
  CaisseMouvementKind,
  CaisseOverviewItem,
  CaisseSession,
  CaisseSoldeTotaux,
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
    soldeTheoriqueCloture:
      doc.soldeTheoriqueCloture === null ||
      doc.soldeTheoriqueCloture === undefined
        ? null
        : Number(doc.soldeTheoriqueCloture),
    ecart:
      doc.ecart === null || doc.ecart === undefined
        ? null
        : Number(doc.ecart),
    justificationEcart: doc.justificationEcart ?? null,
    commentaire: doc.commentaire ?? null,
    comptageStartedAt: doc.comptageStartedAt ?? null,
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
    soldeAvant:
      doc.soldeAvant === null || doc.soldeAvant === undefined
        ? null
        : Math.round(Number(doc.soldeAvant) || 0),
    soldeApres:
      doc.soldeApres === null || doc.soldeApres === undefined
        ? null
        : Math.round(Number(doc.soldeApres) || 0),
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
    {
      _id: new ObjectId(session.id),
      statut: { $in: ["ouverte", "en_comptage"] satisfies CaisseStatut[] },
    },
    {
      $set: {
        statut: "fermee" satisfies CaisseStatut,
        soldePhysique: null,
        soldeFermeture: theo,
        soldeTheoriqueCloture: theo,
        ecart: null,
        justificationEcart: null,
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
    soldeTheoriqueCloture: null,
    ecart: null,
    justificationEcart: null,
    commentaire: null,
    comptageStartedAt: null,
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
async function findOpenCaisse(caisse: CaisseKey): Promise<CaisseSession | null> {
  const db = await getDb();
  const doc = await db.collection<CaisseDoc>("caisses_sessions").findOne({
    ...filtreCaisse(caisse),
    statut: { $in: ["ouverte", "en_comptage"] satisfies CaisseStatut[] },
  });
  return doc ? toSession(doc) : null;
}

export async function getActiveCaisse(
  caisse: CaisseKey,
): Promise<CaisseSession | null> {
  const session = await findOpenCaisse(caisse);
  if (!session) return null;
  if (isCaisseStale(session.date)) {
    return rolloverStaleCaisse(caisse, session);
  }
  return session;
}

/**
 * Bascule manuelle : clôture la session datée d'hier (sans comptage physique)
 * et rouvre une caisse pour aujourd'hui avec le solde théorique reporté.
 */
export async function rolloverCaisseToToday(input: {
  caisse: CaisseKey;
  user: SessionUser;
}): Promise<CaisseSession> {
  assertAcces(input.user, input.caisse);
  const session = await findOpenCaisse(input.caisse);
  if (!session) {
    throw new Error("Aucune caisse ouverte à basculer.");
  }
  if (session.statut === "en_comptage") {
    throw new Error(
      "Comptage en cours : annulez-le ou finalisez la clôture avant de basculer.",
    );
  }
  const today = todayIsoDate();
  if (session.date >= today) {
    throw new Error("La caisse est déjà au jour courant.");
  }
  const rolled = await rolloverStaleCaisse(input.caisse, session);
  if (!rolled) {
    throw new Error("Impossible de basculer la caisse au jour courant.");
  }
  return rolled;
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
  if (existing) {
    if (!canReceiveCaisseSales(existing.statut)) {
      throw new Error(
        `${CAISSE_LABELS[existing.caisse]} est en comptage : finalisez la clôture avant d'encaisser.`,
      );
    }
    return existing;
  }

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

/**
 * État instantané des caisses de zone.
 * Chaque site garde son suivi ; le solde global (somme) est calculé à part
 * pour le tableau de bord, sans mélanger les flux.
 */
export async function getCaissesOverview(): Promise<{
  items: CaisseOverviewItem[];
  soldeGlobal: number;
}> {
  const sessions = await Promise.all(ZONE_CAISSES.map((c) => getActiveCaisse(c)));
  const items = ZONE_CAISSES.map((caisse, i) => {
    const session = sessions[i] ?? null;
    return {
      caisse,
      session,
      soldeTheorique: session ? calcSoldeTheorique(session) : 0,
    };
  });
  return { items, soldeGlobal: soldeGlobalSites(items) };
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

/**
 * Journal multi-sites pour l'admin : mouvements des caisses demandées,
 * fusionnés chronologiquement. Chaque ligne reste rattachée à son site.
 */
export async function listMouvementsReseau(input: {
  dateFrom: string;
  dateTo: string;
  sites: Array<"zogbo" | "gbegamey">;
}): Promise<MouvementAvecCaisse[]> {
  const sites = input.sites.filter(isZoneCaisse);
  if (sites.length === 0) return [];
  const parts = await Promise.all(
    sites.map((site) =>
      listMouvementsByDateRange({
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
        scopeSite: site,
      }),
    ),
  );
  return parts
    .flat()
    .sort((a, b) => a.mouvement.at.localeCompare(b.mouvement.at));
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
    soldeTheoriqueCloture: null,
    ecart: null,
    justificationEcart: null,
    commentaire: null,
    comptageStartedAt: null,
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

/**
 * Admin : ajoute des fonds au capital d'un site.
 * Le capital initial augmente du montant saisi ; la date d'effet devient
 * la date de l'ajout. Les mouvements opérationnels (versements, dépenses,
 * achats) restent saisis ailleurs (caisse / achats), pas par l'admin.
 */
export async function addFondsCaisse(input: {
  caisse: CaisseKey;
  user: SessionUser;
  montant: number;
  /** Date d'effet de l'ajout (défaut : aujourd'hui). */
  date?: string;
  motif?: string | null;
}): Promise<{ session: CaisseSession; capitalAvant: number; capitalApres: number }> {
  if (!isZoneCaisse(input.caisse)) {
    throw new Error(
      "La caisse centrale est désactivée : Zogbo et Gbégamey sont indépendantes.",
    );
  }
  assertAcces(input.user, input.caisse);

  const date = input.date || todayIsoDate();
  if (!isValidDate(date)) throw new Error("Date invalide");

  const montant = Math.round(Number(input.montant) || 0);
  if (montant <= 0) throw new Error("Montant invalide : indiquez un ajout positif.");

  const existing = await getActiveCaisse(input.caisse);

  if (!existing) {
    const session = await openCaisse({
      date,
      caisse: input.caisse,
      user: input.user,
      soldeInitial: montant,
    });
    return { session, capitalAvant: 0, capitalApres: montant };
  }

  if (existing.statut === "en_comptage") {
    throw new Error(
      "Caisse en comptage : terminez ou annulez le comptage avant d'ajouter des fonds.",
    );
  }

  const capitalAvant = Math.round(Number(existing.soldeInitial) || 0);
  const capitalApres = capitalAvant + montant;
  const now = new Date().toISOString();
  const motif = (input.motif ?? "").trim();
  const db = await getDb();
  const result = await db.collection<CaisseDoc>("caisses_sessions").updateOne(
    {
      _id: new ObjectId(existing.id),
      statut: "ouverte" satisfies CaisseStatut,
    },
    {
      $set: {
        soldeInitial: capitalApres,
        date,
        updatedAt: now,
        ...(motif
          ? {
              commentaire: existing.commentaire
                ? `${existing.commentaire}\n[Fonds +${montant} ${date}] ${motif}`
                : `[Fonds +${montant} ${date}] ${motif}`,
            }
          : {}),
      },
    },
  );
  if (result.modifiedCount !== 1) {
    throw new Error("Impossible d'ajouter des fonds à cette caisse.");
  }

  const updated = await getCaisseById(existing.id);
  if (!updated) throw new Error("Caisse introuvable");
  return { session: updated, capitalAvant, capitalApres };
}

/**
 * Admin : fixe (ou corrige) le capital initial d'une caisse ouverte.
 * La nouvelle valeur devient le solde initial à la date de modification.
 * Les mouvements déjà saisis restent ; le solde courant se recalcule :
 * nouveau capital + versements − sorties.
 */
export async function setCaisseCapital(input: {
  caisse: CaisseKey;
  user: SessionUser;
  soldeInitial: number;
  /** Date d'effet du nouveau capital (défaut : aujourd'hui). */
  date?: string;
  motif?: string | null;
}): Promise<CaisseSession> {
  if (!isZoneCaisse(input.caisse)) {
    throw new Error(
      "La caisse centrale est désactivée : Zogbo et Gbégamey sont indépendantes.",
    );
  }
  assertAcces(input.user, input.caisse);

  const date = input.date || todayIsoDate();
  if (!isValidDate(date)) throw new Error("Date invalide");

  const soldeInitial = Math.max(0, Math.round(Number(input.soldeInitial) || 0));
  const existing = await getActiveCaisse(input.caisse);

  if (!existing) {
    return openCaisse({
      date,
      caisse: input.caisse,
      user: input.user,
      soldeInitial,
    });
  }

  if (existing.statut === "en_comptage") {
    throw new Error(
      "Caisse en comptage : terminez ou annulez le comptage avant de modifier le capital.",
    );
  }

  const now = new Date().toISOString();
  const motif = (input.motif ?? "").trim();
  const db = await getDb();
  const result = await db.collection<CaisseDoc>("caisses_sessions").updateOne(
    {
      _id: new ObjectId(existing.id),
      statut: "ouverte" satisfies CaisseStatut,
    },
    {
      $set: {
        soldeInitial,
        date,
        updatedAt: now,
        ...(motif
          ? {
              commentaire: existing.commentaire
                ? `${existing.commentaire}\n[Capital ${date}] ${motif}`
                : `[Capital ${date}] ${motif}`,
            }
          : {}),
      },
    },
  );
  if (result.modifiedCount !== 1) {
    throw new Error("Impossible de modifier le capital de cette caisse.");
  }

  const updated = await getCaisseById(existing.id);
  if (!updated) throw new Error("Caisse introuvable");
  return updated;
}

/**
 * Passe la session en phase de comptage : plus d'encaissement POS ni de
 * mouvements jusqu'à clôture ou annulation du comptage.
 */
export async function startComptageCaisse(input: {
  id: string;
  user: SessionUser;
}): Promise<CaisseSession> {
  const session = await getCaisseById(input.id);
  if (!session) throw new Error("Caisse introuvable");
  assertAcces(input.user, session.caisse);
  if (session.statut === "fermee") {
    throw new Error("Caisse déjà clôturée");
  }
  if (session.statut === "en_comptage") return session;

  const now = new Date().toISOString();
  const db = await getDb();
  const result = await db.collection<CaisseDoc>("caisses_sessions").updateOne(
    { _id: new ObjectId(input.id), statut: "ouverte" },
    {
      $set: {
        statut: "en_comptage" satisfies CaisseStatut,
        comptageStartedAt: now,
        updatedAt: now,
      },
    },
  );
  if (result.modifiedCount !== 1) {
    throw new Error("Impossible de démarrer le comptage (caisse déjà modifiée).");
  }
  const updated = await getCaisseById(input.id);
  if (!updated) throw new Error("Caisse introuvable après comptage");
  return updated;
}

/** Reprend l'encaissement après un comptage non validé. */
export async function cancelComptageCaisse(input: {
  id: string;
  user: SessionUser;
}): Promise<CaisseSession> {
  const session = await getCaisseById(input.id);
  if (!session) throw new Error("Caisse introuvable");
  assertAcces(input.user, session.caisse);
  if (session.statut !== "en_comptage") {
    throw new Error("La caisse n'est pas en phase de comptage.");
  }

  const now = new Date().toISOString();
  const db = await getDb();
  const result = await db.collection<CaisseDoc>("caisses_sessions").updateOne(
    { _id: new ObjectId(input.id), statut: "en_comptage" },
    {
      $set: {
        statut: "ouverte" satisfies CaisseStatut,
        comptageStartedAt: null,
        updatedAt: now,
      },
    },
  );
  if (result.modifiedCount !== 1) {
    throw new Error("Impossible d'annuler le comptage.");
  }
  const updated = await getCaisseById(input.id);
  if (!updated) throw new Error("Caisse introuvable");
  return updated;
}

export async function closeCaisse(input: {
  id: string;
  user: SessionUser;
  soldePhysique: number;
  commentaire?: string | null;
  justificationEcart?: string | null;
}): Promise<CaisseSession> {
  const session = await getCaisseById(input.id);
  if (!session) throw new Error("Caisse introuvable");
  // Caisse partagée : ce n'est plus l'ouvreur qui ferme, c'est celui qui
  // compte le tiroir. Son nom est consigné.
  assertAcces(input.user, session.caisse);
  if (!isCaisseSessionActive(session.statut)) {
    throw new Error("Caisse déjà clôturée");
  }

  const theo = calcSoldeTheorique(session);
  const { soldePhysique, ecart, soldeTheorique } = assertClotureValide({
    soldeTheorique: theo,
    soldePhysique: input.soldePhysique,
    justificationEcart: input.justificationEcart ?? input.commentaire,
  });

  const now = new Date().toISOString();
  const justification =
    ecart === 0
      ? null
      : (input.justificationEcart ?? input.commentaire)?.trim() || null;
  const observation = input.commentaire?.trim() || null;

  const db = await getDb();
  const result = await db.collection<CaisseDoc>("caisses_sessions").updateOne(
    {
      _id: new ObjectId(input.id),
      statut: { $in: ["ouverte", "en_comptage"] satisfies CaisseStatut[] },
    },
    {
      $set: {
        statut: "fermee" satisfies CaisseStatut,
        soldePhysique,
        soldeFermeture: soldePhysique,
        soldeTheoriqueCloture: soldeTheorique,
        ecart,
        justificationEcart: justification,
        commentaire: observation,
        closedAt: now,
        closedById: input.user.id,
        closedByName: input.user.name,
        updatedAt: now,
      },
    },
  );
  if (result.modifiedCount !== 1) {
    throw new Error("Clôture impossible : la caisse a déjà été modifiée.");
  }
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
  kind: Extract<
    CaisseMouvementKind,
    "depense" | "recette" | "versement-entree"
  >;
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
    if (session.statut === "en_comptage") {
      throw new Error(
        "Caisse en comptage : mouvements interdits jusqu'à clôture ou reprise.",
      );
    }
    throw new Error("Impossible d’ajouter un mouvement sur une caisse fermée");
  }
  const nature = input.nature.trim();
  if (nature.length < 2) throw new Error("Nature trop courte");
  const montant = Math.round(Number(input.montant) || 0);
  if (montant <= 0) throw new Error("Montant invalide");
  // Un tiroir ne peut pas passer en négatif (pas de découvert par défaut).
  const soldeAvant = calcSoldeTheorique(session);
  if (input.kind === "depense") {
    assertSortieDansSolde(soldeAvant, montant);
  }
  const soldeApres = soldeApresMouvement(soldeAvant, input.kind, montant);

  const now = new Date().toISOString();
  const mDoc: MouvementDoc = {
    _id: new ObjectId(),
    caisseId: input.caisseId,
    kind: input.kind,
    nature,
    beneficiaire: input.beneficiaire.trim() || "—",
    montant,
    at: now,
    soldeAvant,
    soldeApres,
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

  const field =
    input.kind === "depense"
      ? "totalDepense"
      : input.kind === "versement-entree"
        ? "totalVersementRecu"
        : "totalRecette";

  if (input.kind === "depense") {
    // Contrôle + incrément atomiques : solde = initial + versements − sorties
    // (sans ventes POS).
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
 * Annule une dépense, une recette ou un versement d'entrée : le mouvement
 * reste au journal, barré, et le total de session reprend le montant.
 * Les versements inter-caisses historiques (sortie + entrée liées) ne
 * s'annulent pas ici.
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
  if (
    mDoc.kind !== "depense" &&
    mDoc.kind !== "recette" &&
    mDoc.kind !== "versement-entree"
  ) {
    throw new Error(
      "Seules les dépenses, recettes et versements d'entrée peuvent être annulés.",
    );
  }

  const session = await getCaisseById(mDoc.caisseId);
  if (!session) throw new Error("Caisse introuvable");
  assertAcces(input.user, session.caisse);
  if (session.statut !== "ouverte" && !input.allowClosed) {
    if (session.statut === "en_comptage") {
      throw new Error(
        "Caisse en comptage : annulation interdite jusqu'à clôture ou reprise.",
      );
    }
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

  const field =
    mDoc.kind === "depense"
      ? "totalDepense"
      : mDoc.kind === "versement-entree"
        ? "totalVersementRecu"
        : "totalRecette";
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
  totaux: CaisseSoldeTotaux;
  ecart: number | null;
}> {
  const session = await getCaisseById(id);
  if (!session) throw new Error("Caisse introuvable");
  const mouvements = await listMouvements(id);
  const totaux = soldeTotaux(session);
  const theo =
    session.statut === "fermee" &&
    typeof session.soldeTheoriqueCloture === "number"
      ? Math.round(session.soldeTheoriqueCloture)
      : totaux.soldeCourant;
  const ecart =
    typeof session.ecart === "number" && Number.isFinite(session.ecart)
      ? Math.round(session.ecart)
      : session.soldePhysique === null
        ? null
        : session.soldePhysique - theo;
  return { session, mouvements, soldeTheorique: theo, totaux, ecart };
}

/** Génère un id de mouvement client-side si besoin */
export function newMouvementId(): string {
  return newId("cm");
}
