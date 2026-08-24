import { assertDayOpen, isValidDate, updateDayDocument } from "@/lib/day-doc";
import { getDb } from "@/lib/mongodb";
import { getParametres } from "@/lib/parametres-repo";
import {
  applyMatieresMovementPerteInState,
  applyMatieresOtherPurchaseToState,
  applyMatieresPurchaseToState,
  cancelMatieresMovementInState,
  createEmptyMatieresDay,
  editMatieresMovementInState,
  leftoverFromMatieresLines,
  normalizeMatieresLine,
  normalizeMatieresMovement,
  syncMatieresLines,
} from "@/lib/matieres-calc";
import {
  loadAquaAlimentStocks,
  openingForMaterials,
} from "@/lib/aquapro-opening-stock";
import type {
  MatieresDay,
  MatieresLine,
  MatieresMovement,
  RawMaterial,
} from "@/lib/types";
import { isValidCalendarDate, previousIsoDate } from "@/lib/zogbo-calc";

type MatieresDoc = Omit<MatieresDay, "date"> & { _id: string; rev?: number };

function toDay(doc: MatieresDoc): MatieresDay {
  const movements = (doc.movements ?? [])
    .map((m) => normalizeMatieresMovement(m))
    .filter((m): m is MatieresMovement => !!m);
  return {
    date: doc._id,
    status: doc.status ?? "ouverte",
    lines: (doc.lines ?? []).map((l) => normalizeMatieresLine(l)),
    movements,
    updatedAt: doc.updatedAt ?? null,
  };
}

export type MatieresDayPayload = {
  day: MatieresDay;
  materials: RawMaterial[];
};

async function leftoversForDate(
  date: string,
  materials: RawMaterial[],
): Promise<{ qty: Map<string, number>; unitCost: Map<string, number> }> {
  const prev = previousIsoDate(date);
  if (prev) {
    const db = await getDb();
    const prevDoc = await db
      .collection<MatieresDoc>("matieres_jours")
      .find({ _id: { $lte: prev } })
      .sort({ _id: -1 })
      .limit(1)
      .next();
    if (prevDoc?.lines?.length) {
      const qty = leftoverFromMatieresLines(
        prevDoc.lines.map((l) => normalizeMatieresLine(l)),
      );
      const unitCost = new Map<string, number>();
      for (const l of prevDoc.lines) {
        unitCost.set(
          l.productId,
          Math.max(0, Number(l.unitCost) || 0),
        );
      }
      return { qty, unitCost };
    }
  }
  try {
    const stocks = await loadAquaAlimentStocks();
    return {
      qty: openingForMaterials(materials, stocks),
      unitCost: new Map(),
    };
  } catch {
    return { qty: new Map(), unitCost: new Map() };
  }
}

/**
 * Total FCFA des achats matières du jour (mouvements actifs). Sert à
 * suggérer la charge « Achats matières premières » du compte de résultat au
 * lieu de la faire retaper à la main alors que l'onglet Stock la connaît
 * déjà, ligne par ligne et fournisseur par fournisseur.
 */
export async function sumMatieresPurchasesForDate(date: string): Promise<number> {
  if (!isValidDate(date)) throw new Error("Date invalide (attendu YYYY-MM-DD)");
  const db = await getDb();
  const doc = await db.collection<MatieresDoc>("matieres_jours").findOne({ _id: date });
  if (!doc) return 0;
  return (doc.movements ?? [])
    .filter((m) => !m.cancelledAt)
    .reduce((s, m) => s + (Number(m.qty) || 0) * (Number(m.unitPrice) || 0), 0);
}

export async function getMatieresDayPayload(
  date: string,
): Promise<MatieresDayPayload> {
  if (!isValidDate(date)) throw new Error("Date invalide (attendu YYYY-MM-DD)");

  const { rawMaterials = [] } = await getParametres();
  const db = await getDb();
  const existing = await db
    .collection<MatieresDoc>("matieres_jours")
    .findOne({ _id: date });

  if (!existing) {
    const leftovers = await leftoversForDate(date, rawMaterials);
    const day = createEmptyMatieresDay(date, rawMaterials, leftovers.qty);
    const stamped = day.lines.map((l) => ({
      ...l,
      unitCost: leftovers.unitCost.get(l.productId) ?? l.unitCost ?? 0,
    }));
    // Persiste l’ouverture AquaPro pour que le stock reste géré dans le site
    if (leftovers.qty.size > 0) {
      const updatedAt = new Date().toISOString();
      const lines = stamped.map((l) => ({
        ...l,
        counted: leftovers.qty.has(l.productId)
          ? leftovers.qty.get(l.productId)!
          : null,
        observations: leftovers.qty.has(l.productId)
          ? "Ouverture (stock final)"
          : "",
      }));
      await db.collection<MatieresDoc>("matieres_jours").updateOne(
        { _id: date },
        {
          $set: {
            status: "ouverte",
            lines,
            movements: [],
            updatedAt,
            source: "aquapro-opening",
          },
          $setOnInsert: { _id: date },
        },
        { upsert: true },
      );
      return {
        day: { ...day, lines, updatedAt },
        materials: rawMaterials,
      };
    }
    return { day: { ...day, lines: stamped }, materials: rawMaterials };
  }

  const day = toDay(existing);
  return {
    day: { ...day, lines: syncMatieresLines(day.lines, rawMaterials) },
    materials: rawMaterials,
  };
}

export async function saveMatieresDay(input: {
  date: string;
  status?: MatieresDay["status"];
  lines: MatieresLine[];
}): Promise<MatieresDayPayload> {
  if (!isValidDate(input.date)) {
    throw new Error("Date invalide (attendu YYYY-MM-DD)");
  }

  const { rawMaterials = [] } = await getParametres();

  return updateDayDocument<MatieresDoc, MatieresDayPayload>(
    "matieres_jours",
    input.date,
    async (existing) => {
      const leftovers = existing ? null : await leftoversForDate(input.date, rawMaterials);
      const held = new Map(
        (existing?.lines ?? []).map((l) => [
          l.productId,
          normalizeMatieresLine(l),
        ]),
      );
      const movements = (existing?.movements ?? [])
        .map((m) => normalizeMatieresMovement(m))
        .filter((m): m is MatieresMovement => !!m);

      const lines = syncMatieresLines(input.lines, rawMaterials).map((line) => {
        const prev = held.get(line.productId);
        const initialStock = existing
          ? (prev?.initialStock ?? 0)
          : (leftovers?.qty.get(line.productId) ?? 0);
        const purchases = prev?.purchases ?? 0;
        const consumed = prev?.consumed ?? 0;
        return {
          productId: line.productId,
          name: line.name,
          initialStock,
          purchases,
          consumed,
          // Compteur de pertes piloté par les déclarations, jamais par la grille.
          pertes: prev?.pertes ?? 0,
          counted: line.counted,
          observations: String(line.observations ?? ""),
          unitCost:
            prev?.unitCost ??
            leftovers?.unitCost.get(line.productId) ??
            0,
        };
      });

      const updatedAt = new Date().toISOString();
      const status = input.status ?? "ouverte";

      return {
        set: { status, lines, movements, updatedAt },
        result: {
          day: { date: input.date, status, lines, movements, updatedAt },
          materials: rawMaterials,
        },
      };
    },
  );
}

/**
 * Lignes de base du jour, sans écrire : celles du document existant, ou un
 * jour neuf alimenté par le report J-1 / l'ouverture AquaPro. Utilisée dans
 * le verrou optimiste des achats — la construction doit rester une fonction
 * pure du document lu.
 */
async function lignesDuJour(
  existing: MatieresDoc | null,
  date: string,
  rawMaterials: RawMaterial[],
): Promise<MatieresLine[]> {
  if (existing) {
    return (existing.lines ?? []).map((l) => normalizeMatieresLine(l));
  }
  const leftovers = await leftoversForDate(date, rawMaterials);
  return createEmptyMatieresDay(date, rawMaterials, leftovers).lines;
}

function mouvementsDuJour(existing: MatieresDoc | null): MatieresMovement[] {
  return (existing?.movements ?? [])
    .map((m) => normalizeMatieresMovement(m))
    .filter((m): m is MatieresMovement => !!m);
}

export async function applyMatieresPurchase(input: {
  date: string;
  productId: string;
  qty: number;
  unitPrice?: number;
  fournisseurId?: string | null;
  fournisseurNom?: string | null;
  /** Gérant : achat sur une journée matières déjà clôturée. */
  bypassClosedDay?: boolean;
}): Promise<MatieresDayPayload & { movement: MatieresMovement }> {
  if (!isValidDate(input.date)) throw new Error("Date invalide");
  const { rawMaterials = [] } = await getParametres();
  const mat = rawMaterials.find((m) => m.id === input.productId);
  const unitPrice = input.unitPrice ?? mat?.purchasePrice ?? 0;
  if (unitPrice <= 0) {
    throw new Error("Prix d'achat obligatoire : saisissez le prix unitaire.");
  }

  // Écriture sous verrou optimiste (rev) : une vente ou une perte déclarée en
  // parallèle ne peut plus être écrasée par la réécriture du document complet,
  // comme lors de la course findOne → updateOne qu'avaient corrigée les ventes.
  return updateDayDocument<
    MatieresDoc,
    MatieresDayPayload & { movement: MatieresMovement }
  >("matieres_jours", input.date, async (existing) => {
    assertDayOpen(
      existing?.status,
      "Journée clôturée : achat matière impossible.",
      { bypass: input.bypassClosedDay },
    );
    const applied = applyMatieresPurchaseToState(
      await lignesDuJour(existing, input.date, rawMaterials),
      mouvementsDuJour(existing),
      {
        productId: input.productId,
        qty: input.qty,
        unitPrice,
        fournisseurId: input.fournisseurId,
        fournisseurNom: input.fournisseurNom,
      },
    );
    const updatedAt = new Date().toISOString();
    const status = existing?.status ?? "ouverte";
    return {
      set: { status, lines: applied.lines, movements: applied.movements, updatedAt },
      result: {
        day: {
          date: input.date,
          status,
          lines: syncMatieresLines(applied.lines, rawMaterials),
          movements: applied.movements,
          updatedAt,
        },
        materials: rawMaterials,
        movement: applied.movement,
      },
    };
  });
}

/**
 * Achat saisi librement, hors catalogue : le nom écrit par l'utilisateur fait
 * foi, sans ligne de stock. Valeur et fournisseur identiques aux autres
 * achats — le registre, l'historique et le pilotage les traitent pareil.
 */
export async function applyMatieresOtherPurchase(input: {
  date: string;
  name: string;
  qty: number;
  unitPrice?: number;
  fournisseurId?: string | null;
  fournisseurNom?: string | null;
  /** Gérant : achat sur une journée matières déjà clôturée. */
  bypassClosedDay?: boolean;
}): Promise<MatieresDayPayload & { movement: MatieresMovement }> {
  if (!isValidDate(input.date)) throw new Error("Date invalide");
  const { rawMaterials = [] } = await getParametres();

  // Même verrou optimiste que les achats du catalogue (voir ci-dessus).
  return updateDayDocument<
    MatieresDoc,
    MatieresDayPayload & { movement: MatieresMovement }
  >("matieres_jours", input.date, async (existing) => {
    assertDayOpen(
      existing?.status,
      "Journée clôturée : achat matière impossible.",
      { bypass: input.bypassClosedDay },
    );
    const applied = applyMatieresOtherPurchaseToState(
      await lignesDuJour(existing, input.date, rawMaterials),
      mouvementsDuJour(existing),
      {
        name: input.name,
        qty: input.qty,
        unitPrice: input.unitPrice ?? 0,
        fournisseurId: input.fournisseurId,
        fournisseurNom: input.fournisseurNom,
      },
    );
    const updatedAt = new Date().toISOString();
    const status = existing?.status ?? "ouverte";
    return {
      set: { status, lines: applied.lines, movements: applied.movements, updatedAt },
      result: {
        day: {
          date: input.date,
          status,
          lines: syncMatieresLines(applied.lines, rawMaterials),
          movements: applied.movements,
          updatedAt,
        },
        materials: rawMaterials,
        movement: applied.movement,
      },
    };
  });
}
export async function linkMatieresMovementDepense(input: {
  date: string;
  movementId: string;
  depenseId: string;
}): Promise<void> {
  const db = await getDb();
  await db.collection<MatieresDoc>("matieres_jours").updateOne(
    { _id: input.date, "movements.id": input.movementId },
    { $set: { "movements.$.depenseId": input.depenseId } },
  );
}

/**
 * Historique multi-jours des achats de stock : les mouvements vivent dans les
 * documents journaliers, cette lecture les aplatit avec leur jour pour la vue
 * d'historique sans rien déplacer.
 */
export async function listMatieresMovements(input: {
  dateFrom: string;
  dateTo: string;
}): Promise<Array<{ date: string; movement: MatieresMovement }>> {
  if (!isValidDate(input.dateFrom) || !isValidDate(input.dateTo)) {
    throw new Error("Date invalide (attendu YYYY-MM-DD)");
  }
  const db = await getDb();
  const docs = await db
    .collection<MatieresDoc>("matieres_jours")
    .find({ _id: { $gte: input.dateFrom, $lte: input.dateTo } })
    .sort({ _id: 1 })
    .toArray();
  const out: Array<{ date: string; movement: MatieresMovement }> = [];
  for (const doc of docs) {
    for (const m of doc.movements ?? []) {
      const movement = normalizeMatieresMovement(m);
      if (movement) out.push({ date: doc._id, movement });
    }
  }
  return out.sort((a, b) => b.movement.at.localeCompare(a.movement.at));
}

export async function cancelMatieresMovement(input: {
  date: string;
  movementId: string;
  bypassClosedDay?: boolean;
}): Promise<MatieresDayPayload> {
  if (!isValidDate(input.date)) throw new Error("Date invalide");
  const { rawMaterials = [] } = await getParametres();

  // Verrou optimiste : l'annulation ne peut plus écraser une vente ou un
  // comptage enregistrés entre la lecture et l'écriture.
  return updateDayDocument<MatieresDoc, MatieresDayPayload>(
    "matieres_jours",
    input.date,
    async (existing) => {
      assertDayOpen(
        existing?.status,
        "Journée clôturée : annulation d'achat impossible.",
        { bypass: input.bypassClosedDay },
      );
      const applied = cancelMatieresMovementInState(
        await lignesDuJour(existing, input.date, rawMaterials),
        mouvementsDuJour(existing),
        input.movementId,
      );
      const updatedAt = new Date().toISOString();
      const status = existing?.status ?? "ouverte";
      return {
        set: { status, lines: applied.lines, movements: applied.movements, updatedAt },
        result: {
          day: {
            date: input.date,
            status,
            lines: syncMatieresLines(applied.lines, rawMaterials),
            movements: applied.movements,
            updatedAt,
          },
          materials: rawMaterials,
        },
      };
    },
  );
}

/**
 * Déclare (delta > 0) ou annule (delta < 0) une perte contre un achat libre
 * précis, identifié par le jour où il a été saisi et son id de mouvement.
 * Aucun statut de journée n'est vérifié : un achat libre ne participe à
 * aucune réconciliation de stock quotidienne, contrairement aux matières du
 * catalogue — rien ne justifie de bloquer la déclaration parce que le jour
 * d'achat est clôturé, potentiellement des semaines plus tôt.
 */
export async function applyMatieresMovementPerte(input: {
  date: string;
  movementId: string;
  delta: number;
}): Promise<{ movement: MatieresMovement }> {
  if (!isValidDate(input.date)) throw new Error("Date invalide");
  // Verrou optimiste, sans garde de journée : un achat libre ne participe à
  // aucune réconciliation de stock quotidienne (voir commentaire d'origine).
  return updateDayDocument<MatieresDoc, { movement: MatieresMovement }>(
    "matieres_jours",
    input.date,
    async (existing) => {
      const applied = applyMatieresMovementPerteInState(
        mouvementsDuJour(existing),
        input.movementId,
        input.delta,
      );
      return {
        set: { movements: applied.movements, updatedAt: new Date().toISOString() },
        result: { movement: applied.movement },
      };
    },
  );
}

/**
 * Correction d'un achat déjà enregistré. Le mouvement garde son identité :
 * l'historique montre la ligne corrigée, pas une seconde ligne concurrente.
 *
 * `newDate` déplace un achat libre vers un autre jour — utile quand la date
 * de saisie s'est trompée. Réservé aux achats libres : un achat de catalogue
 * touche le compteur `purchases` de sa matière, propre à son jour ; le
 * déplacer casserait le stock de la journée d'origine. Un achat libre ne
 * touche aucune ligne, le déplacer entre deux documents est donc sans effet
 * de bord.
 */
export async function editMatieresMovement(input: {
  date: string;
  movementId: string;
  qty: number;
  unitPrice: number;
  name?: string;
  fournisseurId?: string | null;
  fournisseurNom?: string | null;
  newDate?: string;
  bypassClosedDay?: boolean;
}): Promise<MatieresDayPayload & { movement: MatieresMovement }> {
  if (!isValidDate(input.date)) throw new Error("Date invalide");
  const { rawMaterials = [] } = await getParametres();
  const changeDate =
    input.newDate && input.newDate !== input.date ? input.newDate : null;

  // Validations qui doivent refuser AVANT toute écriture : un déplacement de
  // jour ne concerne que les achats libres (un achat de catalogue touche le
  // compteur `purchases` de sa journée d'origine).
  if (changeDate) {
    if (!isValidCalendarDate(changeDate)) throw new Error("Date invalide");
    const db = await getDb();
    const doc = await db
      .collection<MatieresDoc>("matieres_jours")
      .findOne({ _id: input.date });
    const cible = mouvementsDuJour(doc).find((m) => m.id === input.movementId);
    if (!cible) throw new Error("Achat introuvable");
    if (cible.type !== "autre") {
      throw new Error("Seul un achat libre peut changer de date.");
    }
  }

  // Verrou optimiste sur le jour source : la correction ne peut plus écraser
  // ce qui aurait été écrit en parallèle (vente, perte, comptage).
  const applied = await updateDayDocument<
    MatieresDoc,
    MatieresDayPayload & { movement: MatieresMovement }
  >("matieres_jours", input.date, async (existing) => {
    assertDayOpen(
      existing?.status,
      "Journée clôturée : correction d'achat impossible.",
      { bypass: input.bypassClosedDay },
    );
    const result = editMatieresMovementInState(
      await lignesDuJour(existing, input.date, rawMaterials),
      mouvementsDuJour(existing),
      {
        movementId: input.movementId,
        qty: input.qty,
        unitPrice: input.unitPrice,
        name: input.name,
        fournisseurId: input.fournisseurId,
        fournisseurNom: input.fournisseurNom,
      },
    );
    // Déplacement : le mouvement quitte ce document.
    const restants = changeDate
      ? result.movements.filter((m) => m.id !== result.movement.id)
      : result.movements;
    const updatedAt = new Date().toISOString();
    const status = existing?.status ?? "ouverte";
    return {
      set: { status, lines: result.lines, movements: restants, updatedAt },
      result: {
        day: {
          date: input.date,
          status,
          lines: syncMatieresLines(result.lines, rawMaterials),
          movements: restants,
          updatedAt,
        },
        materials: rawMaterials,
        movement: result.movement,
      },
    };
  });

  if (!changeDate) {
    return {
      day: applied.day,
      materials: applied.materials,
      movement: applied.movement,
    };
  }

  // Jour cible sous verrou aussi : les mouvements y sont relus au dernier
  // état pour ne rien perdre en route.
  const cible = await updateDayDocument<
    MatieresDoc,
    MatieresDayPayload & { movement: MatieresMovement }
  >("matieres_jours", changeDate, async (existingTarget) => {
    assertDayOpen(
      existingTarget?.status,
      "Journée cible clôturée : correction d'achat impossible.",
      { bypass: input.bypassClosedDay },
    );
    const targetMovements = [applied.movement, ...mouvementsDuJour(existingTarget)];
    const updatedAt = new Date().toISOString();
    const status = existingTarget?.status ?? "ouverte";
    return {
      set: { status, movements: targetMovements, updatedAt },
      result: {
        day: {
          date: changeDate,
          status,
          lines: syncMatieresLines(
            await lignesDuJour(existingTarget, changeDate, rawMaterials),
            rawMaterials,
          ),
          movements: targetMovements,
          updatedAt,
        },
        materials: rawMaterials,
        movement: applied.movement,
      },
    };
  });

  return {
    day: cible.day,
    materials: cible.materials,
    movement: cible.movement,
  };
}
