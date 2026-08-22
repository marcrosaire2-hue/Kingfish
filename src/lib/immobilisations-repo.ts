import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { SessionUser } from "@/lib/auth-types";
import {
  addCaisseMouvement,
  cancelCaisseMouvement,
  resolveCaisseForDepense,
} from "@/lib/caisse-repo";
import { todayIsoDate } from "@/lib/zogbo-calc";
import type { Immobilisation, ImmobilisationKind, VenteSite } from "@/lib/types";

type ImmobilisationDoc = Omit<Immobilisation, "id"> & {
  _id: ObjectId;
  /**
   * Quantité réellement acquise et son montant (qty × coût), figés à la
   * création et recalculés seulement quand une correction change
   * explicitement la quantité, le coût, le jour ou la zone de la fiche. Une
   * perte ultérieure fait baisser `qty` (stock restant, vivant) sans jamais
   * toucher ces deux champs : le compte de résultat du jour d'acquisition ne
   * doit pas se réécrire des semaines plus tard parce qu'un emballage a
   * cassé — la perte se valorise séparément, à sa propre date.
   */
  acquisitionQty?: number;
  acquisitionAmount?: number;
};

/**
 * Zone débitée pour l'acquisition : celle de la fiche si elle en a une,
 * sinon celle de l'utilisateur (admin « tous » → Zogbo par défaut, comme les
 * autres écrans qui doivent trancher entre les deux caisses).
 */
function depenseSite(
  itemSite: VenteSite | null,
  user: SessionUser,
): VenteSite {
  if (itemSite === "zogbo" || itemSite === "gbegamey") return itemSite;
  if (user.site === "zogbo" || user.site === "gbegamey") return user.site;
  return "zogbo";
}

/**
 * Lie (ou relie) l'acquisition à une dépense de caisse — même mécanique que
 * les achats de matières : sans ça, l'argent sortirait du tiroir sans que la
 * caisse ne le sache. Best-effort : une fiche reste enregistrable même si
 * aucune caisse n'est disponible pour porter la dépense (jour sans caisse).
 */
async function attachDepense(input: {
  user: SessionUser;
  date: string;
  site: VenteSite | null;
  name: string;
  qty: number;
  montant: number;
}): Promise<string | null> {
  if (input.montant <= 0) return null;
  try {
    const { session, allowClosed } = await resolveCaisseForDepense({
      site: depenseSite(input.site, input.user),
      date: input.date,
      // La route est déjà réservée au gérant/admin (canManagePastVentes) :
      // pas besoin de revérifier le rôle ici.
      allowPastClosed: input.date < todayIsoDate(),
    });
    if (!session) return null;
    const res = await addCaisseMouvement({
      caisseId: session.id,
      user: input.user,
      kind: "depense",
      nature: `Immobilisation · ${input.name} +${input.qty}`,
      beneficiaire: "",
      montant: input.montant,
      allowClosed,
    });
    return res.mouvement.id;
  } catch {
    return null;
  }
}

/** Annule au mieux la dépense liée : une fiche corrigée/soldée ne doit pas
 *  laisser une dépense fantôme si elle échoue (caisse déjà réconciliée…). */
async function detachDepense(
  depenseId: string | null,
  user: SessionUser,
): Promise<void> {
  if (!depenseId) return;
  try {
    await cancelCaisseMouvement({
      mouvementId: depenseId,
      user,
      allowClosed: true,
    });
  } catch {
    /* best effort : la fiche reste corrigée même si la dépense liée ne l'est pas */
  }
}

function isValidDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

function normalizeUnit(raw: string | undefined | null): string {
  return String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 40);
}

function toEntry(doc: ImmobilisationDoc): Immobilisation {
  return {
    id: doc._id.toHexString(),
    name: doc.name,
    kind: doc.kind,
    // 0 est une quantité légitime (stock épuisé par une perte) — seul un
    // champ manquant (fiche antérieure à ce compteur) retombe sur 1.
    qty:
      doc.qty === null || doc.qty === undefined
        ? 1
        : Math.max(0, Math.round(Number(doc.qty) || 0)),
    unit: normalizeUnit(doc.unit) || "pièce",
    cost: Math.max(0, Math.round(Number(doc.cost) || 0)),
    salePrice:
      doc.salePrice === null || doc.salePrice === undefined
        ? null
        : Math.max(0, Math.round(Number(doc.salePrice) || 0)),
    date: doc.date,
    site: doc.site ?? null,
    notes: String(doc.notes ?? ""),
    active: doc.active !== false,
    depenseId: doc.depenseId ?? null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    dureeUtiliteAnnees:
      doc.dureeUtiliteAnnees === null || doc.dureeUtiliteAnnees === undefined
        ? null
        : Math.max(1, Math.round(Number(doc.dureeUtiliteAnnees) || 0)),
  };
}

function normalizeName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

export async function listImmobilisations(input?: {
  kind?: ImmobilisationKind | "all";
  active?: boolean | "all";
  /** Filtre site : inclut aussi les fiches « tous sites » (site null). */
  site?: VenteSite | "all";
}): Promise<Immobilisation[]> {
  const filter: Record<string, unknown> = {};
  if (input?.kind && input.kind !== "all") filter.kind = input.kind;
  if (input?.active === true) filter.active = true;
  if (input?.active === false) filter.active = false;
  if (input?.site && input.site !== "all") {
    filter.$or = [{ site: input.site }, { site: null }];
  }

  const db = await getDb();
  const docs = await db
    .collection<ImmobilisationDoc>("immobilisations")
    .find(filter)
    .sort({ active: -1, name: 1 })
    .toArray();
  return docs.map(toEntry);
}

export async function createImmobilisation(input: {
  name: string;
  kind: ImmobilisationKind;
  qty?: number;
  unit?: string;
  cost?: number;
  salePrice?: number | null;
  date: string;
  site?: VenteSite | null;
  notes?: string;
  dureeUtiliteAnnees?: number | null;
  user: SessionUser;
}): Promise<Immobilisation> {
  const name = normalizeName(input.name);
  if (name.length < 2) throw new Error("Nom trop court (2 caractères min.).");
  if (name.length > 120) throw new Error("Nom trop long (120 caractères max.).");
  if (input.kind !== "actif" && input.kind !== "emballage") {
    throw new Error("Type invalide (actif ou emballage).");
  }
  if (!isValidDate(input.date)) throw new Error("Date invalide.");

  const qty = Math.max(1, Math.round(Number(input.qty) || 0));
  const unit = normalizeUnit(input.unit) || "pièce";
  const cost = Math.max(0, Math.round(Number(input.cost) || 0));
  // Valeur facultative, quel que soit le type : une fiche peut être créée
  // sans montant et complétée plus tard (elle reste alors invendable en
  // caisse tant que la valeur n'est pas renseignée, sans bloquer sa saisie).
  const rawSalePrice =
    input.salePrice === null || input.salePrice === undefined
      ? null
      : Math.max(0, Math.round(Number(input.salePrice) || 0));
  const salePrice: number | null =
    rawSalePrice && rawSalePrice > 0 ? rawSalePrice : null;

  const site =
    input.site === "zogbo" || input.site === "gbegamey" ? input.site : null;
  const dureeUtiliteAnnees =
    input.dureeUtiliteAnnees === null || input.dureeUtiliteAnnees === undefined
      ? null
      : Math.max(1, Math.round(Number(input.dureeUtiliteAnnees) || 0));
  const now = new Date().toISOString();
  const doc: ImmobilisationDoc = {
    _id: new ObjectId(),
    name,
    kind: input.kind,
    qty,
    unit,
    cost,
    salePrice,
    date: input.date,
    site,
    notes: String(input.notes ?? "").trim().slice(0, 500),
    active: true,
    depenseId: null,
    acquisitionQty: qty,
    acquisitionAmount: qty * cost,
    createdAt: now,
    updatedAt: now,
    dureeUtiliteAnnees,
  };

  const db = await getDb();
  const depenseId = await attachDepense({
    user: input.user,
    date: doc.date,
    site: doc.site,
    name: doc.name,
    qty: doc.qty,
    montant: doc.qty * doc.cost,
  });
  doc.depenseId = depenseId;
  await db.collection<ImmobilisationDoc>("immobilisations").insertOne(doc);
  return toEntry(doc);
}

export async function updateImmobilisation(input: {
  id: string;
  name?: string;
  qty?: number;
  unit?: string;
  cost?: number;
  salePrice?: number | null;
  date?: string;
  site?: VenteSite | null;
  notes?: string;
  dureeUtiliteAnnees?: number | null;
  user: SessionUser;
}): Promise<Immobilisation> {
  if (!ObjectId.isValid(input.id)) throw new Error("Fiche introuvable.");
  const db = await getDb();
  const existing = await db
    .collection<ImmobilisationDoc>("immobilisations")
    .findOne({ _id: new ObjectId(input.id) });
  if (!existing) throw new Error("Fiche introuvable.");

  const patch: Partial<ImmobilisationDoc> = {
    updatedAt: new Date().toISOString(),
  };

  if (input.name !== undefined) {
    const name = normalizeName(input.name);
    if (name.length < 2) throw new Error("Nom trop court (2 caractères min.).");
    if (name.length > 120) throw new Error("Nom trop long (120 caractères max.).");
    patch.name = name;
  }
  if (input.qty !== undefined) {
    patch.qty = Math.max(1, Math.round(Number(input.qty) || 0));
  }
  if (input.unit !== undefined) {
    patch.unit = normalizeUnit(input.unit) || "pièce";
  }
  if (input.cost !== undefined) {
    patch.cost = Math.max(0, Math.round(Number(input.cost) || 0));
  }
  if (input.date !== undefined) {
    if (!isValidDate(input.date)) throw new Error("Date invalide.");
    patch.date = input.date;
  }
  if (input.site !== undefined) {
    patch.site =
      input.site === "zogbo" || input.site === "gbegamey" ? input.site : null;
  }
  if (input.notes !== undefined) {
    patch.notes = String(input.notes).trim().slice(0, 500);
  }
  if (input.salePrice !== undefined) {
    const price =
      input.salePrice === null
        ? null
        : Math.max(0, Math.round(Number(input.salePrice) || 0));
    patch.salePrice = price && price > 0 ? price : null;
  }
  if (input.dureeUtiliteAnnees !== undefined) {
    patch.dureeUtiliteAnnees =
      input.dureeUtiliteAnnees === null
        ? null
        : Math.max(1, Math.round(Number(input.dureeUtiliteAnnees) || 0));
  }

  // Dépense liée : reprise et régénérée si l'un des facteurs qui la
  // déterminent change (montant, jour ou zone débités) — même logique que
  // la correction d'un achat de matières.
  //
  // La quantité *acquise* sert de base au montant, pas la quantité *encore en
  // stock* : si une perte a déjà réduit `qty` entre-temps, une simple
  // correction du coût ne doit pas silencieusement rétrécir la dépense et
  // le montant comptabilisés pour l'acquisition d'origine. Le formulaire de
  // la fiche renvoie systématiquement `qty` (même quand seul un autre champ a
  // changé) : c'est donc un écart avec `existing.qty` — pas la simple
  // présence du champ — qui signale une correction volontaire de la
  // quantité acquise (typo corrigée, réassort).
  const previousAcquisitionQty = existing.acquisitionQty ?? existing.qty;
  const qtyEditedByUser =
    patch.qty !== undefined && patch.qty !== existing.qty;
  const nextAcquisitionQty = qtyEditedByUser ? patch.qty! : previousAcquisitionQty;
  const nextCost = patch.cost ?? existing.cost;
  const nextDate = patch.date ?? existing.date;
  const nextSite = "site" in patch ? (patch.site ?? null) : existing.site;
  const nextMontant = nextAcquisitionQty * nextCost;
  const oldMontant =
    existing.acquisitionAmount ?? previousAcquisitionQty * existing.cost;
  const depenseFactorsChanged =
    nextMontant !== oldMontant ||
    nextDate !== existing.date ||
    nextSite !== existing.site;

  if (depenseFactorsChanged) {
    await detachDepense(existing.depenseId, input.user);
    patch.depenseId = await attachDepense({
      user: input.user,
      date: nextDate,
      site: nextSite,
      name: patch.name ?? existing.name,
      qty: nextAcquisitionQty,
      montant: nextMontant,
    });
    patch.acquisitionQty = nextAcquisitionQty;
    patch.acquisitionAmount = nextMontant;
  }

  await db.collection<ImmobilisationDoc>("immobilisations").updateOne(
    { _id: existing._id },
    { $set: patch },
  );
  const updated = await db
    .collection<ImmobilisationDoc>("immobilisations")
    .findOne({ _id: existing._id });
  if (!updated) throw new Error("Fiche introuvable.");
  return toEntry(updated);
}

/**
 * Ajuste la quantité en stock suite à une perte déclarée (delta > 0) ou son
 * annulation (delta < 0) — ne touche jamais la dépense d'acquisition ni son
 * montant : l'argent a déjà été dépensé en totalité à l'achat, seule la
 * quantité physique restante change. Contrairement à `updateImmobilisation`,
 * qui régénère la dépense quand qty/coût changent (correction de la fiche
 * elle-même), ce qui serait faux ici : réduire le compteur suite à une casse
 * ne doit pas amputer le coût déjà enregistré.
 */
export async function adjustImmobilisationQty(input: {
  id: string;
  delta: number;
}): Promise<{ name: string; cost: number }> {
  if (!ObjectId.isValid(input.id)) throw new Error("Fiche introuvable.");
  const db = await getDb();
  const filter: Record<string, unknown> = { _id: new ObjectId(input.id) };
  if (input.delta > 0) filter.qty = { $gte: input.delta };
  const updated = await db
    .collection<ImmobilisationDoc>("immobilisations")
    .findOneAndUpdate(
      filter,
      {
        $inc: { qty: -input.delta },
        $set: { updatedAt: new Date().toISOString() },
      },
      { returnDocument: "after" },
    );
  if (!updated) {
    throw new Error("Stock insuffisant pour déclarer cette perte.");
  }
  return { name: updated.name, cost: updated.cost };
}

export async function setImmobilisationActive(input: {
  id: string;
  active: boolean;
}): Promise<Immobilisation> {
  if (!ObjectId.isValid(input.id)) throw new Error("Fiche introuvable.");
  const db = await getDb();
  const result = await db
    .collection<ImmobilisationDoc>("immobilisations")
    .findOneAndUpdate(
      { _id: new ObjectId(input.id) },
      {
        $set: {
          active: Boolean(input.active),
          updatedAt: new Date().toISOString(),
        },
      },
      { returnDocument: "after" },
    );
  if (!result) throw new Error("Fiche introuvable.");
  return toEntry(result);
}

/**
 * Coût d’acquisition Immobilisations par jour (qté × prix unitaire), pour le
 * compte de résultat. Le registre fait foi : rien n’est recopié dans
 * charges_jours. Une fiche « tous sites » (site null) compte pour chaque zone.
 */
export async function sumImmobilisationsCostByDate(input: {
  from: string;
  to: string;
  site?: VenteSite | "all" | null;
}): Promise<{ total: number; parJour: Record<string, number> }> {
  const db = await getDb();
  const match: Record<string, unknown> = {
    date: { $gte: input.from, $lte: input.to },
  };
  if (input.site && input.site !== "all") {
    match.$or = [{ site: input.site }, { site: null }];
  }

  const rows = await db
    .collection<ImmobilisationDoc>("immobilisations")
    .aggregate<{ _id: string; total: number }>([
      { $match: match },
      {
        $group: {
          _id: "$date",
          total: {
            $sum: {
              // Montant figé à l'acquisition en priorité — une fiche créée
              // avant ce champ retombe sur qty × coût courants (elle n'a
              // jamais pu être réduite par une perte, cette fonctionnalité
              // n'existant pas encore à l'époque).
              $ifNull: [
                "$acquisitionAmount",
                {
                  $multiply: [
                    { $ifNull: ["$qty", 1] },
                    { $ifNull: ["$cost", 0] },
                  ],
                },
              ],
            },
          },
        },
      },
    ])
    .toArray();

  const parJour: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    const amount = Math.max(0, Math.round(Number(r.total) || 0));
    if (amount <= 0) continue;
    parJour[r._id] = amount;
    total += amount;
  }
  return { total, parJour };
}
