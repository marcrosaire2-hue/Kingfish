import { assertDayOpen, isValidDate, updateDayDocument } from "@/lib/day-doc";
import { getDb } from "@/lib/mongodb";
import { getParametres } from "@/lib/parametres-repo";
import { collectionMatieres } from "@/lib/site-collections";
import { fusionnerParJour } from "@/lib/site-collections-calc";
import type { Filter } from "mongodb";
import type { VenteSite } from "@/lib/types";
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
import {
  mapAchatCorrectionToStockEvents,
  mapAchatToStockEvents,
  mapComptageToStockEvent,
} from "@/lib/stock-ledger-map";
import { recordStockEvents } from "@/lib/stock-ledger-write";

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
  site: VenteSite,
  date: string,
  materials: RawMaterial[],
): Promise<{ qty: Map<string, number>; unitCost: Map<string, number> }> {
  const prev = previousIsoDate(date);
  if (prev) {
    const db = await getDb();
    const prevDoc = await db
      .collection<MatieresDoc>(await collectionMatieres(site))
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
export async function sumMatieresPurchasesForDate(
  date: string,
  site?: VenteSite | null,
): Promise<number> {
  if (!isValidDate(date)) throw new Error("Date invalide (attendu YYYY-MM-DD)");
  const db = await getDb();
  let total = 0;
  for (const s of site ? [site] : (["zogbo", "gbegamey"] as const)) {
    const doc = await db
      .collection<MatieresDoc>(await collectionMatieres(s))
      .findOne({ _id: date });
    total += (doc?.movements ?? [])
      .filter((m) => !m.cancelledAt)
      .reduce((a, m) => a + (Number(m.qty) || 0) * (Number(m.unitPrice) || 0), 0);
  }
  return total;
}

/** Lecture consolidée (direction) : réunit les journées des deux sites. */
export async function lireJoursMatieresConsolides(
  filter: Filter<MatieresDoc>,
): Promise<MatieresDoc[]> {
  const db = await getDb();
  const [zogbo, gbegamey] = await Promise.all(
    (["zogbo", "gbegamey"] as const).map(async (site) =>
      db
        .collection<MatieresDoc>(await collectionMatieres(site))
        .find(filter)
        .toArray(),
    ),
  );
  return fusionnerParJour(zogbo!, gbegamey!, (z, g) => ({
    ...(z ?? g)!,
    lines: [...(z?.lines ?? []), ...(g?.lines ?? [])],
    movements: [...(z?.movements ?? []), ...(g?.movements ?? [])],
  }));
}

export async function getMatieresDayPayload(
  date: string,
  site: VenteSite,
): Promise<MatieresDayPayload> {
  if (!isValidDate(date)) throw new Error("Date invalide (attendu YYYY-MM-DD)");

  const { rawMaterials = [] } = await getParametres(site);
  const db = await getDb();
  const collection = await collectionMatieres(site);
  const existing = await db
    .collection<MatieresDoc>(collection)
    .findOne({ _id: date });

  if (!existing) {
    const leftovers = await leftoversForDate(site, date, rawMaterials);
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
      await db.collection<MatieresDoc>(collection).updateOne(
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
  site: VenteSite;
  date: string;
  status?: MatieresDay["status"];
  lines: MatieresLine[];
}): Promise<MatieresDayPayload> {
  if (!isValidDate(input.date)) {
    throw new Error("Date invalide (attendu YYYY-MM-DD)");
  }

  const { rawMaterials = [] } = await getParametres(input.site);

  // Comptages déjà enregistrés, relus à chaque essai du verrou optimiste : un
  // nouvel enregistrement de la grille ne recrée pas de comptage inchangé.
  let comptagesAvant = new Map<string, number | null>();

  const saved = await updateDayDocument<MatieresDoc, MatieresDayPayload>(
    await collectionMatieres(input.site),
    input.date,
    async (existing) => {
      const leftovers = existing
        ? null
        : await leftoversForDate(input.site, input.date, rawMaterials);
      const held = new Map(
        (existing?.lines ?? []).map((l) => [
          l.productId,
          normalizeMatieresLine(l),
        ]),
      );
      comptagesAvant = new Map(
        [...held].map(([productId, line]) => [productId, line.counted]),
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

  const at = saved.day.updatedAt;
  if (at) {
    await recordStockEvents(
      saved.day.lines
        .filter(
          (line) =>
            line.counted !== null &&
            line.counted !== (comptagesAvant.get(line.productId) ?? null),
        )
        .map((line) =>
          mapComptageToStockEvent({
            site: input.site,
            family: "matiere",
            productId: line.productId,
            name: line.name,
            qty: line.counted as number,
            at,
            date: input.date,
            reference: `${input.date}@${at}`,
          }),
        ),
      "Journal stock · comptage matières",
    );
  }

  return saved;
}

/**
 * Lignes de base du jour, sans écrire : celles du document existant, ou un
 * jour neuf alimenté par le report J-1 / l'ouverture AquaPro. Utilisée dans
 * le verrou optimiste des achats — la construction doit rester une fonction
 * pure du document lu.
 */
async function lignesDuJour(
  site: VenteSite,
  existing: MatieresDoc | null,
  date: string,
  rawMaterials: RawMaterial[],
): Promise<MatieresLine[]> {
  if (existing) {
    return (existing.lines ?? []).map((l) => normalizeMatieresLine(l));
  }
  const leftovers = await leftoversForDate(site, date, rawMaterials);
  const day = createEmptyMatieresDay(date, rawMaterials, leftovers.qty);
  return day.lines.map((l) => ({
    ...l,
    unitCost: leftovers.unitCost.get(l.productId) ?? l.unitCost ?? 0,
  }));
}

function mouvementsDuJour(existing: MatieresDoc | null): MatieresMovement[] {
  return (existing?.movements ?? [])
    .map((m) => normalizeMatieresMovement(m))
    .filter((m): m is MatieresMovement => !!m);
}

export async function applyMatieresPurchase(input: {
  date: string;
  /** Point de vente qui saisit l'achat. */
  site: VenteSite;
  productId: string;
  qty: number;
  unitPrice?: number;
  fournisseurId?: string | null;
  fournisseurNom?: string | null;
  /** Gérant : achat sur une journée matières déjà clôturée. */
  bypassClosedDay?: boolean;
}): Promise<MatieresDayPayload & { movement: MatieresMovement }> {
  if (!isValidDate(input.date)) throw new Error("Date invalide");
  const { rawMaterials = [] } = await getParametres(input.site);
  const mat = rawMaterials.find((m) => m.id === input.productId);
  const unitPrice = input.unitPrice ?? mat?.purchasePrice ?? 0;
  if (unitPrice <= 0) {
    throw new Error("Prix d'achat obligatoire : saisissez le prix unitaire.");
  }

  // Écriture sous verrou optimiste (rev) : une vente ou une perte déclarée en
  // parallèle ne peut plus être écrasée par la réécriture du document complet,
  // comme lors de la course findOne → updateOne qu'avaient corrigée les ventes.
  const saved = await updateDayDocument<
    MatieresDoc,
    MatieresDayPayload & { movement: MatieresMovement }
  >(await collectionMatieres(input.site), input.date, async (existing) => {
    assertDayOpen(
      existing?.status,
      "Journée clôturée : achat matière impossible.",
      { bypass: input.bypassClosedDay },
    );
    const applied = applyMatieresPurchaseToState(
      await lignesDuJour(input.site, existing, input.date, rawMaterials),
      mouvementsDuJour(existing),
      {
        productId: input.productId,
        qty: input.qty,
        unitPrice,
        fournisseurId: input.fournisseurId,
        fournisseurNom: input.fournisseurNom,
        site: input.site,
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

  await recordStockEvents(
    mapAchatToStockEvents({
      id: saved.movement.id,
      date: input.date,
      site: input.site,
      family: "matiere",
      productId: saved.movement.productId,
      name: saved.movement.name,
      qty: saved.movement.qty,
      at: saved.movement.at,
      cancelledAt: null,
      source: "achat-matiere",
    }),
    "Journal stock · achat matière",
  );

  return saved;
}

/**
 * Achat saisi librement, hors catalogue : le nom écrit par l'utilisateur fait
 * foi, sans ligne de stock. Valeur et fournisseur identiques aux autres
 * achats — le registre, l'historique et le pilotage les traitent pareil.
 */
export async function applyMatieresOtherPurchase(input: {
  date: string;
  /** Point de vente qui saisit l'achat. */
  site: VenteSite;
  name: string;
  qty: number;
  unitPrice?: number;
  fournisseurId?: string | null;
  fournisseurNom?: string | null;
  /** Gérant : achat sur une journée matières déjà clôturée. */
  bypassClosedDay?: boolean;
}): Promise<MatieresDayPayload & { movement: MatieresMovement }> {
  if (!isValidDate(input.date)) throw new Error("Date invalide");
  const { rawMaterials = [] } = await getParametres(input.site);

  // Même verrou optimiste que les achats du catalogue (voir ci-dessus).
  return updateDayDocument<
    MatieresDoc,
    MatieresDayPayload & { movement: MatieresMovement }
  >(await collectionMatieres(input.site), input.date, async (existing) => {
    assertDayOpen(
      existing?.status,
      "Journée clôturée : achat matière impossible.",
      { bypass: input.bypassClosedDay },
    );
    const applied = applyMatieresOtherPurchaseToState(
      await lignesDuJour(input.site, existing, input.date, rawMaterials),
      mouvementsDuJour(existing),
      {
        name: input.name,
        qty: input.qty,
        unitPrice: input.unitPrice ?? 0,
        fournisseurId: input.fournisseurId,
        fournisseurNom: input.fournisseurNom,
        site: input.site,
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
  site: VenteSite;
  date: string;
  movementId: string;
  depenseId: string;
}): Promise<void> {
  const db = await getDb();
  await db.collection<MatieresDoc>(await collectionMatieres(input.site)).updateOne(
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
  /** Ne renvoie que les achats saisis par ce point de vente. */
  site: VenteSite;
}): Promise<Array<{ date: string; movement: MatieresMovement }>> {
  if (!isValidDate(input.dateFrom) || !isValidDate(input.dateTo)) {
    throw new Error("Date invalide (attendu YYYY-MM-DD)");
  }
  const db = await getDb();
  const docs = await db
    .collection<MatieresDoc>(await collectionMatieres(input.site))
    .find({ _id: { $gte: input.dateFrom, $lte: input.dateTo } })
    .sort({ _id: 1 })
    .toArray();
  const out: Array<{ date: string; movement: MatieresMovement }> = [];
  for (const doc of docs) {
    for (const m of doc.movements ?? []) {
      const movement = normalizeMatieresMovement(m);
      if (!movement) continue;
      out.push({ date: doc._id, movement });
    }
  }
  return out.sort((a, b) => b.movement.at.localeCompare(a.movement.at));
}

export async function cancelMatieresMovement(input: {
  site: VenteSite;
  date: string;
  movementId: string;
  bypassClosedDay?: boolean;
}): Promise<MatieresDayPayload> {
  if (!isValidDate(input.date)) throw new Error("Date invalide");
  const { rawMaterials = [] } = await getParametres(input.site);

  // Verrou optimiste : l'annulation ne peut plus écraser une vente ou un
  // comptage enregistrés entre la lecture et l'écriture.
  const saved = await updateDayDocument<MatieresDoc, MatieresDayPayload>(
    await collectionMatieres(input.site),
    input.date,
    async (existing) => {
      assertDayOpen(
        existing?.status,
        "Journée clôturée : annulation d'achat impossible.",
        { bypass: input.bypassClosedDay },
      );
      const applied = cancelMatieresMovementInState(
        await lignesDuJour(input.site, existing, input.date, rawMaterials),
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

  // Un achat libre (« autre ») ne touche aucune ligne de stock.
  const annule = saved.day.movements.find((m) => m.id === input.movementId);
  if (annule?.type === "purchase") {
    await recordStockEvents(
      mapAchatToStockEvents({
        id: annule.id,
        date: input.date,
        site: input.site,
        family: "matiere",
        productId: annule.productId,
        name: annule.name,
        qty: annule.qty,
        at: annule.at,
        cancelledAt: annule.cancelledAt ?? new Date().toISOString(),
        source: "achat-matiere",
      }),
      "Journal stock · annulation achat matière",
    );
  }

  return saved;
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
  site: VenteSite;
  date: string;
  movementId: string;
  delta: number;
}): Promise<{ movement: MatieresMovement }> {
  if (!isValidDate(input.date)) throw new Error("Date invalide");
  // Verrou optimiste, sans garde de journée : un achat libre ne participe à
  // aucune réconciliation de stock quotidienne (voir commentaire d'origine).
  return updateDayDocument<MatieresDoc, { movement: MatieresMovement }>(
    await collectionMatieres(input.site),
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
  site: VenteSite;
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
  const { rawMaterials = [] } = await getParametres(input.site);
  const changeDate =
    input.newDate && input.newDate !== input.date ? input.newDate : null;

  // Validations qui doivent refuser AVANT toute écriture : un déplacement de
  // jour ne concerne que les achats libres (un achat de catalogue touche le
  // compteur `purchases` de sa journée d'origine).
  if (changeDate) {
    if (!isValidCalendarDate(changeDate)) throw new Error("Date invalide");
    const db = await getDb();
    const doc = await db
      .collection<MatieresDoc>(await collectionMatieres(input.site))
      .findOne({ _id: input.date });
    const cible = mouvementsDuJour(doc).find((m) => m.id === input.movementId);
    if (!cible) throw new Error("Achat introuvable");
    if (cible.type !== "autre") {
      throw new Error("Seul un achat libre peut changer de date.");
    }
  }

  // Quantité avant correction, relue à chaque essai du verrou optimiste.
  let qtyAvant: number | null = null;

  // Verrou optimiste sur le jour source : la correction ne peut plus écraser
  // ce qui aurait été écrit en parallèle (vente, perte, comptage).
  const applied = await updateDayDocument<
    MatieresDoc,
    MatieresDayPayload & { movement: MatieresMovement }
  >(await collectionMatieres(input.site), input.date, async (existing) => {
    assertDayOpen(
      existing?.status,
      "Journée clôturée : correction d'achat impossible.",
      { bypass: input.bypassClosedDay },
    );
    qtyAvant =
      mouvementsDuJour(existing).find((m) => m.id === input.movementId)?.qty ??
      null;
    const result = editMatieresMovementInState(
      await lignesDuJour(input.site, existing, input.date, rawMaterials),
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

  if (applied.movement.type === "purchase" && qtyAvant !== null) {
    await recordStockEvents(
      mapAchatCorrectionToStockEvents({
        id: applied.movement.id,
        date: input.date,
        site: input.site,
        family: "matiere",
        productId: applied.movement.productId,
        name: applied.movement.name,
        qtyAvant,
        qtyApres: applied.movement.qty,
        editedAt: applied.movement.editedAt ?? new Date().toISOString(),
      }),
      "Journal stock · correction achat matière",
    );
  }

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
  >(await collectionMatieres(input.site), changeDate, async (existingTarget) => {
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
            await lignesDuJour(input.site, existingTarget, changeDate, rawMaterials),
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
