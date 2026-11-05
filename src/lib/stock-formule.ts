/**
 * Règle de stock commune (plats, accompagnements, boissons — deux sites).
 *
 * - SI : stock initial, fixé à la première saisie du produit ; ne bouge plus.
 * - Ouverture : stock de départ du jour. Premier jour : 0 (la première saisie
 *   arrive en entrée et devient le SI). Jours suivants : comptage de la veille
 *   s'il a été saisi, sinon théorique de la veille.
 * - Stock disponible = Ouverture + Entrées du jour.
 * - Stock théorique  = Disponible − Vendus − Pertes.
 * - Stock physique   = comptage saisi ; il ne remplace jamais le stock.
 * - Écart            = Physique − Théorique.
 */
export type StockCalcul = {
  disponible: number;
  theorique: number;
  /** null tant qu'aucun comptage n'est saisi. */
  ecart: number | null;
  /** Stock d'ouverture du lendemain : comptage s'il existe, sinon théorique. */
  report: number;
};

export function calculStock(input: {
  ouverture: number;
  entrees: number;
  vendus: number;
  pertes?: number;
  compte: number | null | undefined;
}): StockCalcul {
  const n = (v: unknown) => Math.max(0, Number(v) || 0);
  const disponible = n(input.ouverture) + n(input.entrees);
  const theorique = Math.max(0, disponible - n(input.vendus) - n(input.pertes));
  const compte =
    input.compte === null || input.compte === undefined ? null : n(input.compte);
  return {
    disponible,
    theorique,
    ecart: compte === null ? null : Math.round((compte - theorique) * 100) / 100,
    report: compte ?? theorique,
  };
}
