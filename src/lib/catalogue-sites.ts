import { canUseSite, type UserSite } from "@/lib/auth-types";
import type { Parametres, SiteCatalogue, VenteSite } from "@/lib/types";

/**
 * Catalogue de vente propre à chaque site : un renommage, un prix ou un
 * conditionnement changé à Zogbo ne touche plus Gbégamey, et inversement.
 * Rien n'est partagé, matières premières et recettes comprises.
 */
export type CataloguesParSite = Partial<Record<VenteSite, SiteCatalogue>>;
export type ParametresStockes = Parametres & { catalogues?: CataloguesParSite };

export function listesCommunes(stock: Parametres): SiteCatalogue {
  return {
    baseDishes: stock.baseDishes,
    drinks: stock.drinks,
    localDishes: stock.localDishes,
    combos: stock.combos ?? [],
    categories: stock.categories ?? [],
    categoryProducts: stock.categoryProducts ?? [],
    rawMaterials: stock.rawMaterials ?? [],
    recipes: stock.recipes ?? [],
    updatedAt: stock.updatedAt,
  };
}

/** Avant la séparation, les deux sites lisent les listes communes historiques. */
export function catalogueDuSite(
  stock: ParametresStockes,
  site: VenteSite,
): SiteCatalogue {
  return stock.catalogues?.[site] ?? listesCommunes(stock);
}

export function parametresPourSite(
  stock: ParametresStockes,
  site: VenteSite,
): Parametres {
  return { ...catalogueDuSite(stock, site) };
}

function reunion<T extends { id: string }>(a: T[], b: T[]): T[] {
  const connus = new Set(a.map((x) => x.id));
  return [...a, ...b.filter((x) => !connus.has(x.id))];
}

/**
 * Total en lecture seule de la direction : chaque produit une seule fois, la
 * fiche Zogbo primant en cas de doublon. Le conditionnement Gbégamey reste
 * disponible à part, car le stock de boissons se convertit site par site.
 */
export function parametresConsolides(stock: ParametresStockes): Parametres {
  const z = catalogueDuSite(stock, "zogbo");
  const g = catalogueDuSite(stock, "gbegamey");
  return {
    baseDishes: reunion(z.baseDishes, g.baseDishes),
    drinks: reunion(z.drinks, g.drinks),
    localDishes: reunion(z.localDishes, g.localDishes),
    combos: reunion(z.combos ?? [], g.combos ?? []),
    categories: reunion(z.categories ?? [], g.categories ?? []),
    categoryProducts: reunion(z.categoryProducts ?? [], g.categoryProducts ?? []),
    rawMaterials: reunion(z.rawMaterials ?? [], g.rawMaterials ?? []),
    recipes: [
      ...(z.recipes ?? []),
      ...(g.recipes ?? []).filter(
        (r) => !(z.recipes ?? []).some((x) => x.productId === r.productId),
      ),
    ],
    drinksGbegamey: g.drinks,
    updatedAt: stock.updatedAt,
  };
}

export type CatalogueSiteDecision =
  | { ok: true; site: VenteSite | null }
  | { ok: false; status: 400 | 403; error: string };

/**
 * Site du catalogue demandé par un écran. Un compte lié à un site ne peut
 * consulter ou modifier que le sien ; `site: null` n'est possible que pour un
 * compte multi-sites qui n'a rien précisé (lecture consolidée uniquement).
 */
export function resolveCatalogueSite(
  demande: string | null,
  perimetre: UserSite,
): CatalogueSiteDecision {
  if (demande === null || demande === "") {
    return { ok: true, site: perimetre === "tous" ? null : perimetre };
  }
  if (demande !== "zogbo" && demande !== "gbegamey") {
    return { ok: false, status: 400, error: "Site inconnu." };
  }
  if (!canUseSite(perimetre, demande)) {
    return { ok: false, status: 403, error: "Site non autorisé." };
  }
  return { ok: true, site: demande };
}
