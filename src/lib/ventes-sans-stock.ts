import { getDb } from "@/lib/mongodb";
import type { VenteSite } from "@/lib/types";
import { getGbegameyDayPayload } from "@/lib/gbegamey-repo";
import { getZogboDayPayload } from "@/lib/zogbo-repo";

/**
 * Vente libre (articles dégrisés) ?
 * Par défaut oui — seul un `ventesSansStock: false` explicite plaque les ventes au stock.
 */
export function dayVentesSansStock(
  day: { ventesSansStock?: boolean } | null | undefined,
  /** Valeur quand le jour n'a pas de réglage explicite (vente libre par défaut). */
  fallback = true,
): boolean {
  return typeof day?.ventesSansStock === "boolean"
    ? day.ventesSansStock
    : fallback;
}

export async function isVentesSansStockActive(
  date: string,
  site: VenteSite,
): Promise<boolean> {
  if (site === "zogbo") {
    const { day } = await getZogboDayPayload(date);
    return dayVentesSansStock(day);
  }
  const { day } = await getGbegameyDayPayload(date);
  return dayVentesSansStock(day);
}

export async function getVentesSansStockStatus(date: string): Promise<{
  date: string;
  zogbo: boolean;
  gbegamey: boolean;
}> {
  const [zogbo, gbegamey] = await Promise.all([
    getZogboDayPayload(date),
    getGbegameyDayPayload(date),
  ]);
  return {
    date,
    zogbo: dayVentesSansStock(zogbo.day),
    gbegamey: dayVentesSansStock(gbegamey.day),
  };
}

/**
 * Boissons vendues selon le stock même quand le reste du site est en vente
 * libre (Gbégamey). Le réglage du dernier jour qui en porte un s'applique
 * jusqu'à décision inverse.
 */
export function boissonsLibres(
  ventesSansStock: boolean,
  boissonsSelonStock: boolean,
): boolean {
  return ventesSansStock && !boissonsSelonStock;
}

export async function isBoissonsSelonStock(
  date: string,
  site: VenteSite,
): Promise<boolean> {
  if (site !== "gbegamey") return false;
  const db = await getDb();
  const doc = await db
    .collection<{ _id: string; boissonsSelonStock?: boolean }>("gbegamey_jours")
    .find(
      { _id: { $lte: date }, boissonsSelonStock: { $type: "bool" } },
      { projection: { boissonsSelonStock: 1 } },
    )
    .sort({ _id: -1 })
    .limit(1)
    .next();
  return doc?.boissonsSelonStock === true;
}

export async function setBoissonsSelonStock(
  date: string,
  site: VenteSite,
  actif: boolean,
): Promise<void> {
  if (site !== "gbegamey") {
    throw new Error("Réglage des boissons disponible à Gbégamey uniquement.");
  }
  const db = await getDb();
  await db.collection("gbegamey_jours").updateOne(
    { _id: date as never },
    {
      $set: {
        boissonsSelonStock: actif,
        updatedAt: new Date().toISOString(),
      },
      $setOnInsert: { status: "ouverte" },
    },
    { upsert: true },
  );
}

/** Active ou désactive la vente libre (hors stock) pour un site et une date. */
export async function setVentesSansStock(
  date: string,
  site: VenteSite,
  ventesSansStock: boolean,
): Promise<void> {
  const collection = site === "zogbo" ? "zogbo_jours" : "gbegamey_jours";
  const db = await getDb();
  const updatedAt = new Date().toISOString();
  await db.collection(collection).updateOne(
    { _id: date as never },
    {
      $set: {
        ventesSansStock,
        updatedAt,
        source: "admin-stock-policy",
      },
      $setOnInsert: { status: "ouverte" },
    },
    { upsert: true },
  );
}

/** Fin du mode vente libre après une saisie de stock. */
export async function endVentesSansStock(
  date: string,
  site: VenteSite,
): Promise<void> {
  const collection = site === "zogbo" ? "zogbo_jours" : "gbegamey_jours";
  const db = await getDb();
  await db.collection(collection).updateOne(
    { _id: date as never },
    {
      $set: {
        ventesSansStock: false,
        updatedAt: new Date().toISOString(),
      },
    },
    { upsert: true },
  );
}

/**
 * Après saisie de stock → ne plus basculer toute la journée.
 * Le suivi est produit × site (`stockTracked`). On conserve seulement
 * un forçage admin explicite (`ventesSansStock: false`).
 */
export function mergeVentesSansStockOnSave(input: {
  stockSaisie?: boolean;
  existing?: { ventesSansStock?: boolean } | null;
  fallback?: boolean;
}): boolean {
  void input.stockSaisie;
  return dayVentesSansStock(input.existing, input.fallback);
}
