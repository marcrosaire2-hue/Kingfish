import { cloneSeed } from "@/lib/storage";
import { normalizeDrink } from "@/lib/boissons-calc";
import type { Parametres, RawMaterial, Recipe } from "@/lib/types";
import { getDb } from "@/lib/mongodb";

const DOC_ID = "parametres";

type ParametresDoc = Parametres & { _id: string };

type AquaAlimentDoc = {
  _id: string;
  designation?: string;
  unite?: string;
  seuil?: number | string;
  stockBloquant?: string | boolean;
  prixReference?: number | string;
};

function normalizeRawMaterials(list: RawMaterial[] | undefined): RawMaterial[] {
  return (list ?? []).map((m) => ({
    id: String(m.id),
    name: String(m.name || "").trim() || "Matière",
    unit: String(m.unit || "").trim() || "Unité",
    purchasePrice: Math.max(0, Number(m.purchasePrice) || 0),
    threshold: Math.max(0, Number(m.threshold) || 0),
    stockBlocking: !!m.stockBlocking,
  }));
}

function normalizeRecipes(list: Recipe[] | undefined): Recipe[] {
  return (list ?? []).map((r) => ({
    productId: String(r.productId),
    lines: (r.lines ?? []).map((l) => ({
      rawMaterialId: String(l.rawMaterialId),
      qty: Math.max(0, Number(l.qty) || 0),
    })),
  }));
}

function stripId(doc: ParametresDoc): Parametres {
  return {
    baseDishes: (doc.baseDishes ?? []).map((d) => ({
      ...d,
      costPrice:
        d.costPrice === undefined || d.costPrice === null
          ? undefined
          : Math.max(0, Number(d.costPrice) || 0),
    })),
    combos: (doc.combos ?? []).map((c) => ({
      ...c,
      costPrice:
        c.costPrice === undefined || c.costPrice === null
          ? undefined
          : Math.max(0, Number(c.costPrice) || 0),
    })),
    drinks: (doc.drinks ?? []).map((d) => normalizeDrink(d)),
    localDishes: (doc.localDishes ?? []).map((d) => ({
      ...d,
      costPrice:
        d.costPrice === undefined || d.costPrice === null
          ? undefined
          : Math.max(0, Number(d.costPrice) || 0),
    })),
    rawMaterials: normalizeRawMaterials(doc.rawMaterials),
    recipes: normalizeRecipes(doc.recipes),
    updatedAt: doc.updatedAt ?? null,
  };
}

async function seedRawMaterialsFromAqua(): Promise<RawMaterial[]> {
  try {
    const db = await getDb();
    const docs = await db
      .collection<AquaAlimentDoc>("aquapro_aliments_sources")
      .find({})
      .limit(500)
      .toArray();
    if (!docs.length) return [];
    return docs.map((a, i) => ({
      id: String(a._id || `mat-${i}`),
      name: String(a.designation || "").trim() || `Matière ${i + 1}`,
      unit: String(a.unite || "").trim() || "Unité",
      purchasePrice: Math.max(0, Number(a.prixReference) || 0),
      threshold: Math.max(0, Number(a.seuil) || 0),
      stockBlocking:
        a.stockBloquant === true ||
        String(a.stockBloquant || "").toLowerCase() === "oui",
    }));
  } catch {
    return [];
  }
}

export async function getParametres(): Promise<Parametres> {
  const db = await getDb();
  const col = db.collection<ParametresDoc>("parametres");
  const existing = await col.findOne({ _id: DOC_ID });
  if (existing) {
    const data = stripId(existing);
    if (!data.rawMaterials?.length) {
      const seeded = await seedRawMaterialsFromAqua();
      if (seeded.length) {
        const updatedAt = new Date().toISOString();
        await col.updateOne(
          { _id: DOC_ID },
          { $set: { rawMaterials: seeded, recipes: data.recipes ?? [], updatedAt } },
        );
        return { ...data, rawMaterials: seeded, recipes: data.recipes ?? [], updatedAt };
      }
    }
    return {
      ...data,
      rawMaterials: data.rawMaterials ?? [],
      recipes: data.recipes ?? [],
    };
  }

  const seed = cloneSeed();
  const now = new Date().toISOString();
  const aquaMats = await seedRawMaterialsFromAqua();
  const doc: ParametresDoc = {
    _id: DOC_ID,
    ...seed,
    rawMaterials: aquaMats,
    recipes: [],
    updatedAt: now,
  };
  await col.insertOne(doc);
  return stripId(doc);
}

export async function saveParametresToDb(
  data: Parametres,
): Promise<Parametres> {
  const db = await getDb();
  const col = db.collection<ParametresDoc>("parametres");
  const updatedAt = new Date().toISOString();
  const payload: Parametres = {
    baseDishes: data.baseDishes,
    combos: data.combos,
    drinks: data.drinks.map((d) => normalizeDrink(d)),
    localDishes: data.localDishes,
    rawMaterials: normalizeRawMaterials(data.rawMaterials),
    recipes: normalizeRecipes(data.recipes),
    updatedAt,
  };

  await col.updateOne(
    { _id: DOC_ID },
    { $set: payload },
    { upsert: true },
  );

  return payload;
}

export async function resetParametresToSeed(): Promise<Parametres> {
  const seed = cloneSeed();
  const aquaMats = await seedRawMaterialsFromAqua();
  return saveParametresToDb({
    ...seed,
    rawMaterials: aquaMats,
    recipes: [],
    updatedAt: null,
  });
}
