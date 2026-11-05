import { getDb } from "@/lib/mongodb";
import type { VenteSite } from "@/lib/types";

/**
 * Stock initial par site et produit : première entrée de stock, puis dernier
 * comptage connu à la date consultée. Un comptage ne réécrit pas le passé.
 * Boissons : en bouteilles. Plats et accompagnements : en portions.
 */
export type StockSiKind = "plat" | "local" | "boisson";

type StockSiDoc = {
  _id: string;
  site: VenteSite;
  kind: StockSiKind;
  productId: string;
  si: number;
  date: string;
  at: string;
};

type LegacyZogboStockLine = {
  productId: string;
  stock?: number;
  prepared?: number;
  initialStock?: number;
  initialStockZogbo?: number;
  counted?: number | null;
  countedZogbo?: number | null;
};

type LegacyZogboStockDay = {
  _id: string;
  lines?: LegacyZogboStockLine[];
  accompanimentLines?: LegacyZogboStockLine[];
  beverageLines?: LegacyZogboStockLine[];
};

type StockSiProduct = {
  kind: StockSiKind;
  productId: string;
  unitsPerCasier?: number;
};

export const ZOGBO_INITIAL_STOCK_START_DATE = "2026-10-31";

type StockInitialCount = {
  kind: StockSiKind;
  productId: string;
  qty: number;
  date: string;
};

function cle(site: VenteSite, kind: StockSiKind, productId: string): string {
  return `${site}:${kind}:${productId}`;
}

export function resolveStocksInitiauxAsOf(
  stocks: StockSiDoc[],
  counts: StockInitialCount[],
  date: string,
): Map<string, number> {
  const starts = new Map<string, string>();
  const result = new Map<string, number>();

  for (const stock of stocks) {
    const key = `${stock.kind}:${stock.productId}`;
    starts.set(key, stock.date);
    if (stock.date <= date && stock.date >= ZOGBO_INITIAL_STOCK_START_DATE) {
      result.set(key, Math.max(0, Number(stock.si) || 0));
    }
  }

  const latestCounts = new Map<string, StockInitialCount>();
  for (const count of counts) {
    if (count.date < ZOGBO_INITIAL_STOCK_START_DATE || count.date > date) continue;
    const key = `${count.kind}:${count.productId}`;
    const current = latestCounts.get(key);
    if (!current || count.date > current.date) latestCounts.set(key, count);
  }

  for (const [key, count] of latestCounts) {
    const startDate = starts.get(key);
    if (!startDate || count.date >= startDate) {
      result.set(key, Math.max(0, Number(count.qty) || 0));
    }
  }
  return result;
}

export function inferLegacyZogboStockInitials(
  days: LegacyZogboStockDay[],
  products: StockSiProduct[],
): Array<StockSiProduct & { si: number; date: string }> {
  const wanted = new Set(
    products.map(({ kind, productId }) => `${kind}:${productId}`),
  );
  const inferred = new Map<
    string,
    StockSiProduct & { si: number; date: string }
  >();

  for (const day of [...days].sort((a, b) => a._id.localeCompare(b._id))) {
    for (const line of day.lines ?? []) {
      const key = `plat:${line.productId}`;
      const initialStock = Math.max(0, Number(line.initialStock) || 0);
      const prepared = Math.max(0, Number(line.prepared) || 0);
      const si = initialStock || prepared || Math.max(0, Number(line.stock) || 0);
      if (wanted.has(key) && si > 0 && !inferred.has(key)) {
        inferred.set(key, {
          kind: "plat",
          productId: line.productId,
          si,
          date: day._id,
        });
      }
    }
    for (const line of day.accompanimentLines ?? []) {
      const key = `local:${line.productId}`;
      const prepared = Math.max(0, Number(line.prepared) || 0);
      const si = prepared || Math.max(0, Number(line.initialStock) || 0);
      if (wanted.has(key) && si > 0 && !inferred.has(key)) {
        inferred.set(key, {
          kind: "local",
          productId: line.productId,
          si,
          date: day._id,
        });
      }
    }
    for (const line of day.beverageLines ?? []) {
      const key = `boisson:${line.productId}`;
      const si = Math.max(0, Number(line.initialStockZogbo) || 0);
      const unitsPerCasier =
        products.find((product) => product.productId === line.productId)
          ?.unitsPerCasier ?? 1;
      if (wanted.has(key) && si > 0 && !inferred.has(key)) {
        inferred.set(key, {
          kind: "boisson",
          productId: line.productId,
          si: Math.round(si * unitsPerCasier),
          date: ZOGBO_INITIAL_STOCK_START_DATE,
        });
      }
    }
  }
  return [...inferred.values()];
}

/** Enregistre la première entrée de stock pour préserver sa date d'origine. */
export async function noterStockInitial(input: {
  site: VenteSite;
  kind: StockSiKind;
  productId: string;
  qty: number;
  date: string;
}): Promise<void> {
  const qty = Math.max(0, Number(input.qty) || 0);
  if (qty <= 0 || !input.productId) return;
  const db = await getDb();
  await db.collection<StockSiDoc>("stock_si").updateOne(
    { _id: cle(input.site, input.kind, input.productId) },
    {
      $setOnInsert: {
        site: input.site,
        kind: input.kind,
        productId: input.productId,
        si: qty,
        date: input.date,
        at: new Date().toISOString(),
      },
    },
    { upsert: true },
  );
}

/** SI fixes d'un site, indexés par `kind:productId`. */
export async function lireStocksInitiaux(
  site: VenteSite,
  products: StockSiProduct[] = [],
  date?: string,
): Promise<Map<string, number>> {
  const db = await getDb();
  const col = db.collection<StockSiDoc>("stock_si");
  let docs = await col.find({ site }).toArray();

  if (site === "zogbo" && products.length > 0) {
    const existing = new Map(
      docs.map((doc) => [`${doc.kind}:${doc.productId}`, doc]),
    );
    const missing = products.filter(
      ({ kind, productId }) =>
        !(Number(existing.get(`${kind}:${productId}`)?.si) > 0),
    );
    if (missing.length > 0) {
      const platIds = missing
        .filter((product) => product.kind === "plat")
        .map((product) => product.productId);
      const localIds = missing
        .filter((product) => product.kind === "local")
        .map((product) => product.productId);
      const beverageIds = missing
        .filter((product) => product.kind === "boisson")
        .map((product) => product.productId);
      const filters = [];
      if (platIds.length > 0) {
        filters.push({
          lines: { $elemMatch: { productId: { $in: platIds } } },
        });
      }
      if (localIds.length > 0) {
        filters.push({
          accompanimentLines: {
            $elemMatch: { productId: { $in: localIds } },
          },
        });
      }
      const zogboDays =
        filters.length > 0
          ? await db
              .collection<LegacyZogboStockDay>("zogbo_jours")
              .find({ $or: filters })
              .sort({ _id: 1 })
              .toArray()
          : [];
      const beverageDays =
        beverageIds.length > 0
          ? await db
              .collection<{
                _id: string;
                lines?: LegacyZogboStockLine[];
              }>("boissons_jours")
              .find({
                lines: {
                  $elemMatch: { productId: { $in: beverageIds } },
                },
              })
              .sort({ _id: 1 })
              .toArray()
          : [];
      const days = [
        ...zogboDays,
        ...beverageDays.map((day) => ({
          _id: day._id,
          beverageLines: day.lines,
        })),
      ];
      const inferred = inferLegacyZogboStockInitials(days, missing);
      if (inferred.length > 0) {
        const now = new Date().toISOString();
        await Promise.all(
          inferred.map((item) => {
            const existingDoc = existing.get(`${item.kind}:${item.productId}`);
            if (existingDoc) {
              return col.updateOne(
                { _id: existingDoc._id, si: { $lte: 0 } },
                {
                  $set: { si: item.si, date: item.date, at: now },
                },
              );
            }
            return col.updateOne(
              { _id: cle(site, item.kind, item.productId) },
              {
                $setOnInsert: {
                  site,
                  kind: item.kind,
                  productId: item.productId,
                  si: item.si,
                  date: item.date,
                  at: now,
                },
              },
              { upsert: true },
            );
          }),
        );
        docs = await col.find({ site }).toArray();
      }
    }
  }

  if (site !== "zogbo" || !date) {
    return new Map(
      docs.map((d) => [`${d.kind}:${d.productId}`, Number(d.si) || 0]),
    );
  }

  const counts: StockInitialCount[] = [];
  const platIds = products
    .filter((product) => product.kind === "plat")
    .map((product) => product.productId);
  const localIds = products
    .filter((product) => product.kind === "local")
    .map((product) => product.productId);
  const beverageIds = products
    .filter((product) => product.kind === "boisson")
    .map((product) => product.productId);

  if (platIds.length > 0 || localIds.length > 0) {
    const filters = [];
    if (platIds.length > 0) {
      filters.push({
        lines: { $elemMatch: { productId: { $in: platIds } } },
      });
    }
    if (localIds.length > 0) {
      filters.push({
        accompanimentLines: {
          $elemMatch: { productId: { $in: localIds } },
        },
      });
    }
    const days = await db
      .collection<LegacyZogboStockDay>("zogbo_jours")
      .find({ _id: { $gte: ZOGBO_INITIAL_STOCK_START_DATE, $lte: date }, $or: filters })
      .sort({ _id: -1 })
      .toArray();
    const found = new Set<string>();
    for (const day of days) {
      for (const line of day.lines ?? []) {
        const key = `plat:${line.productId}`;
        if (
          platIds.includes(line.productId) &&
          line.counted !== null &&
          line.counted !== undefined &&
          !found.has(key)
        ) {
          counts.push({
            kind: "plat",
            productId: line.productId,
            qty: Number(line.counted) || 0,
            date: day._id,
          });
          found.add(key);
        }
      }
      for (const line of day.accompanimentLines ?? []) {
        const key = `local:${line.productId}`;
        if (
          localIds.includes(line.productId) &&
          line.counted !== null &&
          line.counted !== undefined &&
          !found.has(key)
        ) {
          counts.push({
            kind: "local",
            productId: line.productId,
            qty: Number(line.counted) || 0,
            date: day._id,
          });
          found.add(key);
        }
      }
    }
  }

  if (beverageIds.length > 0) {
    const days = await db
      .collection<{
        _id: string;
        lines?: LegacyZogboStockLine[];
      }>("boissons_jours")
      .find({
        _id: { $gte: ZOGBO_INITIAL_STOCK_START_DATE, $lte: date },
        lines: { $elemMatch: { productId: { $in: beverageIds } } },
      })
      .sort({ _id: -1 })
      .toArray();
    const found = new Set<string>();
    for (const day of days) {
      for (const line of day.lines ?? []) {
        if (
          beverageIds.includes(line.productId) &&
          line.countedZogbo !== null &&
          line.countedZogbo !== undefined &&
          !found.has(line.productId)
        ) {
          counts.push({
            kind: "boisson",
            productId: line.productId,
            qty: Number(line.countedZogbo) || 0,
            date: day._id,
          });
          found.add(line.productId);
        }
      }
    }
  }

  return resolveStocksInitiauxAsOf(docs, counts, date);
}

/** Date de la première saisie (SI) de chaque produit d'un site, par `kind:productId`. */
export async function lireDatesStocksInitiaux(
  site: VenteSite,
): Promise<Map<string, string>> {
  const db = await getDb();
  const docs = await db.collection<StockSiDoc>("stock_si").find({ site }).toArray();
  return new Map(docs.map((d) => [`${d.kind}:${d.productId}`, d.date]));
}


/** SI enregistrés d'un site (valeur et date de la première saisie), par `kind:productId`. */
export async function lireStocksInitiauxBruts(
  site: VenteSite,
): Promise<Map<string, { si: number; date: string }>> {
  const db = await getDb();
  const docs = await db.collection<StockSiDoc>("stock_si").find({ site }).toArray();
  return new Map(
    docs.map((d) => [`${d.kind}:${d.productId}`, { si: Math.max(0, Number(d.si) || 0), date: d.date }]),
  );
}

/**
 * Lecture « depuis le début » avec comptages : on part du SI ; chaque
 * comptage (stock réel) d'une journée antérieure devient le nouveau stock
 * initial, et les ventes se cumulent à partir du lendemain de ce comptage.
 * Le comptage du jour consulté, lui, reste le stock physique (écart).
 */
export function stockInitialDepuisComptages(input: {
  si: number;
  siDate: string;
  date: string;
  jours: Array<{ date: string; vendus: number; pertes: number; compte: number | null }>;
}): { stockInitial: number; depuis: string; vendus: number; pertes: number } {
  const jours = [...input.jours]
    .filter((j) => j.date >= input.siDate && j.date <= input.date)
    .sort((a, b) => a.date.localeCompare(b.date));
  let stockInitial = input.si;
  let depuis = input.siDate;
  let vendus = 0;
  let pertes = 0;
  for (const j of jours) {
    vendus += j.vendus;
    pertes += j.pertes;
    if (j.compte !== null && j.date < input.date) {
      // Le stock réel compté ce jour devient le stock initial ; on repart
      // de zéro vente à partir du lendemain.
      stockInitial = j.compte;
      depuis = j.date;
      vendus = 0;
      pertes = 0;
    }
  }
  return { stockInitial, depuis, vendus, pertes };
}
