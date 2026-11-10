import { correctionComptage, type ComptageRef } from "@/lib/stock-comptage";
/**
 * Règle de stock commune (plats, accompagnements, boissons — deux sites).
 *
 * - SI : stock initial, fixé à la première saisie du produit ; ne bouge plus.
 * - Ouverture : stock de départ du jour. Premier jour : 0 (la première saisie
 *   arrive en entrée et devient le SI). Jours suivants : comptage de la veille
 *   s'il a été saisi, sinon théorique de la veille.
 * - Stock disponible = Ouverture + Entrées du jour.
 * - Stock théorique  = Disponible − Vendus − Pertes.
 * - Stock physique   = comptage saisi : il remplace le stock à l'instant de la
 *   saisie ; les ventes, pertes et entrées suivantes partent de lui.
 * - Écart            = Physique − stock calculé au moment du comptage.
 */
export type StockCalcul = {
  disponible: number;
  theorique: number;
  /** null tant qu'aucun comptage n'est saisi. */
  ecart: number | null;
  /** Stock d'ouverture du lendemain : le stock restant. */
  report: number;
  /** Ajustement apporté par le comptage (0 sans comptage). */
  correction: number;
};

export function calculStock(input: {
  ouverture: number;
  entrees: number;
  vendus: number;
  pertes?: number;
  compte: number | null | undefined;
  comptage?: ComptageRef | null;
}): StockCalcul {
  // Seules les quantités de mouvement sont positives par nature. L'ouverture
  // peut être négative (survente reportée) : on ne la borne pas, sinon le
  // négatif disparaît et ressort plus tard en faux écart.
  const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const qty = (v: unknown) => Math.max(0, num(v));
  const disponible = num(input.ouverture) + qty(input.entrees);
  const brut = disponible - qty(input.vendus) - qty(input.pertes);
  const compte =
    input.compte === null || input.compte === undefined ? null : qty(input.compte);
  const correction = correctionComptage(compte, input.comptage, brut);
  // Pas de plancher à 0 : un théorique négatif est une alerte, pas un zéro.
  const theorique = brut + correction;
  const reference = input.comptage?.theorique ?? brut;
  return {
    disponible,
    theorique,
    ecart: compte === null ? null : Math.round((compte - reference) * 100) / 100,
    report: theorique,
    correction,
  };
}
