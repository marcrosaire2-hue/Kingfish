import { getDb } from "@/lib/mongodb";
import {
  cleProduitGrise,
  type KindGrisable,
} from "@/lib/produits-grises-calc";
import type { VenteKind, VenteSite } from "@/lib/types";
import { todayIsoDate } from "@/lib/zogbo-calc";

const COLLECTION = "produits_grises";

type ProduitGriseDoc = {
  _id: string;
  site: VenteSite;
  kind: KindGrisable;
  productId: string;
  name: string;
  at: string;
  byName: string;
};

/**
 * Articles grisés applicables à une date. Les jours passés restent exempts :
 * une régularisation doit pouvoir enregistrer une vente déjà faite.
 */
export async function produitsGrisesPourDate(
  site: VenteSite,
  date: string,
): Promise<Set<string>> {
  if (date < todayIsoDate()) return new Set();
  const db = await getDb();
  const docs = await db
    .collection<ProduitGriseDoc>(COLLECTION)
    .find({ site }, { projection: { _id: 1 } })
    .toArray();
  return new Set(docs.map((d) => d._id));
}

export async function assertProduitDisponible(input: {
  site: VenteSite;
  date: string;
  kind: VenteKind;
  productId: string;
}): Promise<void> {
  if (input.date < todayIsoDate()) return;
  const db = await getDb();
  const doc = await db
    .collection<ProduitGriseDoc>(COLLECTION)
    .findOne({ _id: cleProduitGrise(input.site, input.kind, input.productId) });
  if (doc) {
    throw new Error(`${doc.name} est indisponible : article grisé par l'administrateur.`);
  }
}

/** Grise ou rend disponible un article, jusqu'à la décision inverse. */
export async function definirProduitGrise(input: {
  site: VenteSite;
  kind: KindGrisable;
  productId: string;
  name: string;
  grise: boolean;
  byName: string;
}): Promise<void> {
  const db = await getDb();
  const col = db.collection<ProduitGriseDoc>(COLLECTION);
  const _id = cleProduitGrise(input.site, input.kind, input.productId);
  if (!input.grise) {
    await col.deleteOne({ _id });
    return;
  }
  await col.updateOne(
    { _id },
    {
      $set: {
        site: input.site,
        kind: input.kind,
        productId: input.productId,
        name: input.name,
        at: new Date().toISOString(),
        byName: input.byName,
      },
    },
    { upsert: true },
  );
}
