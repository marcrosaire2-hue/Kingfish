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
 * Décision purement journalière (`dayFreeSale`, réglage « Vente selon le
 * stock » côté admin) — un produit individuellement marqué suivi ne plaque
 * plus les ventes tant que la journée est en vente libre. Un comptage
 * périmé (même 0, saisi à une ouverture) ne doit jamais, à lui seul,
 * bloquer une vente : seul le forçage explicite du jour (`dayFreeSale ===
 * false`) réactive le plafond, pour tous les produits.
 */
export function shouldEnforceProductStock(input: {
  dayFreeSale: boolean;
  productTracked: boolean;
}): boolean {
  void input.productTracked;
  return !input.dayFreeSale;
}
