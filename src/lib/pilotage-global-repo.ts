import type { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { CAISSE_LABELS } from "@/lib/caisse-model";
import type { CaisseDoc, MouvementDoc } from "@/lib/caisse-repo";
import { PERTE_MOTIF_LABELS } from "@/lib/types";
import type { CaisseKey, CaisseMouvement, PerteMotif, VenteSite } from "@/lib/types";

/** Formes brutes des documents Mongo lus ici — délibérément locales et
 *  minimales : les types applicatifs (`VenteLogEntry`, `PosTicket`…) sont
 *  déjà nettoyés (id: string, champs optionnels résolus) et ne correspondent
 *  pas à la forme exacte des documents en base. */
type VenteLogDoc = {
  _id: ObjectId;
  date: string;
  site: VenteSite;
  kind: string;
  name: string;
  qty: number;
  unitPrice: number;
  amount: number;
  at: string;
  cancelledAt: string | null;
  caExcluded?: boolean;
};

type PosTicketDoc = {
  _id: ObjectId;
  date: string;
  site: VenteSite;
  numero: string;
  saleType: string;
  clientNom: string | null;
  reduction: number;
  caisseId: string | null;
  lines: Array<{ venteLogId?: string | null }>;
};

type PerteDoc = {
  _id: ObjectId;
  date: string;
  site: VenteSite;
  kind: string;
  name: string;
  qty: number;
  cost: number;
  motif: PerteMotif;
  commentaire: string;
  at: string;
  cancelledAt: string | null;
  actorName: string | null;
};

type MouvementStockDoc = {
  id: string;
  at: string;
  type: string;
  name: string;
  qty: number;
  unitPrice?: number;
  stockAfter: number;
  cancelledAt: string | null;
  fournisseurId?: string | null;
  fournisseurNom?: string | null;
};

type LigneAccompagnementDoc = {
  productId: string;
  name: string;
  initialStock: number;
  prepared: number;
  sold: number;
  pertes: number;
  counted: number | null;
  observations: string;
};

type LigneTransfertDoc = LigneAccompagnementDoc & { received?: number };

type ZogboDocRaw = {
  _id: string;
  updatedAt: string | null;
  movements?: MouvementStockDoc[];
  accompanimentLines?: LigneAccompagnementDoc[];
};

type GbegameyDocRaw = {
  _id: string;
  updatedAt: string | null;
  transferLines?: LigneTransfertDoc[];
  localLines?: LigneAccompagnementDoc[];
};

type MatieresDocRaw = { _id: string; movements?: MouvementStockDoc[] };
type BoissonsDocRaw = { _id: string; movements?: MouvementStockDoc[] };
type ChargesDocRaw = {
  _id: string;
  updatedAt?: string | null;
  loyer?: number;
  salaires?: number;
  electricite?: number;
  carburant?: number;
  reparations?: number;
};

/**
 * Agrégation en lecture seule pour le Centre de pilotage global.
 *
 * Cette page consolide huit collections qui n'ont jamais été pensées pour
 * partager une forme commune : certaines tiennent un vrai journal d'
 * événements horodatés (`ventes_log`, `caisse_mouvements`, les mouvements
 * Zogbo/boissons/matières), d'autres ne sont que l'état courant d'une
 * journée, sans trace de qui a changé quoi ni quand (`gbegamey_jours` — pas
 * de tableau `movements`). Pour ces dernières, une ligne « snapshot » est
 * produite par produit actif du jour, horodatée à la dernière sauvegarde de
 * la journée — ce n'est pas un événement réel, c'est signalé dans `detail`.
 *
 * Deux limitations honnêtes, gardées volontairement plutôt que masquées :
 *  - Une dépense de caisse saisie en texte libre (Caisse ou Achats →
 *    Dépenses) ne peut pas être distinguée d'un « achat » à proprement
 *    parler : les deux écrivent le même document `caisse_mouvements`, sans
 *    champ qui les différencie. Seuls les achats structurés de l'onglet
 *    Achats → Stock (fournisseur, quantité, prix) apparaissent en type
 *    `achat` ; le reste reste `caisse`.
 *  - Les mouvements de matières et de plats Zogbo ne portent aucun auteur
 *    dans leur schéma actuel (`user: null` sur ces lignes) — l'information
 *    n'existe simplement pas encore dans la base.
 */

export type PilotageType =
  | "vente"
  | "caisse"
  | "achat"
  | "perte"
  | "zogbo"
  | "gbegamey"
  | "stock"
  | "transfert"
  | "reprise"
  | "autre";

export type PilotageRow = {
  id: string;
  date: string;
  time: string;
  at: string;
  site: VenteSite | "centrale" | null;
  type: PilotageType;
  reference: string;
  description: string;
  quantity: number | null;
  /** FCFA pour l'argent, sinon l'unité du produit (bouteille, casier…). */
  unit: string;
  in: number;
  out: number;
  /** Solde théorique après l'opération — seulement pour les lignes caisse. */
  solde: number | null;
  user: string | null;
  detail: Record<string, unknown>;
};

export type PilotageSummary = {
  caTotal: number;
  achats: number;
  pertes: number;
  soldeCaisse: number;
  /** CA − achats − pertes − autres charges (loyer, salaires…). Indicatif :
   *  peut différer du Compte de résultat si sa charge « matières » saisie à
   *  la main n'a pas été alignée sur les achats réels. */
  resultatNet: number;
  operations: number;
  derniereMiseAJour: string | null;
};

export type PilotageStats = {
  parJour: Array<{
    date: string;
    ca: number;
    achats: number;
    pertes: number;
    resultat: number;
  }>;
  parSite: Array<{
    site: string;
    ca: number;
    pertes: number;
    soldeCaisse: number;
  }>;
  parCategorie: Array<{ categorie: string; ca: number }>;
};

export type PilotagePayload = {
  from: string;
  to: string;
  summary: PilotageSummary;
  stats: PilotageStats;
  rows: PilotageRow[];
  rowsTronquees: boolean;
  totalOperations: number;
};

/** Même formule que `caisse-model.soldeTheorique`, appliquée au document
 *  Mongo brut plutôt qu'au type applicatif `CaisseSession`. */
function soldeTheoDoc(d: CaisseDoc): number {
  return (
    d.soldeInitial +
    d.totalVente +
    d.totalRecette +
    (Number(d.totalVersementRecu) || 0) -
    d.totalDepense -
    (Number(d.totalVersementSorti) || 0)
  );
}

const CAP_ROWS = 2000;
const CAP_SOURCE = 5000;

function isValidDate(d: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(d);
}

function hhmm(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      timeStyle: "short",
      timeZone: "Africa/Porto-Novo",
    }).format(new Date(iso));
  } catch {
    return "—";
  }
}

const KIND_LABELS: Record<string, string> = {
  plat: "Plat",
  local: "Accompagnement",
  boisson: "Boisson",
  combo: "Combo",
  extra: "Vente libre",
};

const CHARGE_LABELS: Record<string, string> = {
  loyer: "Charge locative",
  salaires: "Salaires",
  electricite: "Électricité",
  carburant: "Carburant",
  reparations: "Réparations / entretien",
};

function normalise(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function siteAutorise(rowSite: PilotageRow["site"], site: VenteSite | null): boolean {
  if (!site) return true;
  // Les lignes sans zone (matières, charges) n'appartiennent à aucun site
  // précis : elles disparaissent dès qu'on filtre sur une zone, plutôt que
  // d'être arbitrairement rattachées à l'une ou l'autre.
  return rowSite === site;
}

export async function getPilotageGlobal(input: {
  from: string;
  to: string;
  site?: VenteSite | null;
  type?: PilotageType | null;
  q?: string | null;
}): Promise<PilotagePayload> {
  if (!isValidDate(input.from) || !isValidDate(input.to) || input.from > input.to) {
    throw new Error("Période invalide.");
  }
  const { from, to } = input;
  const site = input.site ?? null;
  const db = await getDb();

  const [ventes, tickets, sessions, mouvements, pertes, zogboDocs, gbegameyDocs, matieresDocs, boissonsDocs, chargesDocs] =
    await Promise.all([
      db
        .collection<VenteLogDoc>("ventes_log")
        .find({
          date: { $gte: from, $lte: to },
          cancelledAt: null,
          caExcluded: { $ne: true },
          ...(site ? { site } : {}),
        })
        .sort({ at: -1 })
        .limit(CAP_SOURCE)
        .toArray(),
      db
        .collection<PosTicketDoc>("pos_tickets")
        .find({ date: { $gte: from, $lte: to }, ...(site ? { site } : {}) })
        .project<PosTicketDoc>({ numero: 1, saleType: 1, clientNom: 1, reduction: 1, lines: 1, caisseId: 1 })
        .toArray(),
      db
        .collection<CaisseDoc>("caisses_sessions")
        .find({ date: { $gte: from, $lte: to } })
        .toArray(),
      // Filtré ensuite par session : `caisse_mouvements` ne porte ni date ni
      // site en propre, seulement `caisseId`. Les mouvements annulés (T9) sont
      // exclus, comme les pertes annulées ci-dessous.
      db
        .collection<MouvementDoc>("caisse_mouvements")
        .find({ cancelledAt: null })
        .toArray(),
      db
        .collection<PerteDoc>("pertes")
        .find({
          date: { $gte: from, $lte: to },
          cancelledAt: null,
          ...(site ? { site } : {}),
        })
        .limit(CAP_SOURCE)
        .toArray(),
      db.collection<ZogboDocRaw>("zogbo_jours").find({ _id: { $gte: from, $lte: to } }).toArray(),
      db.collection<GbegameyDocRaw>("gbegamey_jours").find({ _id: { $gte: from, $lte: to } }).toArray(),
      db.collection<MatieresDocRaw>("matieres_jours").find({ _id: { $gte: from, $lte: to } }).toArray(),
      db.collection<BoissonsDocRaw>("boissons_jours").find({ _id: { $gte: from, $lte: to } }).toArray(),
      db
        .collection<ChargesDocRaw>("charges_jours")
        .find({ _id: { $gte: from, $lte: to } })
        .toArray(),
    ]);

  // Sessions concernées, indexées pour retrouver la zone/caisse d'un
  // mouvement et pour ne garder que les mouvements de la période demandée.
  const sessionById = new Map(sessions.map((s) => [s._id.toHexString(), s]));
  const ticketByVenteLogId = new Map<string, PosTicketDoc>();
  for (const t of tickets) {
    for (const l of t.lines ?? []) {
      if (l.venteLogId) ticketByVenteLogId.set(l.venteLogId, t);
    }
  }

  const rows: PilotageRow[] = [];

  // ——— Ventes ——————————————————————————————————————————————————————
  for (const e of ventes) {
    const id = e._id.toHexString();
    const ticket = ticketByVenteLogId.get(id);
    rows.push({
      id: `vente-${id}`,
      date: e.date,
      time: hhmm(e.at),
      at: e.at,
      site: e.site,
      type: "vente",
      reference: ticket?.numero ?? `V-${id.slice(-6)}`,
      description: e.name,
      quantity: e.qty,
      unit: "FCFA",
      in: e.amount,
      out: 0,
      solde: null,
      user: null,
      detail: {
        kind: KIND_LABELS[e.kind] ?? e.kind,
        unitPrice: e.unitPrice,
        mode: ticket?.saleType ?? null,
        client: ticket?.clientNom ?? null,
        reduction: ticket?.reduction ?? null,
        caisse: ticket?.caisseId ? sessionCaisseLabel(sessionById, ticket.caisseId) : null,
      },
    });
  }

  // ——— Caisse : ouverture / clôture / mouvements ————————————————————
  for (const s of sessions) {
    const sId = s._id.toHexString();
    const zone: PilotageRow["site"] = s.site ?? "centrale";
    rows.push({
      id: `caisse-open-${sId}`,
      date: s.date,
      time: hhmm(s.openedAt),
      at: s.openedAt,
      site: zone,
      type: "caisse",
      reference: CAISSE_LABELS[s.caisse ?? (s.site as CaisseKey) ?? "zogbo"],
      description: "Ouverture de caisse",
      quantity: null,
      unit: "FCFA",
      in: s.soldeInitial,
      out: 0,
      solde: s.soldeInitial,
      user: s.userName,
      detail: { fondDeCaisse: s.soldeInitial },
    });
    if (s.statut === "fermee" && s.closedAt) {
      const theo = soldeTheoDoc(s);
      rows.push({
        id: `caisse-close-${sId}`,
        date: s.date,
        time: hhmm(s.closedAt),
        at: s.closedAt,
        site: zone,
        type: "caisse",
        reference: CAISSE_LABELS[s.caisse ?? (s.site as CaisseKey) ?? "zogbo"],
        description: "Clôture de caisse",
        quantity: null,
        unit: "FCFA",
        in: 0,
        out: 0,
        solde: s.soldePhysique,
        user: s.closedByName ?? s.userName,
        detail: {
          soldeTheorique: theo,
          soldePhysique: s.soldePhysique,
          ecart: s.soldePhysique === null ? null : s.soldePhysique - theo,
          commentaire: s.commentaire,
        },
      });
    }
  }
  for (const m of mouvements) {
    const s = sessionById.get(m.caisseId);
    if (!s) continue; // hors période demandée
    const zone: PilotageRow["site"] = s.site ?? "centrale";
    const entrant = m.kind === "recette" || m.kind === "versement-entree";
    rows.push({
      id: `caisse-mvt-${m._id.toHexString()}`,
      date: s.date,
      time: hhmm(m.at),
      at: m.at,
      site: zone,
      type: "caisse",
      reference: CAISSE_LABELS[s.caisse ?? (s.site as CaisseKey) ?? "zogbo"],
      description: `${MOUVEMENT_LABEL(m.kind)} · ${m.nature}`,
      quantity: null,
      unit: "FCFA",
      in: entrant ? m.montant : 0,
      out: entrant ? 0 : m.montant,
      solde: null,
      user: m.actorName ?? null,
      detail: { beneficiaire: m.beneficiaire, contrepartie: m.contrepartie },
    });
  }

  // ——— Achats : mouvements structurés de matières ——————————————————
  for (const doc of matieresDocs) {
    for (const m of doc.movements ?? []) {
      if (m.cancelledAt) continue;
      rows.push({
        id: `achat-${m.id}`,
        date: doc._id,
        time: hhmm(m.at),
        at: m.at,
        site: null,
        type: "achat",
        reference: m.fournisseurNom ?? "Fournisseur non précisé",
        description: m.name,
        quantity: m.qty,
        unit: "unité",
        in: 0,
        out: m.qty * (m.unitPrice ?? 0),
        solde: m.stockAfter,
        user: null,
        detail: { unitPrice: m.unitPrice, fournisseurId: m.fournisseurId },
      });
    }
  }

  // ——— Pertes —————————————————————————————————————————————————————
  for (const p of pertes) {
    rows.push({
      id: `perte-${p._id.toHexString()}`,
      date: p.date,
      time: hhmm(p.at),
      at: p.at,
      site: p.site,
      type: "perte",
      reference: PERTE_MOTIF_LABELS[p.motif],
      description: p.name,
      quantity: p.qty,
      unit: "unité",
      in: 0,
      out: p.cost,
      solde: null,
      user: p.actorName,
      detail: { famille: p.kind, commentaire: p.commentaire },
    });
  }

  // ——— Zogbo : mouvements réels (préparé/envoyé) —————————————————————
  for (const doc of zogboDocs) {
    for (const m of doc.movements ?? []) {
      if (m.cancelledAt) continue;
      const estTransfert = m.type === "send";
      rows.push({
        id: `zogbo-mvt-${m.id}`,
        date: doc._id,
        time: hhmm(m.at),
        at: m.at,
        site: "zogbo",
        type: estTransfert ? "transfert" : "zogbo",
        reference: estTransfert ? "Envoi → Gbégamey" : "Préparation",
        description: m.name,
        quantity: m.qty,
        unit: "unité",
        in: estTransfert ? 0 : m.qty,
        out: estTransfert ? m.qty : 0,
        solde: m.stockAfter,
        user: null,
        detail: {},
      });
    }
    // Accompagnements Zogbo : pas de journal d'événements, une ligne
    // « photo » par produit actif du jour (signalé dans detail.snapshot).
    for (const l of doc.accompanimentLines ?? []) {
      if (!(l.initialStock > 0 || l.prepared > 0 || l.counted !== null || l.pertes > 0)) continue;
      rows.push({
        id: `zogbo-acc-${doc._id}-${l.productId}`,
        date: doc._id,
        time: hhmm(doc.updatedAt),
        at: doc.updatedAt ?? `${doc._id}T12:00:00.000+01:00`,
        site: "zogbo",
        type: "zogbo",
        reference: "Accompagnement",
        description: l.name,
        quantity: l.counted,
        unit: "unité",
        in: l.prepared,
        out: l.sold,
        solde: l.counted,
        user: null,
        detail: { snapshot: true, initial: l.initialStock, observations: l.observations },
      });
    }
  }

  // ——— Gbégamey : pas de journal — une ligne « photo » par produit ————
  for (const doc of gbegameyDocs) {
    for (const l of doc.transferLines ?? []) {
      if (!(l.initialStock > 0 || (l.received ?? 0) > 0 || l.sold > 0 || l.counted !== null)) continue;
      rows.push({
        id: `gbegamey-t-${doc._id}-${l.productId}`,
        date: doc._id,
        time: hhmm(doc.updatedAt),
        at: doc.updatedAt ?? `${doc._id}T12:00:00.000+01:00`,
        site: "gbegamey",
        type: "gbegamey",
        reference: "Reçu de Zogbo",
        description: l.name,
        quantity: l.counted,
        unit: "unité",
        in: l.received ?? 0,
        out: l.sold,
        solde: l.counted,
        user: null,
        detail: { snapshot: true, initial: l.initialStock },
      });
    }
    for (const l of doc.localLines ?? []) {
      if (!(l.initialStock > 0 || l.prepared > 0 || l.counted !== null || l.pertes > 0)) continue;
      rows.push({
        id: `gbegamey-l-${doc._id}-${l.productId}`,
        date: doc._id,
        time: hhmm(doc.updatedAt),
        at: doc.updatedAt ?? `${doc._id}T12:00:00.000+01:00`,
        site: "gbegamey",
        type: "gbegamey",
        reference: "Sur place",
        description: l.name,
        quantity: l.counted,
        unit: "unité",
        in: l.prepared,
        out: l.sold,
        solde: l.counted,
        user: null,
        detail: { snapshot: true, initial: l.initialStock },
      });
    }
  }

  // ——— Stock : achats de casiers de boissons ——————————————————————
  for (const doc of boissonsDocs) {
    for (const m of doc.movements ?? []) {
      if (m.cancelledAt) continue;
      rows.push({
        id: `boisson-${m.id}`,
        date: doc._id,
        time: hhmm(m.at),
        at: m.at,
        site: null,
        type: "stock",
        reference: "Achat casiers",
        description: m.name,
        quantity: m.qty,
        unit: "casier",
        in: m.qty,
        out: 0,
        solde: m.stockAfter,
        user: null,
        detail: {},
      });
    }
  }

  // ——— Autre : charges d'exploitation saisies à la main ——————————————
  for (const doc of chargesDocs) {
    for (const key of Object.keys(CHARGE_LABELS) as (keyof typeof CHARGE_LABELS)[]) {
      const montant = Number((doc as unknown as Record<string, number>)[key]) || 0;
      if (montant <= 0) continue;
      rows.push({
        id: `charge-${doc._id}-${key}`,
        date: doc._id,
        time: "—",
        at: doc.updatedAt ?? `${doc._id}T00:00:00.000+01:00`,
        site: null,
        type: "autre",
        reference: "Charge d'exploitation",
        description: CHARGE_LABELS[key],
        quantity: null,
        unit: "FCFA",
        in: 0,
        out: montant,
        solde: null,
        user: null,
        detail: {},
      });
    }
  }

  // ——— Filtres site / type / recherche, puis tri et troncature ————————
  let filtered = rows.filter((r) => siteAutorise(r.site, site));
  if (input.type) filtered = filtered.filter((r) => r.type === input.type);
  if (input.q && input.q.trim()) {
    const needle = normalise(input.q.trim());
    const numeric = Number(input.q.replace(/[^\d.-]/g, ""));
    filtered = filtered.filter((r) => {
      const texte = normalise(
        [r.description, r.reference, r.user ?? "", r.date, r.site ?? "", r.type].join(" "),
      );
      if (texte.includes(needle)) return true;
      if (Number.isFinite(numeric) && numeric !== 0) {
        return r.in === numeric || r.out === numeric || r.quantity === numeric;
      }
      return false;
    });
  }

  const totalOperations = filtered.length;
  filtered.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const rowsTronquees = filtered.length > CAP_ROWS;
  const finalRows = filtered.slice(0, CAP_ROWS);

  // ——— Résumé et statistiques : calculés sur l'ensemble filtré, jamais
  // sur la liste tronquée — sinon les totaux mentiraient dès que la
  // période dépasse la limite d'affichage. ——————————————————————————
  const caTotal = sumWhere(filtered, (r) => r.type === "vente", (r) => r.in);
  const achats = sumWhere(filtered, (r) => r.type === "achat", (r) => r.out);
  const pertesTotal = sumWhere(filtered, (r) => r.type === "perte", (r) => r.out);
  const autresCharges = sumWhere(filtered, (r) => r.type === "autre", (r) => r.out);
  const soldeCaisse = sessions
    .filter((s) => s.statut === "ouverte" && siteAutorise(s.site ?? "centrale", site))
    .reduce((sum, s) => sum + soldeTheoDoc(s), 0);

  const parJourMap = new Map<string, { ca: number; achats: number; pertes: number }>();
  for (const r of filtered) {
    if (!["vente", "achat", "perte"].includes(r.type)) continue;
    const acc = parJourMap.get(r.date) ?? { ca: 0, achats: 0, pertes: 0 };
    if (r.type === "vente") acc.ca += r.in;
    if (r.type === "achat") acc.achats += r.out;
    if (r.type === "perte") acc.pertes += r.out;
    parJourMap.set(r.date, acc);
  }
  const parJour = [...parJourMap.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, v]) => ({ ...v, date, resultat: v.ca - v.achats - v.pertes }));

  const parSite = (["zogbo", "gbegamey"] as VenteSite[])
    .filter((s) => !site || site === s)
    .map((s) => ({
      site: s,
      ca: sumWhere(filtered, (r) => r.type === "vente" && r.site === s, (r) => r.in),
      pertes: sumWhere(filtered, (r) => r.type === "perte" && r.site === s, (r) => r.out),
      soldeCaisse: sessions
        .filter((sess) => sess.statut === "ouverte" && sess.site === s)
        .reduce((sum, sess) => sum + soldeTheoDoc(sess), 0),
    }));

  const parCategorieMap = new Map<string, number>();
  for (const r of filtered) {
    if (r.type !== "vente") continue;
    const cat = String(r.detail.kind ?? "Autre");
    parCategorieMap.set(cat, (parCategorieMap.get(cat) ?? 0) + r.in);
  }
  const parCategorie = [...parCategorieMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([categorie, ca]) => ({ categorie, ca }));

  const derniereMiseAJour = finalRows[0]?.at ?? null;

  return {
    from,
    to,
    summary: {
      caTotal,
      achats,
      pertes: pertesTotal,
      soldeCaisse,
      resultatNet: caTotal - achats - pertesTotal - autresCharges,
      operations: totalOperations,
      derniereMiseAJour,
    },
    stats: { parJour, parSite, parCategorie },
    rows: finalRows,
    rowsTronquees,
    totalOperations,
  };
}

function sumWhere<T>(rows: T[], pred: (r: T) => boolean, val: (r: T) => number): number {
  let s = 0;
  for (const r of rows) if (pred(r)) s += val(r);
  return s;
}

function MOUVEMENT_LABEL(kind: CaisseMouvement["kind"]): string {
  switch (kind) {
    case "depense":
      return "Dépense";
    case "recette":
      return "Recette";
    case "versement-sortie":
      return "Versement envoyé";
    case "versement-entree":
      return "Versement reçu";
    default:
      return kind;
  }
}

function sessionCaisseLabel(
  sessionById: Map<string, CaisseDoc>,
  caisseId: string,
): string | null {
  const s = sessionById.get(caisseId);
  if (!s) return null;
  const cle: CaisseKey = s.caisse ?? s.site ?? "centrale";
  return CAISSE_LABELS[cle];
}
