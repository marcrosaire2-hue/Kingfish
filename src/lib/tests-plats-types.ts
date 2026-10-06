import type { VenteSite } from "@/lib/types";

export type TestPlatKind = "plat" | "local" | "boisson";

export type TestPlatLine = {
  kind: TestPlatKind;
  productId: string;
  name: string;
  qty: number;
  /** Prix de revient unitaire figé à l'enregistrement (0 si non renseigné). */
  unitCost: number;
};

/**
 * Un test de plat : plusieurs lignes saisies comme un panier de vente, mais
 * ce n'est pas une vente — aucun ticket, aucun encaissement, aucun CA, aucun
 * mouvement de caisse ni de stock.
 */
export type TestPlatEntry = {
  id: string;
  numero: string;
  date: string;
  site: VenteSite;
  lines: TestPlatLine[];
  /** Objet du test (nouvelle recette, dégustation fournisseur, etc.). */
  objet: string;
  /** Observations : goût, texture, portion, décision. */
  observations: string;
  /** Qui a goûté / validé. */
  testeur: string;
  /** Σ qty × unitCost — coût matière du test, jamais un chiffre d'affaires. */
  cost: number;
  at: string;
  actorName: string | null;
  cancelledAt: string | null;
  cancelledByName: string | null;
};

export type TestPlatProduct = {
  kind: TestPlatKind;
  productId: string;
  name: string;
  /** Prix de vente catalogue, à titre indicatif seulement. */
  refPrice: number;
  unitCost: number;
};
