import { getDb } from "@/lib/mongodb";
import type { VenteSite } from "@/lib/types";

/**
 * Stock initial (SI) fixe par site et par produit : la quantité de la toute
 * première saisie de stock du produit. Il ne bouge plus ensuite — les
 * saisies suivantes sont des entrées.
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

function cle(site: VenteSite, kind: StockSiKind, productId: string): string {
  return `${site}:${kind}:${productId}`;
}

/** Enregistre le SI à la première saisie ; sans effet ensuite. */
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
): Promise<Map<string, number>> {
  const db = await getDb();
  const docs = await db.collection<StockSiDoc>("stock_si").find({ site }).toArray();
  return new Map(docs.map((d) => [`${d.kind}:${d.productId}`, Number(d.si) || 0]));
}
