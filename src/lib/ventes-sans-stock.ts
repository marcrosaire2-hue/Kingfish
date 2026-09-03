import { getDb } from "@/lib/mongodb";
import type { VenteSite } from "@/lib/types";
import { getGbegameyDayPayload } from "@/lib/gbegamey-repo";
import { getZogboDayPayload } from "@/lib/zogbo-repo";

export function dayVentesSansStock(
  day: { ventesSansStock?: boolean } | null | undefined,
): boolean {
  return day?.ventesSansStock === true;
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
    { _id: date as never, ventesSansStock: true },
    {
      $set: {
        ventesSansStock: false,
        updatedAt: new Date().toISOString(),
      },
    },
  );
}

export function mergeVentesSansStockOnSave(input: {
  stockSaisie?: boolean;
  existing?: { ventesSansStock?: boolean } | null;
}): boolean {
  if (input.stockSaisie) return false;
  return input.existing?.ventesSansStock === true;
}
