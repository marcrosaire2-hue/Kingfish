import type { BoissonsLine, VenteSite } from "@/lib/types";

/** Ligne plat / acc / transfert : suivi explicite après saisie stock. */
export function isLineStockTracked(
  line: { stockTracked?: boolean } | null | undefined,
): boolean {
  return line?.stockTracked === true;
}

/** Boisson : suivi propre à chaque site. */
export function isDrinkStockTracked(
  line: BoissonsLine | null | undefined,
  site: VenteSite,
): boolean {
  if (!line) return false;
  if (site === "zogbo") {
    if (line.stockTrackedZogbo === true) return true;
    if (line.stockTrackedZogbo === false) return false;
    // Legacy : un comptage saisi = déjà inventorié sur ce site.
    return line.countedZogbo !== null;
  }
  if (line.stockTrackedGbegamey === true) return true;
  if (line.stockTrackedGbegamey === false) return false;
  return line.countedGbegamey !== null;
}

/**
 * Faut-il plaquer les ventes au stock ?
 * - forçage admin journée (`dayFreeSale === false`) → tous les produits
 * - sinon → seulement les produits marqués suivis
 */
export function shouldEnforceProductStock(input: {
  dayFreeSale: boolean;
  productTracked: boolean;
}): boolean {
  if (!input.dayFreeSale) return true;
  return input.productTracked;
}
