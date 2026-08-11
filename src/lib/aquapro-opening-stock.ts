import { getDb } from "@/lib/mongodb";
import type { Drink, RawMaterial } from "@/lib/types";

export function normKey(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

type AquaAliment = {
  _id: string;
  designation?: string;
  stock?: number;
};

type AquaInv = {
  date?: string | null;
  statut?: string | null;
  lignes?: Array<{
    designation?: string;
    quantite?: number;
  }>;
};

/** Stock matières AquaPro indexé par id `aqua-aliment-*` et par nom normalisé. */
export async function loadAquaAlimentStocks(): Promise<{
  byId: Map<string, number>;
  byName: Map<string, number>;
}> {
  const db = await getDb();
  const docs = await db
    .collection<AquaAliment>("aquapro_aliments_sources")
    .find({})
    .toArray();
  const byId = new Map<string, number>();
  const byName = new Map<string, number>();
  for (const a of docs) {
    const stock = Math.max(0, Number(a.stock) || 0);
    byId.set(String(a._id), stock);
    const key = normKey(a.designation || "");
    if (key) byName.set(key, stock);
  }
  return { byId, byName };
}

/**
 * Dernier inventaire boisson validé par désignation (bouteilles),
 * converti en casiers via le catalogue King Fish.
 */
export async function loadAquaBoissonOpeningCasiers(
  drinks: Drink[],
): Promise<Map<string, number>> {
  const db = await getDb();
  const inventaires = await db
    .collection<AquaInv>("aquapro_inventaires_boisson")
    .find({})
    .sort({ date: 1 })
    .toArray();

  const drinkByName = new Map(
    drinks.map((d) => [normKey(d.name), d] as const),
  );
  /** drinkId → latest casiers */
  const latest = new Map<string, { date: string; casiers: number }>();

  for (const inv of inventaires) {
    if (!inv.date) continue;
    if (inv.statut && inv.statut !== "Validé") continue;
    for (const line of inv.lignes ?? []) {
      const drink = drinkByName.get(normKey(line.designation || ""));
      if (!drink) continue;
      const upc = Math.max(1, Number(drink.unitsPerCasier) || 12);
      const bottles = Math.max(0, Number(line.quantite) || 0);
      const casiers = Math.round((bottles / upc) * 1000) / 1000;
      const prev = latest.get(drink.id);
      if (!prev || inv.date >= prev.date) {
        latest.set(drink.id, { date: inv.date, casiers });
      }
    }
  }

  const out = new Map<string, number>();
  for (const [id, v] of latest) out.set(id, v.casiers);
  return out;
}

/** Opening matières : privilégie l’id AquaPro, sinon le nom. */
export function openingForMaterials(
  materials: RawMaterial[],
  stocks: { byId: Map<string, number>; byName: Map<string, number> },
): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of materials) {
    const fromId = stocks.byId.get(m.id);
    const fromName = stocks.byName.get(normKey(m.name));
    const qty = fromId ?? fromName ?? 0;
    if (qty > 0) out.set(m.id, qty);
  }
  return out;
}

export function openingByProductName<T extends { id: string; name: string }>(
  products: T[],
  byName: Map<string, number>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of products) {
    const qty = byName.get(normKey(p.name)) ?? 0;
    if (qty > 0) out.set(p.id, qty);
  }
  return out;
}
