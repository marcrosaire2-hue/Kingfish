import { AsyncLocalStorage } from "node:async_hooks";
import { updateDayDocument } from "@/lib/day-doc";
import { getDb } from "@/lib/mongodb";
import {
  applyBoissonsCarryToDay,
  boissonsLeftoverDelta,
  isEmptyBoissonsDelta,
  leftoverFromBoissonsLines,
  type BoissonsLeftover,
} from "@/lib/boissons-calc";
import {
  leftoverFromLocalLines,
  leftoverFromTransferLines,
} from "@/lib/gbegamey-calc";
import {
  LEFTOVER_LOOKBACK_DAYS,
  leftoverFromZogboLines,
  shiftIsoDate,
} from "@/lib/zogbo-calc";
import { applyOpeningCarry, leftoverDelta } from "@/lib/stock-carry-calc";
import { withStockLock } from "@/lib/stock-lock";
import { getBoissonsDayPayload } from "@/lib/boissons-repo";
import { getZogboDayPayload } from "@/lib/zogbo-repo";
import { getGbegameyDayPayload } from "@/lib/gbegamey-repo";
import {
  assurerSeparationSites,
  COLLECTION_BOISSONS,
} from "@/lib/site-collections";
import type { VenteSite } from "@/lib/types";

/**
 * Report des corrections de stock vers les journées suivantes.
 *
 * L'ouverture de chaque journée (plats, accompagnements, boissons) est figée
 * à sa création, à partir du reste de la veille. Une vente, une perte, un
 * achat ou un comptage saisi après coup sur un jour passé change ce reste,
 * mais l'ouverture des jours suivants ne bougeait pas : le stock restait
 * faux jusqu'au prochain comptage. On mesure l'écart de reste produit par
 * l'écriture et on l'ajoute à l'ouverture des journées suivantes.
 */
export type BoissonsCarryScope = "boissons-zogbo" | "boissons-gbegamey";
export type StockCarryScope = BoissonsCarryScope | "zogbo" | "gbegamey";

export function boissonsScope(site: VenteSite): BoissonsCarryScope {
  return site === "zogbo" ? "boissons-zogbo" : "boissons-gbegamey";
}

const COLLECTION: Record<StockCarryScope, string> = {
  "boissons-zogbo": COLLECTION_BOISSONS.zogbo,
  "boissons-gbegamey": COLLECTION_BOISSONS.gbegamey,
  zogbo: "zogbo_jours",
  gbegamey: "gbegamey_jours",
};

/** Plats / accompagnements : un écart par tableau de lignes. */
type DishDelta = Record<string, Map<string, number>>;

type Snapshot =
  | { scope: "boissons"; leftover: BoissonsLeftover }
  | { scope: "zogbo" | "gbegamey"; leftover: DishDelta };

/** Champ d'ouverture de chaque tableau de lignes. */
const DISH_ARRAYS: Record<"zogbo" | "gbegamey", Record<string, string>> = {
  // Plat Zogbo : l'ouverture est fondue dans `stock` (ouverture + préparé − envoyé).
  zogbo: { lines: "stock", accompanimentLines: "initialStock" },
  gbegamey: { transferLines: "initialStock" },
};

const carryContext = new AsyncLocalStorage<Set<string>>();
const carryLocks = new Map<string, Promise<unknown>>();

async function snapshot(
  scope: StockCarryScope,
  date: string,
): Promise<Snapshot> {
  if (scope === "boissons-zogbo" || scope === "boissons-gbegamey") {
    const site: VenteSite = scope === "boissons-zogbo" ? "zogbo" : "gbegamey";
    const { day, drinks } = await getBoissonsDayPayload(date, site);
    return {
      scope: "boissons",
      leftover: leftoverFromBoissonsLines(day.lines, drinks),
    };
  }
  if (scope === "zogbo") {
    const { day } = await getZogboDayPayload(date);
    return {
      scope,
      leftover: {
        lines: leftoverFromZogboLines(day.lines),
        accompanimentLines: leftoverFromLocalLines(
          day.accompanimentLines ?? [],
        ),
      },
    };
  }
  const { day } = await getGbegameyDayPayload(date);
  return {
    scope,
    leftover: {
      transferLines: leftoverFromTransferLines(day.transferLines),
    },
  };
}

/**
 * Exécute `write` (une écriture sur la journée `date` du périmètre `scope`)
 * puis reporte l'écart de reste sur les journées suivantes déjà ouvertes.
 * Sans journée postérieure, l'écriture passe telle quelle.
 */
export async function withStockCarry<T>(
  scope: StockCarryScope,
  date: string,
  write: () => Promise<T>,
): Promise<T> {
  await assurerSeparationSites();
  const key = `${scope}:${date}`;
  const active = carryContext.getStore();
  // Écriture imbriquée (ex. `ensure` d'une vente) : le report est déjà
  // mesuré par l'appel englobant.
  if (active?.has(key)) return write();

  const db = await getDb();
  const hasLater = await db
    .collection<{ _id: string }>(COLLECTION[scope])
    .findOne({ _id: { $gt: date } }, { projection: { _id: 1 } });
  if (!hasLater) return write();

  // Une écriture avec report à la fois par journée : le verrou mémoire
  // sérialise les appels du processus, le verrou Mongo sérialise les
  // instances (Render / serverless) qui partagent la même base.
  const previous = carryLocks.get(key) ?? Promise.resolve();
  const run = previous
    .catch(() => undefined)
    .then(() =>
      carryContext.run(new Set([...(active ?? []), key]), () =>
        withStockLock(`stock-carry:${key}`, async () => {
          const before = await snapshot(scope, date);
          const result = await write();
          const after = await snapshot(scope, date);
          await carryForward(scope, date, before, after);
          return result;
        }),
      ),
    );
  carryLocks.set(key, run);
  try {
    return await run;
  } finally {
    if (carryLocks.get(key) === run) carryLocks.delete(key);
  }
}

type AnyDayDoc = { _id: string; rev?: number } & Record<string, unknown>;

async function carryForward(
  scope: StockCarryScope,
  date: string,
  before: Snapshot,
  after: Snapshot,
): Promise<void> {
  if (before.scope === "boissons" && after.scope === "boissons") {
    const delta = boissonsLeftoverDelta(before.leftover, after.leftover);
    if (isEmptyBoissonsDelta(delta)) return;
    await walkLaterDays<BoissonsLeftover>(scope, date, delta, {
      isEmpty: isEmptyBoissonsDelta,
      // Boissons : pas de fenêtre de report (stock non périssable).
      maxGapDays: null,
      apply: (doc, carry) => {
        const applied = applyBoissonsCarryToDay(
          (doc.lines as never[] | undefined) ?? [],
          carry,
        );
        return {
          set: applied.changed ? { lines: applied.lines } : null,
          next: applied.next,
        };
      },
    });
    return;
  }
  if (before.scope === "boissons" || after.scope === "boissons") return;

  const arrays = DISH_ARRAYS[before.scope];
  const delta: DishDelta = {};
  for (const field of Object.keys(arrays)) {
    const d = leftoverDelta(
      before.leftover[field] ?? new Map(),
      after.leftover[field] ?? new Map(),
    );
    if (d.size > 0) delta[field] = d;
  }
  const isEmpty = (d: DishDelta) =>
    Object.values(d).every((m) => m.size === 0);
  if (isEmpty(delta)) return;

  await walkLaterDays<DishDelta>(scope, date, delta, {
    isEmpty,
    // Plats périssables : au-delà de la fenêtre, le reste n'est pas repris.
    maxGapDays: LEFTOVER_LOOKBACK_DAYS,
    apply: (doc, carry) => {
      const set: Record<string, unknown> = {};
      const next: DishDelta = {};
      for (const [field, d] of Object.entries(carry)) {
        const lines = (doc[field] as never[] | undefined) ?? [];
        const applied = applyOpeningCarry<{
          productId: string;
          counted?: number | null;
        }>(lines, d, arrays[field]!);
        next[field] = applied.next;
        if (applied.changed) set[field] = applied.lines;
      }
      return { set: Object.keys(set).length > 0 ? set : null, next };
    },
  });
}

async function walkLaterDays<D>(
  scope: StockCarryScope,
  date: string,
  delta: D,
  options: {
    isEmpty: (d: D) => boolean;
    maxGapDays: number | null;
    apply: (
      doc: AnyDayDoc,
      carry: D,
    ) => { set: Record<string, unknown> | null; next: D };
  },
): Promise<void> {
  const db = await getDb();
  const col = db.collection<AnyDayDoc>(COLLECTION[scope]);
  const later = await col
    .find({ _id: { $gt: date } }, { projection: { _id: 1 } })
    .sort({ _id: 1 })
    .toArray();

  let pending = delta;
  let previousDate = date;
  for (const { _id } of later) {
    if (options.isEmpty(pending)) break;
    if (options.maxGapDays !== null) {
      const limit = shiftIsoDate(previousDate, options.maxGapDays);
      if (!limit || _id > limit) break;
    }
    previousDate = _id;
    const carry = pending;
    const current = await col.findOne({ _id });
    if (!current) continue;
    const preview = options.apply(current, carry);
    if (!preview.set) {
      pending = preview.next;
      continue;
    }
    pending = await updateDayDocument<AnyDayDoc, D>(
      COLLECTION[scope],
      _id,
      async (existing) => {
        const applied = options.apply(existing ?? current, carry);
        return {
          set: {
            ...(applied.set ?? {}),
            updatedAt: new Date().toISOString(),
          },
          result: applied.next,
        };
      },
    );
  }
}
