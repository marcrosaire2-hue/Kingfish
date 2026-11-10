import { cloneSeed } from "@/lib/storage";
import { normalizeDrink } from "@/lib/boissons-calc";
import { normalizeCombos } from "@/lib/combos-model";
import {
  listesCommunes,
  parametresConsolides,
  parametresPourSite,
  type CataloguesParSite,
  type ParametresStockes,
} from "@/lib/catalogue-sites";
import type {
  CategoryProduct,
  Parametres,
  ProductCategory,
  RawMaterial,
  Recipe,
  SiteCatalogue,
  VenteSite,
} from "@/lib/types";
import { cached, invalidateCache } from "@/lib/ttl-cache";
import { getDb } from "@/lib/mongodb";

const DOC_ID = "parametres";

type ParametresDoc = ParametresStockes & { _id: string };

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

/** Catégorie fournie d'office tant que l'admin n'a rien configuré. */
export const DEFAULT_CATEGORIES: ProductCategory[] = [
  { id: "dessert", name: "Dessert" },
];

export function normalizeCategories(
  list: ProductCategory[] | undefined,
): ProductCategory[] {
  // Jamais configuré : on propose « Dessert ». Une liste vide enregistrée reste
  // vide (l'admin a supprimé la catégorie volontairement).
  if (list === undefined) return structuredClone(DEFAULT_CATEGORIES);
  const seen = new Set<string>();
  const out: ProductCategory[] = [];
  for (const c of list) {
    const id = String(c?.id ?? "").trim();
    const name = String(c?.name ?? "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 60);
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name });
  }
  return out;
}

export function normalizeCategoryProducts(
  list: CategoryProduct[] | undefined,
  categories: ProductCategory[],
): CategoryProduct[] {
  const known = new Set(categories.map((c) => c.id));
  const seen = new Set<string>();
  const out: CategoryProduct[] = [];
  for (const p of list ?? []) {
    const id = String(p?.id ?? "").trim();
    const categoryId = String(p?.categoryId ?? "").trim();
    // Un article dont la catégorie a disparu n'est plus vendable.
    if (!id || !known.has(categoryId) || seen.has(id)) continue;
    seen.add(id);
    const cost =
      p.costPrice === undefined || p.costPrice === null
        ? undefined
        : Math.max(0, Number(p.costPrice) || 0);
    out.push({
      id,
      categoryId,
      name:
        String(p.name ?? "")
          .trim()
          .replace(/\s+/g, " ")
          .slice(0, 120) || "Article",
      unitPrice: Math.max(0, Math.round(Number(p.unitPrice) || 0)),
      ...(cost === undefined ? {} : { costPrice: cost }),
    });
  }
  return out;
}

function normalizeSiteCatalogue(doc: SiteCatalogue): SiteCatalogue {
  const categories = normalizeCategories(doc.categories);
  return {
    baseDishes: (doc.baseDishes ?? []).map((d) => ({
      ...d,
      costPrice:
        d.costPrice === undefined || d.costPrice === null
          ? undefined
          : Math.max(0, Number(d.costPrice) || 0),
    })),
    drinks: (doc.drinks ?? []).map((d) => normalizeDrink(d)),
    localDishes: (doc.localDishes ?? []).map((d) => ({
      ...d,
      costPrice:
        d.costPrice === undefined || d.costPrice === null
          ? undefined
          : Math.max(0, Number(d.costPrice) || 0),
    })),
    combos: normalizeCombos(doc.combos),
    categories,
    categoryProducts: normalizeCategoryProducts(
      doc.categoryProducts,
      categories,
    ),
    rawMaterials: normalizeRawMaterials(doc.rawMaterials),
    recipes: normalizeRecipes(doc.recipes),
    updatedAt: doc.updatedAt ?? null,
  };
}

function stripId(doc: ParametresDoc): ParametresStockes {
  const catalogues: CataloguesParSite = {};
  for (const site of ["zogbo", "gbegamey"] as const) {
    const liste = doc.catalogues?.[site];
    if (liste) catalogues[site] = normalizeSiteCatalogue(liste);
  }
  return {
    ...normalizeSiteCatalogue(doc),
    ...(Object.keys(catalogues).length > 0 ? { catalogues } : {}),
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

/**
 * Catalogue du site demandé ; sans site, vue consolidée réservée aux écrans
 * multi-sites et aux données communes (matières, recettes). Lu par presque
 * tous les écrans, donc gardé quelques secondes.
 */
export async function getParametres(site?: VenteSite | null): Promise<Parametres> {
  const db = await getDb();
  const stock = await cached(
    `${db.databaseName}:parametres`,
    15_000,
    loadParametres,
  );
  return site ? parametresPourSite(stock, site) : parametresConsolides(stock);
}

async function loadParametres(): Promise<ParametresStockes> {
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
      combos: data.combos ?? [],
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
    combos: [],
    updatedAt: now,
  };
  await col.insertOne(doc);
  return stripId(doc);
}

/** Enregistre le catalogue d'un seul site ; l'autre site n'est jamais réécrit. */
export async function saveParametresToDb(
  data: Parametres,
  site: VenteSite,
): Promise<Parametres> {
  const db = await getDb();
  const col = db.collection<ParametresDoc>("parametres");
  const stock = await loadParametres();
  const updatedAt = new Date().toISOString();
  // Sauvegarde explicite : une liste absente = aucune catégorie (pas de défaut).
  const categories = normalizeCategories(data.categories ?? []);
  const catalogue: SiteCatalogue = {
    baseDishes: data.baseDishes,
    drinks: data.drinks.map((d) => normalizeDrink(d)),
    localDishes: data.localDishes,
    combos: normalizeCombos(data.combos),
    categories,
    categoryProducts: normalizeCategoryProducts(
      data.categoryProducts,
      categories,
    ),
    rawMaterials: normalizeRawMaterials(data.rawMaterials),
    recipes: normalizeRecipes(data.recipes),
    updatedAt,
  };

  const set: Record<string, unknown> = { updatedAt };
  if (stock.catalogues?.zogbo && stock.catalogues?.gbegamey) {
    set[`catalogues.${site}`] = catalogue;
  } else {
    // Première écriture séparée : chaque site part de sa copie des listes
    // existantes, puis seul le site enregistré reçoit ses changements.
    const autre: VenteSite = site === "zogbo" ? "gbegamey" : "zogbo";
    set.catalogues = {
      [site]: catalogue,
      [autre]: stock.catalogues?.[autre] ?? listesCommunes(stock),
    };
  }

  await col.updateOne({ _id: DOC_ID }, { $set: set }, { upsert: true });
  invalidateCache(`${db.databaseName}:parametres`);

  return catalogue;
}

/** Remet le catalogue d'un site aux valeurs d'origine, sans toucher l'autre. */
export async function resetParametresToSeed(
  site: VenteSite,
): Promise<Parametres> {
  const seed = cloneSeed();
  // Les catégories créées par l'admin ne font pas partie du fichier d'origine :
  // la réinitialisation les conserve, comme les matières et recettes du site.
  const current = await getParametres(site);
  return saveParametresToDb(
    {
      ...seed,
      categories: current.categories,
      categoryProducts: current.categoryProducts,
      rawMaterials: current.rawMaterials,
      recipes: current.recipes,
      combos: [],
      updatedAt: null,
    },
    site,
  );
}
