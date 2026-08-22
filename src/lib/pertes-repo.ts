import { ObjectId } from "mongodb";
import { assertDayOpen } from "@/lib/day-doc";
import { getDb } from "@/lib/mongodb";
import { getParametres } from "@/lib/parametres-repo";
import { unitsPerCasierOf } from "@/lib/boissons-calc";
import { getBoissonsDayPayload, saveBoissonsDay } from "@/lib/boissons-repo";
import { getCombosDayPayload, saveCombosDay } from "@/lib/combos-repo";
import { getGbegameyDayPayload, saveGbegameyDay } from "@/lib/gbegamey-repo";
import { adjustImmobilisationQty } from "@/lib/immobilisations-repo";
import {
  applyMatieresMovementPerte,
  getMatieresDayPayload,
  saveMatieresDay,
} from "@/lib/matieres-repo";
import { getZogboDayPayload, saveZogboDay } from "@/lib/zogbo-repo";
import type {
  PerteEntry,
  PerteKind,
  PerteMotif,
  VenteSite,
} from "@/lib/types";

type PerteDoc = Omit<PerteEntry, "id"> & { _id: ObjectId };

export type PerteActor = { id: string; name: string };

function isValidDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

const MOTIFS: PerteMotif[] = [
  "gate",
  "casse",
  "test",
  "offert",
  "erreur",
  "autre",
];

/**
 * Cible d'écriture d'une perte : quel document jour, quel tableau de lignes,
 * quel compteur. Le prix de revient est figé ici, au moment de la
 * déclaration : changer un prix d'achat plus tard ne doit pas réécrire ce
 * qu'une perte passée a coûté.
 */
type PerteTarget = {
  collection: string;
  arrayField: "lines" | "transferLines" | "localLines";
  perteField: "pertes" | "pertesZogbo" | "pertesGbegamey";
  name: string;
  unitCost: number;
  ensure: () => Promise<void>;
};

async function resolveTarget(input: {
  date: string;
  site: VenteSite;
  kind: PerteKind;
  productId: string;
  bypassClosedDay?: boolean;
}): Promise<PerteTarget> {
  const { date, site, kind, productId } = input;
  const parametres = await getParametres();

  // Le statut de la journée conditionne toute déclaration ou annulation de
  // perte, qu'elle crée ou non la ligne : on le lit une seule fois ici et on
  // réutilise le jour chargé dans `ensure` plutôt que de le relire deux fois.
  const closedMessage = "Journée clôturée : perte impossible.";
  const openOpts = { bypass: input.bypassClosedDay };

  if (kind === "plat") {
    const dish = parametres.baseDishes.find((d) => d.id === productId);
    if (!dish) throw new Error("Plat introuvable");
    // Faute de prix de revient renseigné, on ne valorise pas : mieux vaut un
    // coût nul qu'un chiffre inventé à partir du prix de vente.
    const unitCost = dish.costPrice ?? 0;
    if (site === "zogbo") {
      const { day } = await getZogboDayPayload(date);
      assertDayOpen(day.status, closedMessage, openOpts);
      return {
        collection: "zogbo_jours",
        arrayField: "lines",
        perteField: "pertes",
        name: dish.name,
        unitCost,
        ensure: async () => {
          await saveZogboDay({ date, status: day.status, lines: day.lines });
        },
      };
    }
    const { day } = await getGbegameyDayPayload(date);
    assertDayOpen(day.status, closedMessage, openOpts);
    return {
      collection: "gbegamey_jours",
      arrayField: "transferLines",
      perteField: "pertes",
      name: dish.name,
      unitCost,
      ensure: async () => {
        await saveGbegameyDay({
          date,
          status: day.status,
          transferLines: day.transferLines,
          localLines: day.localLines,
        });
      },
    };
  }

  if (kind === "local") {
    if (site !== "gbegamey") {
      throw new Error("Les plats sur place n’existent qu’à Gbégamey");
    }
    const dish = parametres.localDishes.find((d) => d.id === productId);
    if (!dish) throw new Error("Plat local introuvable");
    const { day } = await getGbegameyDayPayload(date);
    assertDayOpen(day.status, closedMessage, openOpts);
    return {
      collection: "gbegamey_jours",
      arrayField: "localLines",
      perteField: "pertes",
      name: dish.name,
      unitCost: dish.costPrice ?? 0,
      ensure: async () => {
        await saveGbegameyDay({
          date,
          status: day.status,
          transferLines: day.transferLines,
          localLines: day.localLines,
        });
      },
    };
  }

  if (kind === "combo") {
    const combo = parametres.combos.find((c) => c.id === productId);
    if (!combo) throw new Error("Formule introuvable");
    const { day } = await getCombosDayPayload(date);
    assertDayOpen(day.status, closedMessage, openOpts);
    return {
      collection: "combos_jours",
      arrayField: "lines",
      perteField: site === "zogbo" ? "pertesZogbo" : "pertesGbegamey",
      name: combo.name,
      unitCost: combo.costPrice ?? 0,
      ensure: async () => {
        await saveCombosDay({ date, status: day.status, lines: day.lines });
      },
    };
  }

  if (kind === "boisson") {
    const drink = parametres.drinks.find((d) => d.id === productId);
    if (!drink) throw new Error("Boisson introuvable");
    const { day } = await getBoissonsDayPayload(date);
    assertDayOpen(day.status, closedMessage, openOpts);
    return {
      collection: "boissons_jours",
      arrayField: "lines",
      perteField: "pertes",
      name: drink.name,
      // Le stock boissons se tient en casiers, la perte se déclare en
      // bouteilles : le prix d'achat est déjà par bouteille.
      unitCost: drink.purchasePrice ?? 0,
      ensure: async () => {
        await saveBoissonsDay({ date, status: day.status, lines: day.lines });
      },
    };
  }

  if (kind !== "matiere") {
    // "immobilisation" et "libre" ne passent jamais par ici : ils sont
    // interceptés plus tôt dans recordPerte/cancelPerte (aucun document jour
    // à cette forme). Un appel direct par erreur doit échouer, pas retomber
    // sur une recherche de matière qui n'aurait aucun sens.
    throw new Error("Famille de perte inconnue.");
  }
  const matiere = (parametres.rawMaterials ?? []).find(
    (m) => m.id === productId,
  );
  if (!matiere) throw new Error("Matière introuvable");
  const { day } = await getMatieresDayPayload(date);
  assertDayOpen(day.status, closedMessage, openOpts);
  return {
    collection: "matieres_jours",
    arrayField: "lines",
    perteField: "pertes",
    name: matiere.name,
    unitCost: matiere.purchasePrice ?? 0,
    ensure: async () => {
      await saveMatieresDay({ date, status: day.status, lines: day.lines });
    },
  };
}

type DayDoc = { _id: string; rev?: number };

/**
 * Incrément atomique du compteur de pertes : une seule écriture, sans
 * relire-modifier-réécrire. Deux déclarations simultanées ne peuvent pas
 * s'écraser, et le filtre garantit qu'une annulation ne fait jamais passer le
 * compteur sous zéro.
 */
async function applyPerteDelta(input: {
  date: string;
  site: VenteSite;
  kind: PerteKind;
  productId: string;
  delta: number;
  bypassClosedDay?: boolean;
}): Promise<{ name: string; unitCost: number }> {
  const target = await resolveTarget(input);

  const db = await getDb();
  const col = db.collection<DayDoc>(target.collection);
  const { arrayField, perteField } = target;

  const present = await col.findOne(
    { _id: input.date },
    { projection: { [arrayField]: 1 } },
  );
  const lignes = ((present as Record<string, unknown> | null)?.[arrayField] ??
    []) as { productId: string }[];
  if (!present || !lignes.some((l) => l.productId === input.productId)) {
    await target.ensure();
  }

  const updated = await col.findOneAndUpdate(
    {
      _id: input.date,
      [arrayField]: {
        $elemMatch: {
          productId: input.productId,
          [perteField]: { $gte: -input.delta },
        },
      },
    },
    {
      $inc: { [`${arrayField}.$[el].${perteField}`]: input.delta, rev: 1 },
      $set: { updatedAt: new Date().toISOString() },
    },
    {
      arrayFilters: [{ "el.productId": input.productId }],
      returnDocument: "after",
    },
  );

  if (!updated) {
    throw new Error(
      `Impossible d’enregistrer la perte sur « ${target.name} ».`,
    );
  }

  return { name: target.name, unitCost: target.unitCost };
}

function toEntry(doc: PerteDoc): PerteEntry {
  return {
    id: doc._id.toHexString(),
    date: doc.date,
    site: doc.site,
    kind: doc.kind,
    productId: doc.productId,
    name: doc.name,
    qty: doc.qty,
    motif: doc.motif,
    commentaire: doc.commentaire ?? "",
    unitCost: Number(doc.unitCost) || 0,
    cost: Number(doc.cost) || 0,
    at: doc.at,
    cancelledAt: doc.cancelledAt ?? null,
    actorName: doc.actorName ?? null,
    cancelledByName: doc.cancelledByName ?? null,
    sourceRef: doc.sourceRef ?? null,
  };
}

export async function recordPerte(input: {
  date: string;
  site: VenteSite;
  kind: PerteKind;
  productId: string;
  qty: number;
  motif: PerteMotif;
  commentaire?: string;
  actor?: PerteActor | null;
  bypassClosedDay?: boolean;
  /** Requis pour kind "libre" : jour d'achat (document matieres_jours). */
  sourceDate?: string;
}): Promise<PerteEntry> {
  if (!isValidDate(input.date)) throw new Error("Date invalide");
  if (!MOTIFS.includes(input.motif)) throw new Error("Motif invalide");

  const qty = Math.round(Number(input.qty) || 0);
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new Error("Quantité invalide");
  }

  const commentaire = String(input.commentaire ?? "").trim().slice(0, 300);
  // « Autre » sans explication ne justifie rien : on l'exige.
  if (input.motif === "autre" && commentaire.length < 3) {
    throw new Error("Précisez la raison dans le commentaire.");
  }

  let name: string;
  let unitCost: number;
  let sourceRef: string | null = null;

  if (input.kind === "immobilisation") {
    const res = await adjustImmobilisationQty({
      id: input.productId,
      delta: qty,
    });
    name = res.name;
    unitCost = res.cost;
  } else if (input.kind === "libre") {
    if (!input.sourceDate || !isValidDate(input.sourceDate)) {
      throw new Error("Achat source introuvable.");
    }
    const res = await applyMatieresMovementPerte({
      date: input.sourceDate,
      movementId: input.productId,
      delta: qty,
    });
    name = res.movement.name;
    unitCost = res.movement.unitPrice;
    sourceRef = input.sourceDate;
  } else {
    const res = await applyPerteDelta({
      date: input.date,
      site: input.site,
      kind: input.kind,
      productId: input.productId,
      delta: qty,
      bypassClosedDay: input.bypassClosedDay,
    });
    name = res.name;
    unitCost = res.unitCost;
  }

  const doc: PerteDoc = {
    _id: new ObjectId(),
    date: input.date,
    site: input.site,
    kind: input.kind,
    productId: input.productId,
    name,
    qty,
    motif: input.motif,
    commentaire,
    unitCost,
    cost: qty * unitCost,
    at: new Date().toISOString(),
    cancelledAt: null,
    actorName: input.actor?.name ?? null,
    cancelledByName: null,
    sourceRef,
  };

  const db = await getDb();
  await db.collection<PerteDoc>("pertes").insertOne(doc);
  return toEntry(doc);
}

/** Annulation : la ligne reste au journal, barrée ; le stock est repris. */
export async function cancelPerte(input: {
  id: string;
  actor?: PerteActor | null;
  bypassClosedDay?: boolean;
}): Promise<PerteEntry> {
  if (!ObjectId.isValid(input.id)) throw new Error("Perte introuvable");
  const db = await getDb();
  const col = db.collection<PerteDoc>("pertes");
  const doc = await col.findOne({
    _id: new ObjectId(input.id),
    cancelledAt: null,
  });
  if (!doc) throw new Error("Perte introuvable ou déjà annulée");

  if (doc.kind === "immobilisation") {
    await adjustImmobilisationQty({ id: doc.productId, delta: -doc.qty });
  } else if (doc.kind === "libre") {
    if (!doc.sourceRef) throw new Error("Achat source introuvable.");
    await applyMatieresMovementPerte({
      date: doc.sourceRef,
      movementId: doc.productId,
      delta: -doc.qty,
    });
  } else {
    await applyPerteDelta({
      date: doc.date,
      site: doc.site,
      kind: doc.kind,
      productId: doc.productId,
      delta: -doc.qty,
      bypassClosedDay: input.bypassClosedDay,
    });
  }

  const cancelledAt = new Date().toISOString();
  await col.updateOne(
    { _id: doc._id },
    {
      $set: {
        cancelledAt,
        cancelledByName: input.actor?.name ?? null,
      },
    },
  );

  return toEntry({
    ...doc,
    cancelledAt,
    cancelledByName: input.actor?.name ?? null,
  });
}

export async function listPertes(input: {
  date: string;
  site?: VenteSite | "all";
  limit?: number;
}): Promise<PerteEntry[]> {
  if (!isValidDate(input.date)) throw new Error("Date invalide");
  const db = await getDb();
  const filtre: Record<string, unknown> = { date: input.date };
  if (input.site && input.site !== "all") filtre.site = input.site;

  const docs = await db
    .collection<PerteDoc>("pertes")
    .find(filtre)
    .sort({ at: -1 })
    .limit(Math.min(200, input.limit ?? 100))
    .toArray();
  return docs.map(toEntry);
}

/** Coût des pertes actives sur une période — alimente le compte de résultat. */
export async function sumPertesCost(input: {
  from: string;
  to: string;
  site?: VenteSite | "all";
}): Promise<{ total: number; parJour: Record<string, number> }> {
  const db = await getDb();
  const filtre: Record<string, unknown> = {
    date: { $gte: input.from, $lte: input.to },
    cancelledAt: null,
  };
  if (input.site && input.site !== "all") filtre.site = input.site;

  const rows = await db
    .collection<PerteDoc>("pertes")
    .aggregate<{ _id: string; total: number }>([
      { $match: filtre },
      { $group: { _id: "$date", total: { $sum: "$cost" } } },
    ])
    .toArray();

  const parJour: Record<string, number> = {};
  let total = 0;
  for (const row of rows) {
    parJour[row._id] = row.total;
    total += row.total;
  }
  return { total, parJour };
}

/** Conditionnement d'une boisson — la perte se saisit en bouteilles. */
export async function bottlesPerCasier(productId: string): Promise<number> {
  const parametres = await getParametres();
  return unitsPerCasierOf(
    parametres.drinks.find((d) => d.id === productId),
  );
}
