import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getParametres } from "@/lib/parametres-repo";
import { getBoissonsDayPayload, saveBoissonsDay } from "@/lib/boissons-repo";
import { getCombosDayPayload, saveCombosDay } from "@/lib/combos-repo";
import { getGbegameyDayPayload, saveGbegameyDay } from "@/lib/gbegamey-repo";
import { getZogboDayPayload, saveZogboDay } from "@/lib/zogbo-repo";
import type {
  BoissonsLine,
  CombosLine,
  GbegameyLocalLine,
  GbegameyTransferLine,
  VenteKind,
  ZogboLine,
} from "@/lib/types";

/**
 * Reprise d’historique — ressaisie des journées antérieures à la mise en
 * service du logiciel.
 *
 * Les écrans du quotidien verrouillent volontairement les compteurs (`lockSold`) :
 * le stock y est piloté par les mouvements et les ventes encaissées, jamais par
 * la grille. Pour du passé il n’existe ni mouvement ni ticket à rejouer, d’où
 * cette voie d’écriture directe, réservée aux dates révolues.
 *
 * Le journal des ventes est régénéré depuis les quantités saisies, sinon le
 * chiffre d’affaires de ces journées resterait invisible. Les lignes produites
 * portent `source: "reprise"` : une resaisie remplace les siennes et ne touche
 * jamais aux ventes issues d’AquaPro ou de la caisse.
 */
export const REPRISE_SOURCE = "reprise";

/** Date de départ suggérée pour la ressaisie Zogbo (7 août 2026). */
export const ZOGBO_REPRISE_FROM = "2026-08-07";

export type RepriseSourceTotal = {
  source: string;
  lignes: number;
  montant: number;
};

export type RepriseCatalogItem = {
  id: string;
  name: string;
  kind: "plat" | "combo" | "boisson";
  unitPrice: number;
};

/** Ligne de vente Zogbo saisie via Reprise (journal détaillé). */
export type RepriseVenteZogboLine = {
  id: string;
  kind: VenteKind;
  productId: string;
  name: string;
  qty: number;
  unitPrice: number;
};

/** Vente Zogbo déjà en base (carnet, AquaPro, caisse…) — lecture seule. */
export type RepriseVenteZogboExistante = RepriseVenteZogboLine & {
  source: string;
};

export type RepriseDayPayload = {
  date: string;
  /** Une date future n’est pas de l’historique : la saisie y est refusée. */
  editable: boolean;
  catalog: RepriseCatalogItem[];
  /** Lignes saisies / modifiables via Reprise (source reprise). */
  ventesZogbo: RepriseVenteZogboLine[];
  /** Ventes déjà en base (autres sources) — conservées, non modifiables ici. */
  ventesAutresZogbo: RepriseVenteZogboExistante[];
  zogbo: ZogboLine[];
  gbegameyTransfer: GbegameyTransferLine[];
  gbegameyLocal: GbegameyLocalLine[];
  boissons: BoissonsLine[];
  combos: CombosLine[];
  /**
   * Ventes déjà au journal pour cette date, par origine. Permet à l’écran
   * d’avertir avant de regénérer : sans ça, une reprise sur une journée déjà
   * couverte par AquaPro doublerait le chiffre d’affaires.
   */
  ventesExistantes: RepriseSourceTotal[];
};

export type RepriseSaveInput = {
  date: string;
  ventesZogbo?: RepriseVenteZogboLine[];
  /** Utiliser le journal détaillé pour le CA Zogbo (sinon calcul depuis les compteurs). */
  utiliserJournalDetaille?: boolean;
  zogbo: ZogboLine[];
  gbegameyTransfer: GbegameyTransferLine[];
  gbegameyLocal: GbegameyLocalLine[];
  boissons: BoissonsLine[];
  combos: CombosLine[];
  /** Régénérer le journal des ventes depuis les quantités vendues saisies. */
  genererVentes: boolean;
  /** Clôturer les journées reprises (elles ne seront plus modifiées au quotidien). */
  cloturer?: boolean;
};

export type RepriseSaveResult = {
  date: string;
  ventesGenerees: number;
  ventesSupprimees: number;
  caZogbo: number;
  caGbegamey: number;
};

function isValidDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

function numQty(value: unknown): number {
  return Math.max(0, Number(value) || 0);
}

/** Date métier du Bénin (UTC+1) — le passé se juge sur l’heure locale. */
export function todayPortoNovo(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Porto-Novo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function ventesExistantesFor(date: string): Promise<RepriseSourceTotal[]> {
  const db = await getDb();
  const rows = await db
    .collection("ventes_log")
    .aggregate<{ _id: string | null; lignes: number; montant: number }>([
      { $match: { date, cancelledAt: null, caExcluded: { $ne: true } } },
      {
        $group: {
          _id: "$source",
          lignes: { $sum: 1 },
          montant: { $sum: "$amount" },
        },
      },
      { $sort: { _id: 1 } },
    ])
    .toArray();

  return rows.map((r) => ({
    // Les ventes encaissées dans l’application ne portent pas de `source`.
    source: r._id ?? "caisse",
    lignes: r.lignes,
    montant: r.montant,
  }));
}

function slugProductId(name: string): string {
  return `extra-${name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40)}`;
}

async function ventesZogboFromLog(date: string): Promise<{
  reprise: RepriseVenteZogboLine[];
  autres: RepriseVenteZogboExistante[];
}> {
  const db = await getDb();
  const docs = await db
    .collection<{
      _id: ObjectId;
      kind: VenteKind;
      productId?: string;
      name: string;
      qty: number;
      unitPrice: number;
      source?: string | null;
    }>("ventes_log")
    .find({
      date,
      site: "zogbo",
      cancelledAt: null,
      caExcluded: { $ne: true },
    })
    .sort({ at: 1 })
    .toArray();

  const reprise: RepriseVenteZogboLine[] = [];
  const autres: RepriseVenteZogboExistante[] = [];

  for (const d of docs) {
    const line = {
      id: d._id.toHexString(),
      kind: d.kind,
      productId: d.productId ?? slugProductId(d.name),
      name: d.name,
      qty: d.qty,
      unitPrice: d.unitPrice,
    };
    const src = d.source ?? "caisse";
    if (src === REPRISE_SOURCE) {
      reprise.push(line);
    } else {
      autres.push({ ...line, source: src });
    }
  }

  return { reprise, autres };
}

export async function getRepriseDayPayload(
  date: string,
): Promise<RepriseDayPayload> {
  if (!isValidDate(date)) {
    throw new Error("Date invalide (attendu YYYY-MM-DD)");
  }

  const [zogbo, gbegamey, boissons, combos, ventesExistantes, ventesLog, parametres] =
    await Promise.all([
      getZogboDayPayload(date),
      getGbegameyDayPayload(date),
      getBoissonsDayPayload(date),
      getCombosDayPayload(date),
      ventesExistantesFor(date),
      ventesZogboFromLog(date),
      getParametres(),
    ]);

  const catalog: RepriseCatalogItem[] = [
    ...parametres.baseDishes.map((d) => ({
      id: d.id,
      name: d.name,
      kind: "plat" as const,
      unitPrice: Number(d.unitPrice) || 0,
    })),
    ...parametres.combos.map((c) => ({
      id: c.id,
      name: c.name,
      kind: "combo" as const,
      unitPrice: Number(c.unitPrice) || 0,
    })),
    ...parametres.drinks
      .filter((d) => d.salePrice !== null && d.salePrice !== undefined)
      .map((d) => ({
        id: d.id,
        name: d.name,
        kind: "boisson" as const,
        unitPrice: Number(d.salePrice) || 0,
      })),
  ];

  return {
    date,
    editable: date < todayPortoNovo(),
    catalog,
    ventesZogbo: ventesLog.reprise,
    ventesAutresZogbo: ventesLog.autres,
    zogbo: zogbo.day.lines,
    gbegameyTransfer: gbegamey.day.transferLines,
    gbegameyLocal: gbegamey.day.localLines,
    boissons: boissons.day.lines,
    combos: combos.day.lines,
    ventesExistantes,
  };
}

type VenteDoc = {
  _id: ObjectId;
  date: string;
  site: "zogbo" | "gbegamey";
  kind: VenteKind;
  productId: string;
  name: string;
  qty: number;
  unitPrice: number;
  costPrice: number;
  amount: number;
  at: string;
  cancelledAt: null;
  caExcluded: false;
  shift: null;
  source: string;
};

/**
 * Ventes réparties sur la journée de service (10 h → 22 h). L’heure exacte est
 * perdue pour du passé ressaisi : on l’étale plutôt que de tout empiler à
 * minuit, ce qui fausserait les analyses par tranche horaire.
 */
function spreadClock(count: number): (index: number) => string {
  const start = 10 * 60;
  const end = 22 * 60;
  const step = count > 1 ? (end - start) / (count - 1) : 0;
  return (index) => {
    const minutes = Math.round(start + step * index);
    const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
    const mm = String(minutes % 60).padStart(2, "0");
    return `${hh}:${mm}`;
  };
}

export async function saveRepriseDay(
  input: RepriseSaveInput,
): Promise<RepriseSaveResult> {
  if (!isValidDate(input.date)) {
    throw new Error("Date invalide (attendu YYYY-MM-DD)");
  }
  if (input.date >= todayPortoNovo()) {
    throw new Error(
      "La reprise ne concerne que les journées passées. Utilisez les écrans du quotidien pour aujourd’hui.",
    );
  }

  const status = input.cloturer ? "cloturee" : "ouverte";
  const repriseOpts = { lockSold: false, directWrite: true } as const;

  await saveZogboDay(
    { date: input.date, status, lines: input.zogbo, movements: [] },
    repriseOpts,
  );
  await saveGbegameyDay(
    {
      date: input.date,
      status,
      transferLines: input.gbegameyTransfer,
      localLines: input.gbegameyLocal,
    },
    repriseOpts,
  );
  await saveBoissonsDay(
    { date: input.date, status, lines: input.boissons },
    repriseOpts,
  );
  await saveCombosDay(
    { date: input.date, status, lines: input.combos },
    repriseOpts,
  );

  const db = await getDb();

  // Ne remplace que les lignes « reprise » — carnet, AquaPro et caisse sont conservés.
  let ventesSupprimees = 0;
  if (input.genererVentes) {
    const useJournal =
      input.utiliserJournalDetaille !== false &&
      (input.ventesZogbo?.length ?? 0) > 0;

    const filter: Record<string, unknown> = {
      date: input.date,
      source: REPRISE_SOURCE,
    };
    if (useJournal) {
      filter.site = "zogbo";
    }

    const previous = await db.collection("ventes_log").deleteMany(filter);
    ventesSupprimees = previous.deletedCount;
  }

  if (!input.genererVentes) {
    return {
      date: input.date,
      ventesGenerees: 0,
      ventesSupprimees,
      caZogbo: 0,
      caGbegamey: 0,
    };
  }

  const useJournal =
    input.utiliserJournalDetaille !== false &&
    (input.ventesZogbo?.length ?? 0) > 0;

  let zogboDocs: VenteDoc[] = [];

  if (useJournal && input.ventesZogbo) {
    const clockAt = spreadClock(input.ventesZogbo.length);
    zogboDocs = input.ventesZogbo
      .filter((l) => l.name.trim() && numQty(l.qty) > 0)
      .map((l, index) => {
        const qty = numQty(l.qty);
        const unitPrice = Math.max(0, Number(l.unitPrice) || 0);
        const productId =
          l.productId.trim() ||
          (l.kind === "extra" ? slugProductId(l.name) : slugProductId(l.name));
        return {
          _id: new ObjectId(),
          date: input.date,
          site: "zogbo" as const,
          kind: l.kind,
          productId,
          name: l.name.trim(),
          qty,
          unitPrice,
          costPrice: 0,
          amount: qty * unitPrice,
          at: `${input.date}T${clockAt(index)}:00.000+01:00`,
          cancelledAt: null,
          caExcluded: false,
          shift: null,
          source: REPRISE_SOURCE,
        };
      });
  }

  const { baseDishes, localDishes, combos, drinks } = await getParametres();
  const priceOf = new Map<string, { unit: number; cost: number; name: string }>();
  for (const d of baseDishes) {
    priceOf.set(d.id, { unit: Number(d.unitPrice) || 0, cost: 0, name: d.name });
  }
  for (const d of localDishes) {
    priceOf.set(d.id, { unit: Number(d.unitPrice) || 0, cost: 0, name: d.name });
  }
  for (const c of combos) {
    priceOf.set(c.id, { unit: Number(c.unitPrice) || 0, cost: 0, name: c.name });
  }
  for (const d of drinks) {
    priceOf.set(d.id, {
      unit: Number(d.salePrice) || 0,
      cost: Number(d.purchasePrice) || 0,
      name: d.name,
    });
  }

  type Pending = {
    site: VenteDoc["site"];
    kind: VenteDoc["kind"];
    productId: string;
    fallbackName: string;
    qty: number;
  };
  const pending: Pending[] = [];

  const push = (
    site: VenteDoc["site"],
    kind: VenteDoc["kind"],
    productId: string,
    fallbackName: string,
    qty: unknown,
  ) => {
    const n = Math.max(0, Number(qty) || 0);
    if (n > 0) pending.push({ site, kind, productId, fallbackName, qty: n });
  };

  for (const l of input.zogbo) {
    if (!useJournal) push("zogbo", "plat", l.productId, l.name, l.sold);
  }
  for (const l of input.gbegameyTransfer) {
    push("gbegamey", "plat", l.productId, l.name, l.sold);
  }
  for (const l of input.gbegameyLocal) {
    push("gbegamey", "local", l.productId, l.name, l.sold);
  }
  for (const l of input.combos) {
    if (!useJournal) {
      push("zogbo", "combo", l.productId, l.name, l.soldZogbo);
    }
    push("gbegamey", "combo", l.productId, l.name, l.soldGbegamey);
  }
  for (const l of input.boissons) {
    if (!useJournal) {
      push("zogbo", "boisson", l.productId, l.name, l.soldZogbo);
    }
    push("gbegamey", "boisson", l.productId, l.name, l.soldGbegamey);
  }

  const clockAt = spreadClock(pending.length);
  const autoDocs: VenteDoc[] = pending.map((p, index) => {
    const price = priceOf.get(p.productId);
    const unitPrice = price?.unit ?? 0;
    const costPrice = price?.cost ?? 0;
    return {
      _id: new ObjectId(),
      date: input.date,
      site: p.site,
      kind: p.kind,
      productId: p.productId,
      name: price?.name ?? p.fallbackName,
      qty: p.qty,
      unitPrice,
      costPrice,
      amount: p.qty * unitPrice,
      at: `${input.date}T${clockAt(index)}:00.000+01:00`,
      cancelledAt: null,
      caExcluded: false,
      // Le passé n’a pas d’équipe identifiable : « hors équipe » plutôt qu’une
      // attribution arbitraire qui fausserait le suivi par équipe.
      shift: null,
      source: REPRISE_SOURCE,
    };
  });

  const docs = [...zogboDocs, ...autoDocs];

  if (docs.length) {
    await db.collection("ventes_log").insertMany(docs);
  }

  let caZogbo = 0;
  let caGbegamey = 0;
  for (const d of docs) {
    if (d.site === "zogbo") caZogbo += d.amount;
    else caGbegamey += d.amount;
  }

  return {
    date: input.date,
    ventesGenerees: docs.length,
    ventesSupprimees,
    caZogbo,
    caGbegamey,
  };
}
