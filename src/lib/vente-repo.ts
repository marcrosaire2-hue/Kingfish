import { ObjectId, type Filter } from "mongodb";
import { effectiveShift, type UserShift } from "@/lib/auth-types";
import { adjustCaisseVenteAmount } from "@/lib/caisse-repo";
import { getDb } from "@/lib/mongodb";
import { getParametres } from "@/lib/parametres-repo";
import { physicalBoissonsStockForSite, DEFAULT_UNITS_PER_CASIER } from "@/lib/boissons-calc";
import { getBoissonsDayPayload, saveBoissonsDay } from "@/lib/boissons-repo";
import { newId } from "@/lib/format";
import { computeTransferLine } from "@/lib/gbegamey-calc";
import { getGbegameyDayPayload, saveGbegameyDay } from "@/lib/gbegamey-repo";
import { adjustImmobilisationQty } from "@/lib/immobilisations-repo";
import { computeZogboLine, shiftIsoDate } from "@/lib/zogbo-calc";
import { isLegalAccompanimentPrice } from "@/lib/catalog-zogbo";
import { getZogboDayPayload, saveZogboDay } from "@/lib/zogbo-repo";
import type {
  GbegameyLocalLine,
  VenteKind,
  VenteLogEntry,
  VenteProduct,
  VenteSite,
  VentesDaySummary,
} from "@/lib/types";
import { isValidDate } from "@/lib/day-doc";
import { restorePlatUnitAfterSaleCancel, listSellableQrProductIds } from "@/lib/stock-unit-repo";
import {
  dayVentesSansStock,
  isVentesSansStockActive,
} from "@/lib/ventes-sans-stock";

export type { VenteKind, VenteLogEntry, VenteProduct, VenteSite, VentesDaySummary };

export type VenteActor = {
  id: string;
  name: string;
  username: string;
  /** Équipe du vendeur, figée sur la vente : changer d'équipe plus tard ne
   *  doit pas réattribuer les ventes déjà encaissées. */
  shift?: UserShift;
};

type VenteLogDoc = {
  _id: ObjectId;
  date: string;
  site: VenteSite;
  kind: VenteKind;
  productId: string;
  name: string;
  qty: number;
  /** Prix de vente figé au moment de la vente */
  unitPrice: number;
  /** Prix d’achat figé au moment de la vente (marge boissons) */
  costPrice: number;
  amount: number;
  at: string;
  /** Annulation : la ligne reste au journal, elle sort des totaux */
  cancelledAt: string | null;
  /** Plat de base déduit lors d’une vente (pour annulation fiable) */
  baseProductId?: string | null;
  actorId?: string | null;
  actorName?: string | null;
  actorUsername?: string | null;
  /** Équipe créditée de cette vente */
  shift?: UserShift | null;
  cancelledById?: string | null;
  cancelledByName?: string | null;
  cancelledByUsername?: string | null;
  /** Provenance (caisse, carnet-zogbo, aquapro, reprise…) */
  source?: string | null;
  caExcluded?: boolean;
  /** Unité QR tracée vendue avec cette ligne */
  qrId?: string | null;
};

function mapVenteLogDoc(d: VenteLogDoc): VenteLogEntry {
  return {
    id: d._id.toHexString(),
    date: d.date,
    site: d.site,
    kind: d.kind,
    productId: d.productId,
    name: d.name,
    qty: d.qty,
    unitPrice: d.unitPrice,
    amount: d.amount,
    at: d.at,
    source: d.source ?? null,
  };
}

/** Ventes actives : les annulations restent en base mais ne comptent plus. Formules retirées. */
const ACTIVE = {
  cancelledAt: null,
  caExcluded: { $ne: true },
  kind: { $ne: "combo" },
} as unknown as Filter<VenteLogDoc>;

/** Document « jour » quelconque, adressé par date — lignes accédées dynamiquement. */
type DayCounterDoc = { _id: string; rev?: number; updatedAt?: string };

/**
 * Refuse vente et annulation sur un jour clôturé (reprise) : les écritures
 * post-clôture contrediraient l'inventaire et le contrôle de caisse déjà
 * arrêtés. Les ventes « extra », sans jour de stock, restent possibles.
 */
async function assertDayNotClosed(
  date: string,
  site: VenteSite,
  kind: VenteKind,
  options?: { bypassClosedDay?: boolean },
): Promise<void> {
  if (options?.bypassClosedDay) return;
  if (kind === "extra") return;
  // Pas de try/catch ici : une erreur de lecture (réseau, base, date
  // invalide) ne doit pas être interprétée comme « journée ouverte ».
  // Les payloads gèrent déjà les jours sans document en renvoyant un jour
  // neuf ; tout ce qui arrive jusqu'ici est anormal et doit bloquer l'écriture
  // plutôt que risquer de vendre sur une journée clôturée.
  let status: string | null = null;
  if (kind === "plat" || kind === "local") {
    const payload =
      site === "zogbo"
        ? await getZogboDayPayload(date)
        : await getGbegameyDayPayload(date);
    status = payload.day.status;
  } else if (kind === "boisson") {
    const payload = await getBoissonsDayPayload(date);
    status = payload.day.status;
  }
  if (status === "cloturee") {
    throw new Error("Journée clôturée : vente ou annulation impossible.");
  }
}

/**
 * Stock encore vendable mais entamé au point d’alerter. On exclut la rupture
 * (0) : elle a déjà son propre traitement visuel, et mélanger les deux
 * empêcherait de distinguer « il faut recommander » de « il est trop tard ».
 */
function isLowStock(
  stockLeft: number | null | undefined,
  threshold: number | undefined,
): boolean {
  if (stockLeft === null || stockLeft === undefined) return false;
  const seuil = Math.max(0, Number(threshold) || 0);
  if (seuil <= 0) return false;
  return stockLeft > 0 && stockLeft <= seuil;
}

/** Libellés clairs quand un plat Zogbo n'est plus / pas encore vendable. */
function zogboPlatStatus(input: {
  stockLeft: number;
  prepared: number;
  stock: number;
  sold: number;
}): { hint: string; blockReason: string | null } {
  const { stockLeft, prepared, stock, sold } = input;
  if (stockLeft > 0) {
    return { hint: `Reste ${stockLeft}`, blockReason: null };
  }
  if (prepared <= 0 && stock <= 0 && sold <= 0) {
    return {
      hint: "Pas encore préparé à Zogbo",
      blockReason: "Pas encore préparé",
    };
  }
  if (sold > 0) {
    return {
      hint: `Épuisé · ${sold} vendu(s)`,
      blockReason: "Stock épuisé",
    };
  }
  return {
    hint: "Reste 0 — préparez ou réapprovisionnez",
    blockReason: "Stock à zéro",
  };
}

/** Libellés clairs pour un plat reçu à Gbégamey. */
function gbegameyPlatStatus(input: {
  stockLeft: number;
  sent: number;
  initialStock: number;
  sold: number;
  counted: number | null;
}): {
  hint: string;
  blockReason: string | null;
  badge: "epuise" | "pas-recu";
} {
  const { stockLeft, sent, initialStock, sold, counted } = input;
  if (stockLeft > 0) {
    return {
      hint: `Reçu ${sent} · reste ${stockLeft}`,
      blockReason: null,
      badge: "epuise",
    };
  }
  if (counted === 0) {
    return {
      hint: "Inventaire saisi à 0 — corrigez le comptage sur Gbégamey",
      blockReason: "Inventaire à 0",
      badge: "epuise",
    };
  }
  // Jamais de stock ce jour (ni report, ni envoi) : ce n'est pas une « rupture ».
  if (sent <= 0 && initialStock <= 0 && sold <= 0) {
    return {
      hint: "Aucun stock reçu de Zogbo — faites un envoi depuis Zogbo",
      blockReason: "Pas encore reçu de Zogbo",
      badge: "pas-recu",
    };
  }
  if (sold > 0) {
    return {
      hint: `Épuisé · ${sold} vendu(s) · reçu ${sent}`,
      blockReason: "Stock épuisé",
      badge: "epuise",
    };
  }
  return {
    hint: `Reçu ${sent} · reste 0 — en attente de réappro Zogbo`,
    blockReason: "Stock à zéro",
    badge: "epuise",
  };
}

/**
 * Stock restant vendable d’un plat de base (Zogbo ou reçu Gbégamey).
 * `left` sert d’avertissement au client ; `maxSold` borne la vente de façon
 * atomique (stock − pertes), quelle que soit la valeur de `left` affichée.
 */
async function getBaseDishStockLeft(
  date: string,
  site: VenteSite,
  productId: string,
): Promise<{ left: number; maxSold: number | null }> {
  if (await isVentesSansStockActive(date, site)) {
    return { left: Number.MAX_SAFE_INTEGER, maxSold: null };
  }
  if (site === "zogbo") {
    const { day } = await getZogboDayPayload(date);
    const line = day.lines.find((l) => l.productId === productId);
    if (!line) return { left: 0, maxSold: 0 };
    const computed = computeZogboLine(line, 0);
    return {
      left: computed.prevalentRemaining,
      maxSold: computed.prevalentMaxSold,
    };
  }
  const { day, sentByProductId } = await getGbegameyDayPayload(date);
  const line = day.transferLines.find((l) => l.productId === productId);
  if (!line) return { left: 0, maxSold: 0 };
  const computed = computeTransferLine(
    line,
    sentByProductId[productId] ?? 0,
    0,
  );
  return {
    left: computed.prevalentRemaining,
    maxSold: computed.prevalentMaxSold,
  };
}

/** Un accompagnement est suivi (stock contrôlé) dès qu'il a une activité. */
export function accompanimentTracked(line: GbegameyLocalLine): boolean {
  return (
    line.initialStock > 0 ||
    line.prepared > 0 ||
    line.counted !== null ||
    line.pertes > 0
  );
}

/**
 * Disponibilité d'un accompagnement, identique à Zogbo et à Gbégamey :
 * le stock est une indication pour le caissier, jamais un blocage — les
 * accompagnements restent vendables même à stock nul.
 */
export function accompanimentAvailability(
  line: GbegameyLocalLine | null | undefined,
): { tracked: boolean; stockLeft: number | null; maxSold: number | null } {
  if (!line || !accompanimentTracked(line)) {
    return { tracked: false, stockLeft: null, maxSold: null };
  }
  // Comptage saisi : le stock physique prévaut sur le théorique.
  if (line.counted !== null && line.counted !== undefined) {
    const prevalent = Math.max(0, Number(line.counted) || 0);
    return {
      tracked: true,
      stockLeft: Math.max(0, prevalent - line.sold),
      maxSold: null,
    };
  }
  const stock = Math.max(
    0,
    line.initialStock + line.prepared - Math.max(0, Number(line.pertes) || 0),
  );
  return {
    tracked: true,
    stockLeft: Math.max(0, stock - line.sold),
    maxSold: null,
  };
}

export async function getVenteBoard(
  date: string,
  site: VenteSite,
  options?: { recentLimit?: number },
): Promise<{
  date: string;
  site: VenteSite;
  products: VenteProduct[];
  recent: VenteLogEntry[];
  caToday: number;
  /** Répartition du CA du jour entre les équipes */
  caParEquipe: Record<UserShift, number>;
  /** Ventes sans plafond stock (après reset, jusqu'à saisie stock). */
  ventesSansStock: boolean;
}> {
  if (!isValidDate(date)) throw new Error("Date invalide");
  if (site !== "zogbo" && site !== "gbegamey") {
    throw new Error("Site invalide");
  }

  const recentLimit = Math.min(
    1000,
    Math.max(1, options?.recentLimit ?? 40),
  );

  const parametres = await getParametres();
  const [zogbo, gbegamey, boissons, recent, caToday, qrProductIds] =
    await Promise.all([
      getZogboDayPayload(date),
      getGbegameyDayPayload(date),
      getBoissonsDayPayload(date),
      listRecentVentes(date, site, recentLimit),
      sumCaForSite(date, site),
      listSellableQrProductIds(site),
    ]);

  const caParEquipe = await sumCaByShift(date, site);

  const ventesSansStock =
    site === "zogbo"
      ? dayVentesSansStock(zogbo.day)
      : dayVentesSansStock(gbegamey.day);

  const products: VenteProduct[] = [];

  if (site === "zogbo") {
    // Grille construite depuis les paramètres (comme Gbégamey) : le catalogue
    // statique n'était pas maître de la base produits réelle — les articles
    // en stock (brochette, chawarma, choukouya…) n'apparaissaient pas.
    const soldById = new Map(
      zogbo.day.lines.map((l) => [l.productId, l.sold]),
    );
    for (const dish of parametres.baseDishes) {
      const line = zogbo.day.lines.find((l) => l.productId === dish.id);
      const computed = line ? computeZogboLine(line, 0) : null;
      const stockLeft = ventesSansStock
        ? null
        : (computed?.prevalentRemaining ?? 0);
      const status = ventesSansStock
        ? { hint: "Vente libre — stock non saisi", blockReason: null }
        : zogboPlatStatus({
            stockLeft: computed?.prevalentRemaining ?? 0,
            prepared: line?.prepared ?? 0,
            stock: line?.stock ?? 0,
            sold: line?.sold ?? 0,
          });
      products.push({
        kind: "plat",
        productId: dish.id,
        name: dish.name,
        unitPrice: dish.unitPrice,
        soldToday: soldById.get(dish.id) ?? 0,
        stockLeft,
        lowStock: ventesSansStock
          ? false
          : isLowStock(computed?.prevalentRemaining ?? 0, dish.alertThreshold),
        hint: status.hint,
        blockReason: status.blockReason,
        qrRequired: qrProductIds.has(dish.id),
      });
    }
    const accById = new Map(
      (zogbo.day.accompanimentLines ?? []).map((l) => [l.productId, l]),
    );
    for (const dish of parametres.localDishes) {
      const line = accById.get(dish.id);
      const { tracked, stockLeft } = accompanimentAvailability(line);
      products.push({
        kind: "local",
        productId: dish.id,
        name: dish.name,
        unitPrice: dish.unitPrice,
        soldToday: line?.sold ?? 0,
        stockLeft,
        qrRequired: qrProductIds.has(dish.id),
      });
    }
  } else {
    for (const dish of parametres.baseDishes) {
      const line = gbegamey.day.transferLines.find(
        (l) => l.productId === dish.id,
      );
      const sent = gbegamey.sentByProductId[dish.id] ?? 0;
      const computed = line
        ? computeTransferLine(line, sent, dish.unitPrice)
        : null;
      const stockLeft = ventesSansStock
        ? null
        : (computed?.prevalentRemaining ?? 0);
      const status = ventesSansStock
        ? { hint: "Vente libre — stock non saisi", blockReason: null }
        : gbegameyPlatStatus({
            stockLeft: computed?.prevalentRemaining ?? 0,
            sent,
            initialStock: line?.initialStock ?? 0,
            sold: line?.sold ?? 0,
            counted: line?.counted ?? null,
          });
      products.push({
        kind: "plat",
        productId: dish.id,
        name: dish.name,
        unitPrice: dish.unitPrice,
        soldToday: line?.sold ?? 0,
        stockLeft,
        lowStock: ventesSansStock
          ? false
          : isLowStock(computed?.prevalentRemaining ?? 0, dish.alertThreshold),
        hint: status.hint,
        blockReason: status.blockReason,
        qrRequired: qrProductIds.has(dish.id),
      });
    }
    // Même règle qu'à Zogbo : un accompagnement jamais préparé ni compté
    // n'est pas bloqué à zéro — le stock réel n'est pas encore maîtrisé.
    for (const dish of parametres.localDishes) {
      const line = gbegamey.day.localLines.find((l) => l.productId === dish.id);
      const { tracked, stockLeft } = accompanimentAvailability(line);
      products.push({
        kind: "local",
        productId: dish.id,
        name: dish.name,
        unitPrice: dish.unitPrice,
        soldToday: line?.sold ?? 0,
        stockLeft,
        qrRequired: qrProductIds.has(dish.id),
      });
    }
  }

  const drinkSold = new Map(
    boissons.day.lines.map((l) => [
      l.productId,
      site === "zogbo" ? l.soldZogbo : l.soldGbegamey,
    ]),
  );
  const drinkById = new Map(parametres.drinks.map((d) => [d.id, d]));
  const drinkStock = new Map(
    boissons.day.lines.map((l) => {
      const drink = drinkById.get(l.productId);
      return [
        l.productId,
        physicalBoissonsStockForSite(l, site, drink?.unitsPerCasier),
      ];
    }),
  );
  for (const drink of parametres.drinks) {
    const stockLeft = drinkStock.get(drink.id) ?? 0;
    const upc = Math.max(1, drink.unitsPerCasier || 12);
    const line = boissons.day.lines.find((l) => l.productId === drink.id);
    const countedThisSite =
      site === "zogbo" ? line?.countedZogbo : line?.countedGbegamey;
    // Boisson jamais inventoriée (aucun comptage, stock 0) : vendable sans
    // stock, comme un accompagnement non suivi — sinon elle resterait grisée.
    const untracked =
      ventesSansStock ||
      (countedThisSite === null && stockLeft <= 0 && (drink.salePrice ?? 0) > 0);
    products.push({
      kind: "boisson",
      productId: drink.id,
      name: drink.name,
      unitPrice: drink.salePrice ?? 0,
      soldToday: drinkSold.get(drink.id) ?? 0,
      stockLeft: drink.salePrice === null || untracked ? null : stockLeft,
      lowStock:
        drink.salePrice !== null &&
        !untracked &&
        isLowStock(stockLeft, drink.alertThreshold),
      hint:
        drink.salePrice === null
          ? "PV manquant"
          : untracked
            ? "Stock non inventorié"
            : stockLeft <= 0
              ? "Plus de stock boisson inventorié"
              : `Reste ${stockLeft} bt`,
      blockReason:
        drink.salePrice === null
          ? "Prix de vente manquant"
          : !untracked && stockLeft <= 0
            ? "Stock boisson épuisé"
            : null,
      qrRequired: qrProductIds.has(drink.id),
    });
  }

  return { date, site, products, recent, caToday, caParEquipe, ventesSansStock };
}

/** CA du jour réparti par équipe — répond à « quelle équipe a vendu ». */
export async function sumCaByShift(
  date: string,
  site: VenteSite | "all",
): Promise<Record<UserShift, number>> {
  const db = await getDb();
  const match: Record<string, unknown> = { date, ...ACTIVE };
  if (site !== "all") match.site = site;

  const rows = await db
    .collection<VenteLogDoc>("ventes_log")
    .aggregate<{ _id: UserShift | null; total: number }>([
      { $match: match },
      { $group: { _id: "$shift", total: { $sum: "$amount" } } },
    ])
    .toArray();

  const parEquipe: Record<UserShift, number> = { jour: 0, nuit: 0, aucune: 0 };
  for (const row of rows) {
    // Les ventes antérieures aux équipes n'en portent aucune : elles vont
    // dans « hors équipe » plutôt que d'être attribuées arbitrairement.
    parEquipe[effectiveShift(row._id)] += row.total;
  }
  const reductions = await sumPosReductionsByShift(date, site);
  for (const shift of ["jour", "nuit", "aucune"] as UserShift[]) {
    parEquipe[shift] -= reductions[shift];
  }
  return parEquipe;
}

export type ShiftDayRow = {
  date: string;
  jour: number;
  nuit: number;
  aucune: number;
  total: number;
};

export type ShiftRangeSummary = {
  days: ShiftDayRow[];
  totals: Record<UserShift, number> & { total: number };
};

/** Retranche les réductions POS du CA brut par jour et équipe (CA net). */
export function applyShiftReductions(
  byDate: Map<string, Record<UserShift, number>>,
  reductions: Map<string, Record<UserShift, number>>,
): void {
  for (const [date, byShift] of reductions) {
    const bucket = byDate.get(date) ?? { jour: 0, nuit: 0, aucune: 0 };
    bucket.jour -= byShift.jour;
    bucket.nuit -= byShift.nuit;
    bucket.aucune -= byShift.aucune;
    byDate.set(date, bucket);
  }
}

/** CA réparti par équipe sur une période — une ligne par jour ouvert. */
export async function sumCaByShiftRange(
  from: string,
  to: string,
  site: VenteSite | "all",
): Promise<ShiftRangeSummary> {
  const db = await getDb();
  const match: Record<string, unknown> = {
    date: { $gte: from, $lte: to },
    ...ACTIVE,
  };
  if (site !== "all") match.site = site;

  const rows = await db
    .collection<VenteLogDoc>("ventes_log")
    .aggregate<{
      _id: { date: string; shift: UserShift | null };
      total: number;
    }>([
      { $match: match },
      {
        $group: {
          _id: { date: "$date", shift: "$shift" },
          total: { $sum: "$amount" },
        },
      },
      { $sort: { "_id.date": 1 } },
    ])
    .toArray();

  const byDate = new Map<string, Record<UserShift, number>>();
  for (const row of rows) {
    const date = row._id.date;
    const shift = effectiveShift(row._id.shift);
    const bucket = byDate.get(date) ?? { jour: 0, nuit: 0, aucune: 0 };
    bucket[shift] += row.total;
    byDate.set(date, bucket);
  }

  const reductions = await sumPosReductionsByShiftRange(from, to, site);
  applyShiftReductions(byDate, reductions);

  const days: ShiftDayRow[] = [];
  const totals: Record<UserShift, number> = { jour: 0, nuit: 0, aucune: 0 };
  let cursor: string | null = from;
  while (cursor && cursor <= to) {
    const par = byDate.get(cursor) ?? { jour: 0, nuit: 0, aucune: 0 };
    const total = par.jour + par.nuit + par.aucune;
    days.push({ date: cursor, ...par, total });
    totals.jour += par.jour;
    totals.nuit += par.nuit;
    totals.aucune += par.aucune;
    cursor = shiftIsoDate(cursor, 1);
  }

  return {
    days,
    totals: {
      ...totals,
      total: totals.jour + totals.nuit + totals.aucune,
    },
  };
}

/** CA actif du jour pour un site — journal des ventes moins réductions POS. */
export async function sumPosReductions(
  date: string,
  site: VenteSite | "all",
): Promise<number> {
  const db = await getDb();
  const match: Record<string, unknown> = {
    date,
    statut: "valide",
    reduction: { $gt: 0 },
  };
  if (site !== "all") match.site = site;
  const rows = await db
    .collection("pos_tickets")
    .aggregate<{ total: number }>([
      { $match: match },
      { $group: { _id: null, total: { $sum: "$reduction" } } },
    ])
    .toArray();
  return rows[0]?.total ?? 0;
}

/** Réductions POS du jour, réparties par équipe du ticket. */
export async function sumPosReductionsByShift(
  date: string,
  site: VenteSite | "all",
): Promise<Record<UserShift, number>> {
  const db = await getDb();
  const match: Record<string, unknown> = {
    date,
    statut: "valide",
    reduction: { $gt: 0 },
  };
  if (site !== "all") match.site = site;
  const rows = await db
    .collection("pos_tickets")
    .aggregate<{ _id: UserShift | null; total: number }>([
      { $match: match },
      { $group: { _id: "$shift", total: { $sum: "$reduction" } } },
    ])
    .toArray();
  const out: Record<UserShift, number> = { jour: 0, nuit: 0, aucune: 0 };
  for (const row of rows) {
    out[effectiveShift(row._id)] += row.total;
  }
  return out;
}

/** Réductions POS d’une période, groupées par jour et équipe du ticket. */
export async function sumPosReductionsByShiftRange(
  from: string,
  to: string,
  site: VenteSite | "all",
): Promise<Map<string, Record<UserShift, number>>> {
  const db = await getDb();
  const match: Record<string, unknown> = {
    date: { $gte: from, $lte: to },
    statut: "valide",
    reduction: { $gt: 0 },
  };
  if (site !== "all") match.site = site;
  const rows = await db
    .collection("pos_tickets")
    .aggregate<{
      _id: { date: string; shift: UserShift | null };
      total: number;
    }>([
      { $match: match },
      {
        $group: {
          _id: { date: "$date", shift: "$shift" },
          total: { $sum: "$reduction" },
        },
      },
    ])
    .toArray();
  const out = new Map<string, Record<UserShift, number>>();
  for (const row of rows) {
    const date = row._id.date;
    const bucket = out.get(date) ?? { jour: 0, nuit: 0, aucune: 0 };
    bucket[effectiveShift(row._id.shift)] += row.total;
    out.set(date, bucket);
  }
  return out;
}

export async function sumCaForSite(
  date: string,
  site: VenteSite,
): Promise<number> {
  const db = await getDb();
  const [logRows, reductions] = await Promise.all([
    db
      .collection<VenteLogDoc>("ventes_log")
      .aggregate<{ total: number }>([
        { $match: { ...ACTIVE, date, site } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ])
      .toArray(),
    sumPosReductions(date, site),
  ]);
  return (logRows[0]?.total ?? 0) - reductions;
}

/** CA journal figé pour un type de produit, net des réductions POS au prorata. */
export async function sumCaByKindForSite(
  date: string,
  site: VenteSite,
  kind: VenteKind,
): Promise<number> {
  const db = await getDb();
  const [kindRows, grossSite, netSite] = await Promise.all([
    db
      .collection<VenteLogDoc>("ventes_log")
      .aggregate<{ total: number }>([
        { $match: { ...ACTIVE, date, site, kind } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ])
      .toArray(),
    db
      .collection<VenteLogDoc>("ventes_log")
      .aggregate<{ total: number }>([
        { $match: { ...ACTIVE, date, site } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ])
      .toArray(),
    sumCaForSite(date, site),
  ]);
  const kindGross = kindRows[0]?.total ?? 0;
  const siteGross = grossSite[0]?.total ?? 0;
  if (siteGross <= 0) return 0;
  return Math.round(kindGross * (Math.max(0, netSite) / siteGross));
}

/** Dernière journée avec au moins une vente active sur le site. */
export async function getLastSaleDate(
  site: VenteSite,
): Promise<string | null> {
  const db = await getDb();
  const doc = await db.collection<VenteLogDoc>("ventes_log").findOne(
    { site, ...ACTIVE },
    { sort: { date: -1, at: -1 }, projection: { date: 1 } },
  );
  return doc?.date ?? null;
}

async function listRecentVentes(
  date: string,
  site: VenteSite,
  limit: number,
): Promise<VenteLogEntry[]> {
  const db = await getDb();
  const docs = await db
    .collection<VenteLogDoc>("ventes_log")
    .find({ date, site, ...ACTIVE })
    .sort({ at: -1 })
    .limit(limit)
    .toArray();

  return docs.map(mapVenteLogDoc);
}

/** Sorties (ventes) du jour pour un type de produit — registre boissons */
export async function listVentesByKind(input: {
  date: string;
  kind: VenteKind;
  site?: VenteSite | "all";
  limit?: number;
}): Promise<VenteLogEntry[]> {
  if (!isValidDate(input.date)) throw new Error("Date invalide");
  const db = await getDb();
  const filter: Filter<VenteLogDoc> = {
    ...ACTIVE,
    date: input.date,
    kind: input.kind,
  };
  if (input.site && input.site !== "all") filter.site = input.site;

  const docs = await db
    .collection<VenteLogDoc>("ventes_log")
    .find(filter)
    .sort({ at: -1 })
    .limit(input.limit ?? 80)
    .toArray();

  return docs.map(mapVenteLogDoc);
}

/** Toutes les ventes actives du jour pour un site — journal complet. */
export async function listVentesForSite(input: {
  date: string;
  site: VenteSite;
  limit?: number;
}): Promise<VenteLogEntry[]> {
  if (!isValidDate(input.date)) throw new Error("Date invalide");
  const db = await getDb();
  const docs = await db
    .collection<VenteLogDoc>("ventes_log")
    .find({ date: input.date, site: input.site, ...ACTIVE })
    .sort({ at: 1 })
    .limit(input.limit ?? 500)
    .toArray();
  return docs.map(mapVenteLogDoc);
}

/** Synthèse du journal de ventes pour un site et une date. */
export async function summarizeVentesForSite(
  date: string,
  site: VenteSite,
): Promise<VentesDaySummary> {
  if (!isValidDate(date)) throw new Error("Date invalide");
  const db = await getDb();
  const docs = await db
    .collection<VenteLogDoc>("ventes_log")
    .find({ date, site, ...ACTIVE })
    .toArray();

  const byKind: VentesDaySummary["byKind"] = {};
  const bySource: VentesDaySummary["bySource"] = {};
  let articles = 0;
  let montant = 0;

  for (const d of docs) {
    articles += d.qty;
    montant += d.amount;
    const kind = d.kind;
    const kindBucket = byKind[kind] ?? { lignes: 0, qty: 0, montant: 0 };
    kindBucket.lignes += 1;
    kindBucket.qty += d.qty;
    kindBucket.montant += d.amount;
    byKind[kind] = kindBucket;

    const src = d.source ?? "caisse";
    const srcBucket = bySource[src] ?? { lignes: 0, montant: 0 };
    srcBucket.lignes += 1;
    srcBucket.montant += d.amount;
    bySource[src] = srcBucket;
  }

  const reductions = await sumPosReductions(date, site);
  const brut = montant;
  const net = Math.max(0, brut - reductions);
  const ratio = brut > 0 ? net / brut : 1;
  if (ratio !== 1) {
    for (const k of Object.keys(byKind) as (keyof typeof byKind)[]) {
      const bucket = byKind[k];
      if (bucket) bucket.montant = Math.round(bucket.montant * ratio);
    }
    for (const k of Object.keys(bySource) as (keyof typeof bySource)[]) {
      const bucket = bySource[k];
      if (bucket) bucket.montant = Math.round(bucket.montant * ratio);
    }
  }

  return {
    lignes: docs.length,
    articles,
    montant: net,
    byKind,
    bySource,
  };
}

type SoldTarget = {
  collection: string;
  arrayField: "lines" | "transferLines" | "localLines" | "accompanimentLines";
  soldField: "sold" | "soldZogbo" | "soldGbegamey";
  name: string;
  unitPrice: number;
  /** Prix d’achat figé au moment de la vente (boissons) */
  costPrice: number;
  ensure: () => Promise<void>;
};

/**
 * Résout la cible d’un mouvement de vente **et vérifie le prix avant toute
 * écriture** : si le prix manque, rien ne doit être décrémenté.
 */
async function resolveSoldTarget(input: {
  date: string;
  site: VenteSite;
  kind: VenteKind;
  productId: string;
}): Promise<SoldTarget> {
  const { date, site, kind, productId } = input;
  const parametres = await getParametres();

  if (kind === "plat") {
    const dish = parametres.baseDishes.find((d) => d.id === productId);
    if (!dish) throw new Error("Plat introuvable");
    return site === "zogbo"
      ? {
          collection: "zogbo_jours",
          arrayField: "lines",
          soldField: "sold",
          name: dish.name,
          unitPrice: dish.unitPrice,
          costPrice: 0,
          ensure: () => ensureZogboDay(date),
        }
      : {
          collection: "gbegamey_jours",
          arrayField: "transferLines",
          soldField: "sold",
          name: dish.name,
          unitPrice: dish.unitPrice,
          costPrice: 0,
          ensure: () => ensureGbegameyDay(date),
        };
  }

  if (kind === "local") {
    const dish = parametres.localDishes.find((d) => d.id === productId);
    if (!dish) throw new Error("Accompagnement introuvable");
    if (site === "zogbo") {
      return {
        collection: "zogbo_jours",
        arrayField: "accompanimentLines",
        soldField: "sold",
        name: dish.name,
        unitPrice: dish.unitPrice,
        costPrice: 0,
        ensure: () => ensureZogboAccompanimentDay(date),
      };
    }
    return {
      collection: "gbegamey_jours",
      arrayField: "localLines",
      soldField: "sold",
      name: dish.name,
      unitPrice: dish.unitPrice,
      costPrice: 0,
      ensure: () => ensureGbegameyDay(date),
    };
  }

  const drink = parametres.drinks.find((d) => d.id === productId);
  if (!drink) throw new Error("Boisson introuvable");
  if (drink.salePrice === null || drink.salePrice === undefined) {
    throw new Error(`Prix de vente manquant pour « ${drink.name} » (Paramètres)`);
  }
  return {
    collection: "boissons_jours",
    arrayField: "lines",
    soldField: site === "zogbo" ? "soldZogbo" : "soldGbegamey",
    name: drink.name,
    unitPrice: drink.salePrice,
    costPrice: drink.purchasePrice,
    ensure: () => ensureBoissonsDay(date),
  };
}

/**
 * Crée le document du jour s’il manque, ou si le produit n’y figure pas
 * encore (catalogue modifié en cours de journée).
 */
async function ensureLinePresent(target: SoldTarget, input: {
  date: string;
  productId: string;
}): Promise<void> {
  const db = await getDb();
  const doc = await db
    .collection<DayCounterDoc>(target.collection)
    .findOne(
      { _id: input.date },
      { projection: { [target.arrayField]: 1 } },
    );
  const lines = ((doc as Record<string, unknown> | null)?.[
    target.arrayField
  ] ?? []) as { productId: string }[];
  if (doc && lines.some((l) => l.productId === input.productId)) return;
  await target.ensure();
}

async function ensureZogboDay(date: string): Promise<void> {
  const { day } = await getZogboDayPayload(date);
  await saveZogboDay({ date, status: day.status, lines: day.lines });
}

async function ensureZogboAccompanimentDay(date: string): Promise<void> {
  const parametres = await getParametres();
  const { day } = await getZogboDayPayload(date);
  const db = await getDb();
  const lines =
    day.accompanimentLines ??
    parametres.localDishes.map((d) => ({
      productId: d.id,
      name: d.name,
      initialStock: 0,
      prepared: 0,
      sold: 0,
      pertes: 0,
      counted: null,
      observations: "",
    }));
  await db.collection("zogbo_jours").updateOne(
    { _id: date as never },
    {
      $set: {
        accompanimentLines: lines,
        updatedAt: new Date().toISOString(),
      },
      $setOnInsert: {
        status: "ouverte",
        lines: [],
        movements: [],
      },
    },
    { upsert: true },
  );
}

async function ensureGbegameyDay(date: string): Promise<void> {
  const { day } = await getGbegameyDayPayload(date);
  await saveGbegameyDay({
    date,
    status: day.status,
    transferLines: day.transferLines,
    localLines: day.localLines,
  });
}



async function ensureBoissonsDay(date: string): Promise<void> {
  const { day } = await getBoissonsDayPayload(date);
  // Réenregistrement à l'identique (juste pour garantir la présence de la
  // ligne avant l'incrément atomique) : le site passé ici n'a pas d'effet,
  // aucune valeur n'est modifiée.
  await saveBoissonsDay({
    date,
    site: "zogbo",
    status: day.status,
    lines: day.lines,
  });
}

/**
 * Incrément atomique du compteur vendu : une seule écriture MongoDB, sans
 * relire-modifier-réécrire. Deux ventes simultanées ne peuvent plus
 * s’écraser l’une l’autre. `maxSold`, s’il est fourni, borne la vente dans
 * la même écriture (stock − pertes) : le contrôle et l’incrément sont
 * inséparables — pas de course possible sur la dernière portion.
 */
async function applySoldDelta(input: {
  date: string;
  site: VenteSite;
  kind: VenteKind;
  productId: string;
  delta: number;
  /** Plafond absolu du vendu (stock − pertes) ; null = non borné. */
  maxSold?: number | null;
}): Promise<{
  name: string;
  unitPrice: number;
  costPrice: number;
  soldToday: number;
}> {
  const target = await resolveSoldTarget(input);
  await ensureLinePresent(target, input);

  const { arrayField, soldField } = target;
  const upper =
    input.maxSold === null || input.maxSold === undefined
      ? null
      : Math.max(0, input.maxSold) - input.delta;
  const db = await getDb();
  const updated = await db
    .collection<DayCounterDoc>(target.collection)
    .findOneAndUpdate(
    {
      _id: input.date,
      [arrayField]: {
        $elemMatch: {
          productId: input.productId,
          [soldField]: {
            $gte: -input.delta,
            ...(upper !== null ? { $lte: upper } : {}),
          },
        },
      },
    },
    {
      $inc: {
        [`${arrayField}.$[el].${soldField}`]: input.delta,
        rev: 1,
      },
      $set: { updatedAt: new Date().toISOString() },
    },
    {
      arrayFilters: [{ "el.productId": input.productId }],
      returnDocument: "after",
      projection: { [arrayField]: 1 },
    },
  );

  if (!updated) {
    throw new Error(
      `Impossible d’enregistrer « ${target.name} » : stock insuffisant ou annulation invalide.`,
    );
  }

  const lines = ((updated as Record<string, unknown>)[arrayField] ??
    []) as Record<string, unknown>[];
  const line = lines.find((l) => l.productId === input.productId);
  const soldToday = Math.max(0, Number(line?.[soldField]) || 0);

  return {
    name: target.name,
    unitPrice: target.unitPrice,
    costPrice: target.costPrice,
    soldToday,
  };
}

export async function recordVente(input: {
  date: string;
  site: VenteSite;
  kind: VenteKind;
  productId: string;
  qty?: number;
  /** Prix unitaire figé (ex. accompagnement à 500 ou 1 000 selon le plat). */
  unitPrice?: number;
  actor?: VenteActor | null;
  /** Gérant / admin : autorise une écriture sur une journée déjà clôturée. */
  bypassClosedDay?: boolean;
  /**
   * Gérant / admin sur une vente passée : enregistre même si le stock du jour
   * est nul ou insuffisant (régularisation). Le compteur `sold` monte quand même.
   */
  bypassStock?: boolean;
  /** Lien vers l'unité QR vendue (plats tracés). */
  qrId?: string | null;
}): Promise<{
  entry: VenteLogEntry;
  soldToday: number;
  board: Awaited<ReturnType<typeof getVenteBoard>>;
}> {
  const qty = input.qty ?? 1;
  // Une quantité négative est une correction de saisie (bouton « − » du mode
  // rapide) : elle reprend le stock via applySoldDelta, dont le filtre
  // interdit de faire descendre le vendu sous zéro.
  if (!Number.isFinite(qty) || qty === 0) {
    throw new Error("Quantité invalide");
  }
  if (input.qrId && qty !== 1) {
    throw new Error("Une unité QR ne peut être vendue qu'à la quantité 1.");
  }
  if (!isValidDate(input.date)) throw new Error("Date invalide");

  await assertDayNotClosed(input.date, input.site, input.kind, {
    bypassClosedDay: input.bypassClosedDay,
  });

  // Contrôle stock + plafond atomique. « maxSold » est le vendu maximal
  // (stock − pertes) : transmis à applySoldDelta, il borne l'écriture.
  // Régularisation gérant : pas de plafond (maxSold null).
  let maxSold: number | null = null;
  const ventesSansStock = await isVentesSansStockActive(input.date, input.site);
  if (qty > 0 && !input.bypassStock && !input.qrId && !ventesSansStock) {
    if (input.kind === "plat") {
      const { left, maxSold: max } = await getBaseDishStockLeft(
        input.date,
        input.site,
        input.productId,
      );
      maxSold = max;
      if (left < qty) {
        throw new Error(`Stock insuffisant (reste ${left})`);
      }
    } else if (input.kind === "local") {
      // Accompagnements toujours vendables, même à stock nul : le stock est
      // une indication, jamais un blocage.
      maxSold = null;
    } else if (input.kind === "boisson") {
      const { day, drinks } = await getBoissonsDayPayload(input.date);
      const line = day.lines.find((l) => l.productId === input.productId);
      const drink = drinks.find((d) => d.id === input.productId);
      const upc = drink?.unitsPerCasier;
      const countedThisSite = line
        ? input.site === "zogbo"
          ? line.countedZogbo
          : line.countedGbegamey
        : null;
      // Boisson jamais inventoriée (pas de comptage) : vente libre, comme un
      // accompagnement non suivi — sinon elle resterait « épuisée » à tort.
      const untracked = !line || countedThisSite === null;
      if (untracked) {
        maxSold = null;
      } else {
        const left = physicalBoissonsStockForSite(line, input.site, upc);
        const upcResolved = Math.max(
          1,
          Math.round(Number(upc) || DEFAULT_UNITS_PER_CASIER),
        );
        const initialStock =
          input.site === "zogbo"
            ? line.initialStockZogbo
            : line.initialStockGbegamey;
        const purchases =
          input.site === "zogbo" ? line.purchasesZogbo : line.purchasesGbegamey;
        const pertes =
          input.site === "zogbo" ? line.pertesZogbo : line.pertesGbegamey;
        // Comptage saisi en bouteilles : le stock physique prévaut.
        const stockBottles =
          countedThisSite !== null && countedThisSite !== undefined
            ? Math.max(0, Number(countedThisSite) || 0)
            : (initialStock + purchases) * upcResolved;
        // Stock propre à ce site : plus besoin de retirer les ventes de
        // l'autre site, elles ne partagent plus le même pot.
        maxSold = Math.max(
          0,
          stockBottles - Math.max(0, Number(pertes) || 0),
        );
        if (left < qty) {
          throw new Error(`Stock insuffisant (reste ${left} bt)`);
        }
      }
    }
  }

  // Prix du serveur : le client ne fixe jamais le tarif d'un produit du
  // catalogue. Un plat ou une boisson ne s'accepte qu'au prix du catalogue ;
  // les accompagnements n'acceptent qu'un prix légal (catalogue ou
  // plat + accompagnement). Vérifié AVANT toute écriture de stock.
  const target = await resolveSoldTarget({
    date: input.date,
    site: input.site,
    kind: input.kind,
    productId: input.productId,
  });
  const unitPriceOverride = Math.round(Number(input.unitPrice) || 0);
  let unitPrice = target.unitPrice;
  if (unitPriceOverride > 0) {
    if (input.kind === "local") {
      // Prix légal : celui du catalogue (paramètres) ou les grilles
      // « plat + accompagnement » (500 / 1 000) du catalogue statique.
      const legal =
        unitPriceOverride === target.unitPrice ||
        isLegalAccompanimentPrice(input.productId, unitPriceOverride);
      if (!legal) {
        throw new Error(
          `Prix non autorisé pour cet accompagnement : ${unitPriceOverride} F.`,
        );
      }
      unitPrice = unitPriceOverride;
    } else if (input.kind !== "extra" && unitPriceOverride !== target.unitPrice) {
      throw new Error(
        `Prix non autorisé pour « ${target.name} » : ${unitPriceOverride} F.`,
      );
    }
  }

  const result = await applySoldDelta({
    date: input.date,
    site: input.site,
    kind: input.kind,
    productId: input.productId,
    delta: qty,
    maxSold,
  });

  const at = new Date().toISOString();
  const amount = Math.abs(qty) * unitPrice;
  const db = await getDb();
  let insert;
  try {
    insert = await db.collection<VenteLogDoc>("ventes_log").insertOne({
      _id: new ObjectId(),
      date: input.date,
      site: input.site,
      kind: input.kind,
      productId: input.productId,
      name: result.name,
      qty,
      unitPrice,
      costPrice: result.costPrice,
      amount: qty > 0 ? amount : -amount,
      at,
      cancelledAt: null,
      baseProductId: null,
      actorId: input.actor?.id ?? null,
      actorName: input.actor?.name ?? null,
      actorUsername: input.actor?.username ?? null,
      shift: effectiveShift(input.actor?.shift),
      qrId: input.qrId ?? null,
    });
  } catch (error) {
    try {
      await applySoldDelta({
        date: input.date,
        site: input.site,
        kind: input.kind,
        productId: input.productId,
        delta: -qty,
      });
    } catch {
      /* best effort : le compteur sold ne doit pas rester sans journal */
    }
    throw error;
  }

  const entry: VenteLogEntry = {
    id: insert.insertedId.toHexString(),
    date: input.date,
    site: input.site,
    kind: input.kind,
    productId: input.productId,
    name: result.name,
    qty,
    unitPrice,
    amount: qty > 0 ? amount : -amount,
    at,
  };

  const board = await getVenteBoard(input.date, input.site);
  return { entry, soldToday: result.soldToday, board };
}

/** Vente libre : description + prix, comptée dans le CA du point (sans stock). */
export async function recordExtraVente(input: {
  date: string;
  site: VenteSite;
  description: string;
  unitPrice: number;
  /** Unités facturées — une ligne de panier POS peut en porter plusieurs. */
  qty?: number;
  /** Fiche Immobilisations (emballage) : décrémente le stock à la vente. */
  immobilisationId?: string | null;
  actor?: VenteActor | null;
}): Promise<{
  entry: VenteLogEntry;
  board: Awaited<ReturnType<typeof getVenteBoard>>;
}> {
  if (!isValidDate(input.date)) throw new Error("Date invalide");
  const description = input.description.trim().replace(/\s+/g, " ");
  if (description.length < 2) {
    throw new Error("Décrivez la vente (au moins 2 caractères).");
  }
  if (description.length > 200) {
    throw new Error("Description trop longue (200 caractères max).");
  }
  const unitPrice = Math.round(Number(input.unitPrice) || 0);
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
    throw new Error("Prix invalide (montant en FCFA requis).");
  }
  const qty = Math.round(Number(input.qty ?? 1));
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new Error("Quantité invalide");
  }

  const immoId =
    input.immobilisationId && ObjectId.isValid(input.immobilisationId)
      ? input.immobilisationId
      : null;
  let costPrice = 0;
  if (immoId) {
    const { cost } = await adjustImmobilisationQty({
      id: immoId,
      delta: qty,
      siteScope: input.site,
    });
    costPrice = Math.max(0, Math.round(Number(cost) || 0));
  }

  const at = new Date().toISOString();
  const productId = immoId ?? newId("extra");
  const db = await getDb();
  let insert;
  try {
    insert = await db.collection<VenteLogDoc>("ventes_log").insertOne({
      _id: new ObjectId(),
      date: input.date,
      site: input.site,
      kind: "extra",
      productId,
      name: description,
      qty,
      unitPrice,
      costPrice,
      amount: qty * unitPrice,
      at,
      cancelledAt: null,
      baseProductId: null,
      actorId: input.actor?.id ?? null,
      actorName: input.actor?.name ?? null,
      actorUsername: input.actor?.username ?? null,
      shift: effectiveShift(input.actor?.shift),
    });
  } catch (error) {
    if (immoId) {
      await adjustImmobilisationQty({ id: immoId, delta: -qty, siteScope: input.site });
    }
    throw error;
  }

  const entry: VenteLogEntry = {
    id: insert.insertedId.toHexString(),
    date: input.date,
    site: input.site,
    kind: "extra",
    productId,
    name: description,
    qty,
    unitPrice,
    amount: qty * unitPrice,
    at,
  };

  const board = await getVenteBoard(input.date, input.site);
  return { entry, board };
}

/**
 * Une équipe ne peut pas annuler une vente encaissée par l'autre équipe :
 * l'équipe de nuit ne touche pas aux ventes de l'équipe de jour, et
 * réciproquement. Hors équipe (encadrement) et ventes sans équipe restent
 * annulables par tous.
 */
export function assertSameTeamCancellation(input: {
  saleShift: UserShift | string | null | undefined;
  cancellerShift: UserShift | string | null | undefined;
  /** Gérant / admin : peut annuler toute équipe. */
  bypassTeam?: boolean;
}): void {
  if (input.bypassTeam) return;
  const sale = effectiveShift(input.saleShift);
  const canceller = effectiveShift(input.cancellerShift);
  if (sale === "aucune" || canceller === "aucune") return;
  if (sale === canceller) return;
  const teamLabel = (s: UserShift) =>
    s === "jour" ? "Équipe de jour" : "Équipe de nuit";
  throw new Error(
    `Annulation refusée : une vente de l’${teamLabel(sale)} ne peut pas être annulée par l’${teamLabel(canceller)}.`,
  );
}

export async function undoVente(input: {
  id: string;
  date: string;
  site: VenteSite;
  actor?: VenteActor | null;
  bypassClosedDay?: boolean;
  bypassTeam?: boolean;
}): Promise<{
  board: Awaited<ReturnType<typeof getVenteBoard>>;
  entry: { id: string; name: string; amount: number };
}> {
  const db = await getDb();
  const doc = await db.collection<VenteLogDoc>("ventes_log").findOne({
    _id: new ObjectId(input.id),
    site: input.site,
    ...ACTIVE,
  });
  if (!doc) throw new Error("Vente introuvable ou déjà annulée");
  if (input.date && input.date !== doc.date) {
    throw new Error("Date incohérente avec la vente.");
  }

  assertSameTeamCancellation({
    saleShift: doc.shift,
    cancellerShift: input.actor?.shift,
    bypassTeam: input.bypassTeam,
  });

  const marked = await db.collection<VenteLogDoc>("ventes_log").updateOne(
    { _id: doc._id, ...ACTIVE },
    {
      $set: {
        cancelledAt: new Date().toISOString(),
        cancelledById: input.actor?.id ?? null,
        cancelledByName: input.actor?.name ?? null,
        cancelledByUsername: input.actor?.username ?? null,
      },
    },
  );
  if (marked.matchedCount === 0) {
    throw new Error("Vente introuvable ou déjà annulée");
  }

  const entry = {
    id: doc._id.toHexString(),
    name: doc.name,
    amount: doc.amount,
  };

  // Vente extra : reprendre le stock emballage si la ligne pointe une fiche.
  if (doc.kind === "extra") {
    if (ObjectId.isValid(doc.productId) && String(doc.productId).length === 24) {
      try {
        await adjustImmobilisationQty({
          id: doc.productId,
          delta: -doc.qty,
          siteScope: input.site,
        });
      } catch {
        /* extra libre, pas une fiche immobilisation */
      }
    }
    const board = await getVenteBoard(input.date, input.site);
    return { board, entry };
  }

  await assertDayNotClosed(doc.date, doc.site, doc.kind, {
    bypassClosedDay: input.bypassClosedDay,
  });

  try {
    // Le ticket est marqué annulé avant la reprise de stock : si une écriture
    // échoue (stock déjà annulé, jour clôturé…), l'annulation est défaite et
    // la vente reste active.
    await applySoldDelta({
      date: doc.date,
      site: doc.site,
      kind: doc.kind,
      productId: doc.productId,
      delta: -doc.qty,
    });
  } catch (error) {
    await db.collection<VenteLogDoc>("ventes_log").updateOne(
      { _id: doc._id },
      {
        $set: {
          cancelledAt: null,
          cancelledById: null,
          cancelledByName: null,
          cancelledByUsername: null,
        },
      },
    );
    throw error;
  }

  if (doc.qrId) {
    try {
      await restorePlatUnitAfterSaleCancel({
        qrId: doc.qrId,
        site: doc.site,
      });
    } catch {
      /* best effort : le compteur sold est déjà repris */
    }
  }

  const board = await getVenteBoard(input.date, input.site);
  return { board, entry };
}

/**
 * Corrige la quantité d'une ligne de vente (gérant / admin).
 * Met aussi à jour le ticket POS lié et le total caisse si possible.
 */
export async function editVenteQty(input: {
  id: string;
  date: string;
  site: VenteSite;
  qty: number;
  actor?: VenteActor | null;
  bypassClosedDay?: boolean;
  bypassTeam?: boolean;
  /** Gérant : augmente une qty même sans stock restant. */
  bypassStock?: boolean;
}): Promise<{
  board: Awaited<ReturnType<typeof getVenteBoard>>;
  entry: VenteLogEntry;
}> {
  const newQty = Math.round(Number(input.qty) || 0);
  if (!Number.isFinite(newQty) || newQty < 1) {
    throw new Error("Quantité invalide (minimum 1). Pour supprimer, annulez la vente.");
  }
  if (!isValidDate(input.date)) throw new Error("Date invalide");

  const db = await getDb();
  const doc = await db.collection<VenteLogDoc>("ventes_log").findOne({
    _id: new ObjectId(input.id),
    site: input.site,
    ...ACTIVE,
  });
  if (!doc) throw new Error("Vente introuvable ou déjà annulée");
  if (input.date && input.date !== doc.date) {
    throw new Error("Date incohérente avec la vente.");
  }

  assertSameTeamCancellation({
    saleShift: doc.shift,
    cancellerShift: input.actor?.shift,
    bypassTeam: input.bypassTeam,
  });

  const oldQty = doc.qty;
  const delta = newQty - oldQty;
  if (delta === 0) {
    const board = await getVenteBoard(doc.date, input.site);
    return {
      board,
      entry: {
        id: doc._id.toHexString(),
        date: doc.date,
        site: doc.site,
        kind: doc.kind,
        productId: doc.productId,
        name: doc.name,
        qty: doc.qty,
        unitPrice: doc.unitPrice,
        amount: doc.amount,
        at: doc.at,
      },
    };
  }

  await assertDayNotClosed(doc.date, doc.site, doc.kind, {
    bypassClosedDay: input.bypassClosedDay,
  });

  let maxSold: number | null = null;
  if (delta > 0 && doc.kind === "plat" && !input.bypassStock) {
    const { left, maxSold: max } = await getBaseDishStockLeft(
      doc.date,
      doc.site,
      doc.productId,
    );
    maxSold = max;
    if (left < delta) {
      throw new Error(`Stock insuffisant (reste ${left})`);
    }
  }

  if (doc.kind !== "extra") {
    await applySoldDelta({
      date: doc.date,
      site: doc.site,
      kind: doc.kind,
      productId: doc.productId,
      delta,
      maxSold:
        delta > 0 && doc.kind === "plat" && !input.bypassStock ? maxSold : null,
    });
  }

  const amount =
    Math.round(Number(doc.unitPrice) || 0) * newQty * (oldQty < 0 ? -1 : 1);

  await db.collection<VenteLogDoc>("ventes_log").updateOne(
    { _id: doc._id },
    {
      $set: {
        qty: newQty,
        amount: oldQty < 0 ? -Math.abs(amount) : Math.abs(amount),
      },
    },
  );

  // Ticket POS lié : recalcule la ligne et les totaux.
  const ticket = await db.collection("pos_tickets").findOne({
    site: input.site,
    date: doc.date,
    "lines.venteLogId": input.id,
    statut: "valide",
  });
  if (ticket) {
    const lines = (
      ticket.lines as Array<{
        venteLogId?: string | null;
        qty: number;
        unitPrice: number;
        amount: number;
      }>
    ).map((l) => {
      if (l.venteLogId !== input.id) return l;
      return {
        ...l,
        qty: newQty,
        amount: Math.round(Number(l.unitPrice) || 0) * newQty,
      };
    });
    const montantBrut = lines.reduce((s, l) => s + l.amount, 0);
    const reduction = Math.min(
      montantBrut,
      Math.max(0, Number(ticket.reduction) || 0),
    );
    const montant = montantBrut - reduction;
    const deltaTicket = montant - (Number(ticket.montant) || 0);
    await db.collection("pos_tickets").updateOne(
      { _id: ticket._id },
      {
        $set: {
          lines,
          montantBrut,
          reduction,
          montant,
        },
      },
    );
    if (ticket.caisseId && deltaTicket) {
      await adjustCaisseVenteAmount(String(ticket.caisseId), deltaTicket);
    }
  }

  const board = await getVenteBoard(doc.date, input.site);
  return {
    board,
    entry: {
      id: doc._id.toHexString(),
      date: doc.date,
      site: doc.site,
      kind: doc.kind,
      productId: doc.productId,
      name: doc.name,
      qty: newQty,
      unitPrice: doc.unitPrice,
      amount: oldQty < 0 ? -Math.abs(amount) : Math.abs(amount),
      at: doc.at,
    },
  };
}

function venteLogStockActive(doc: VenteLogDoc): boolean {
  return !doc.cancelledAt && doc.caExcluded !== true && doc.kind !== "extra";
}

type PosTicketLineDoc = {
  venteLogId?: string | null;
  qty: number;
  unitPrice: number;
  amount: number;
};

type PosTicketSnapshot = {
  _id: ObjectId;
  statut?: string;
  caisseId?: string | null;
  montant?: number;
  reduction?: number;
  lines?: PosTicketLineDoc[];
};

async function syncPosTicketAfterVenteDelete(input: {
  site: VenteSite;
  date: string;
  venteLogId: string;
  bypassClosedDay?: boolean;
}): Promise<void> {
  const db = await getDb();
  const ticket = (await db.collection("pos_tickets").findOne({
    site: input.site,
    date: input.date,
    "lines.venteLogId": input.venteLogId,
  })) as PosTicketSnapshot | null;
  if (!ticket) return;

  const lines = (ticket.lines ?? []).filter(
    (l) => l.venteLogId !== input.venteLogId,
  );
  const wasValid = ticket.statut === "valide";

  if (lines.length === 0) {
    if (wasValid && ticket.caisseId) {
      await adjustCaisseVenteAmount(
        String(ticket.caisseId),
        -(Number(ticket.montant) || 0),
      );
    }
    await db.collection("pos_tickets").deleteOne({ _id: ticket._id });
    return;
  }

  const montantBrut = lines.reduce((s, l) => s + l.amount, 0);
  const reduction = Math.min(
    montantBrut,
    Math.max(0, Number(ticket.reduction) || 0),
  );
  const montant = montantBrut - reduction;
  await db.collection("pos_tickets").updateOne(
    { _id: ticket._id },
    { $set: { lines, montantBrut, reduction, montant } },
  );
  if (wasValid && ticket.caisseId) {
    const deltaTicket = montant - (Number(ticket.montant) || 0);
    if (deltaTicket) {
      await adjustCaisseVenteAmount(String(ticket.caisseId), deltaTicket);
    }
  }
}

/**
 * Suppression physique d'une ligne ventes_log (admin uniquement via l'API).
 * Reprend le stock si la vente est encore active ; met à jour ou supprime le
 * ticket POS lié sauf si `skipPosUpdate`.
 */
export async function deleteVentePermanently(input: {
  id: string;
  date?: string;
  site: VenteSite;
  bypassClosedDay?: boolean;
  skipPosUpdate?: boolean;
}): Promise<{ id: string; name: string; amount: number; date: string }> {
  if (!ObjectId.isValid(input.id)) throw new Error("Vente invalide");
  const db = await getDb();
  const doc = await db.collection<VenteLogDoc>("ventes_log").findOne({
    _id: new ObjectId(input.id),
    site: input.site,
  });
  if (!doc) throw new Error("Vente introuvable");
  if (input.date && input.date !== doc.date) {
    throw new Error("Date incohérente avec la vente.");
  }

  if (venteLogStockActive(doc)) {
    await assertDayNotClosed(doc.date, doc.site, doc.kind, {
      bypassClosedDay: input.bypassClosedDay ?? false,
    });
    await applySoldDelta({
      date: doc.date,
      site: doc.site,
      kind: doc.kind,
      productId: doc.productId,
      delta: -doc.qty,
    });
  }

  if (!input.skipPosUpdate) {
    await syncPosTicketAfterVenteDelete({
      site: doc.site,
      date: doc.date,
      venteLogId: input.id,
      bypassClosedDay: input.bypassClosedDay,
    });
  }

  await db.collection("ventes_log").deleteOne({ _id: doc._id });
  return {
    id: input.id,
    name: doc.name,
    amount: doc.amount,
    date: doc.date,
  };
}
