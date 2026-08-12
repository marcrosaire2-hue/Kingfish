/**
 * Catalogue Zogbo — plats standards + accompagnements (nouvelles ventes).
 * Les ventes historiques (carnet, devis…) restent en « extra » sans changement.
 */

export type ZogboPlatDef = {
  id: string;
  name: string;
  unitPrice: number;
  /** Prix unitaire des accompagnements servis avec ce plat. */
  accompanimentPrice: number;
  accompanimentIds: readonly string[];
};

export type ZogboAccompanimentDef = {
  id: string;
  name: string;
  /** Prix par défaut (vente seule ou hors contexte plat pané). */
  unitPrice: number;
};

/** Accompagnements standards à 500 F. */
const ACC_500 = {
  pateMais: "local-pate-de-mais",
  telibo: "local-telibo",
  pironBlanc: "local-piron-blanc",
  pironRouge: "local-piron-rouge",
  akassa: "local-akassa",
  riz: "local-riz",
  couscousFonio: "local-couscous-fonio",
  blanc: "local-blanc",
} as const;

/** Accompagnements poisson pané à 1 000 F. */
const ACC_1000 = {
  frites: "local-frites",
  legumeSaute: "local-legume-saute",
  pommesTerre: "local-pommes-de-terre-sautees",
  spaghetti: "local-spaghetti",
  riz: "local-riz",
} as const;

export const ZOGBO_ACCOMPAGNEMENTS: ZogboAccompanimentDef[] = [
  { id: ACC_500.pateMais, name: "Pâte de maïs", unitPrice: 500 },
  {
    id: ACC_500.telibo,
    name: "Pâte télibo (causette d'igname)",
    unitPrice: 500,
  },
  { id: ACC_500.pironBlanc, name: "Piron blanc", unitPrice: 500 },
  { id: ACC_500.pironRouge, name: "Piron rouge", unitPrice: 500 },
  { id: ACC_500.akassa, name: "Akassa", unitPrice: 500 },
  { id: ACC_500.riz, name: "Riz", unitPrice: 500 },
  {
    id: ACC_500.couscousFonio,
    name: "Couscous de fonio sans gluten",
    unitPrice: 500,
  },
  { id: ACC_500.blanc, name: "Blanc", unitPrice: 500 },
  { id: ACC_1000.frites, name: "Frites", unitPrice: 1000 },
  { id: ACC_1000.legumeSaute, name: "Légumes sautés", unitPrice: 1000 },
  {
    id: ACC_1000.pommesTerre,
    name: "Pommes de terre sautées",
    unitPrice: 1000,
  },
  { id: ACC_1000.spaghetti, name: "Spaghetti", unitPrice: 1000 },
];

const ACC_TOMATE_ARACHIDE = [
  ACC_500.pateMais,
  ACC_500.telibo,
  ACC_500.pironBlanc,
  ACC_500.pironRouge,
  ACC_500.akassa,
  ACC_500.riz,
  ACC_500.couscousFonio,
  ACC_500.blanc,
] as const;

const ACC_LEGUMES = [
  ACC_500.pateMais,
  ACC_500.telibo,
  ACC_500.pironBlanc,
  ACC_500.pironRouge,
  ACC_500.akassa,
  ACC_500.couscousFonio,
  ACC_500.blanc,
] as const;

const ACC_GRAINE_TCHAYO = [
  ACC_500.pateMais,
  ACC_500.telibo,
  ACC_500.pironBlanc,
  ACC_500.pironRouge,
  ACC_500.akassa,
  ACC_500.couscousFonio,
  ACC_500.blanc,
  ACC_500.riz,
] as const;

const ACC_MONYO = [
  ACC_500.akassa,
  ACC_500.pironBlanc,
  ACC_500.pironRouge,
  ACC_500.pateMais,
] as const;

const ACC_POISSON_PANE = [
  ACC_1000.frites,
  ACC_1000.legumeSaute,
  ACC_1000.pommesTerre,
  ACC_1000.spaghetti,
  ACC_1000.riz,
] as const;

export const ZOGBO_PLATS: ZogboPlatDef[] = [
  {
    id: "base-sauce-tomate-poisson-frais",
    name: "Sauce tomate au poisson frais",
    unitPrice: 1000,
    accompanimentPrice: 500,
    accompanimentIds: ACC_TOMATE_ARACHIDE,
  },
  {
    id: "base-sauce-d-arachide",
    name: "Sauce d'arachide",
    unitPrice: 1000,
    accompanimentPrice: 500,
    accompanimentIds: ACC_TOMATE_ARACHIDE,
  },
  {
    id: "base-sauce-legumes-tchiayo-gboman",
    name: "Sauce légumes",
    unitPrice: 1000,
    accompanimentPrice: 500,
    accompanimentIds: ACC_LEGUMES,
  },
  {
    id: "base-sauce-graine",
    name: "Sauce graine",
    unitPrice: 1000,
    accompanimentPrice: 500,
    accompanimentIds: ACC_GRAINE_TCHAYO,
  },
  {
    id: "base-sauce-tchiayo-broye",
    name: "Sauce tchayo broyé (mouton & fromage)",
    unitPrice: 1000,
    accompanimentPrice: 500,
    accompanimentIds: ACC_GRAINE_TCHAYO,
  },
  {
    id: "base-sauce-monyo-au-poisson-fume",
    name: "Sauce monyo",
    unitPrice: 1000,
    accompanimentPrice: 500,
    accompanimentIds: ACC_MONYO,
  },
  {
    id: "base-poisson-pane",
    name: "Poisson pané",
    unitPrice: 1000,
    accompanimentPrice: 1000,
    accompanimentIds: ACC_POISSON_PANE,
  },
];

export const ZOGBO_PLAT_IDS = new Set(ZOGBO_PLATS.map((p) => p.id));
export const ZOGBO_ACC_IDS = new Set(ZOGBO_ACCOMPAGNEMENTS.map((a) => a.id));

const platById = new Map(ZOGBO_PLATS.map((p) => [p.id, p]));
const accById = new Map(ZOGBO_ACCOMPAGNEMENTS.map((a) => [a.id, a]));

export function getZogboPlat(productId: string): ZogboPlatDef | undefined {
  return platById.get(productId);
}

export function getZogboAccompaniment(
  productId: string,
): ZogboAccompanimentDef | undefined {
  return accById.get(productId);
}

/** Accompagnements autorisés pour un plat (nouveau modèle). */
export function accompanimentsForPlat(platId: string): ZogboAccompanimentDef[] {
  const plat = platById.get(platId);
  if (!plat) return [];
  return plat.accompanimentIds
    .map((id) => accById.get(id))
    .filter((a): a is ZogboAccompanimentDef => !!a);
}

/** Prix de l'accompagnement selon le plat choisi (500 ou 1 000). */
export function accompanimentUnitPrice(
  platId: string,
  accompanimentId: string,
): number {
  const plat = platById.get(platId);
  if (plat?.accompanimentIds.includes(accompanimentId)) {
    return plat.accompanimentPrice;
  }
  return accById.get(accompanimentId)?.unitPrice ?? 500;
}

/** Payload pour mise à jour des paramètres (conserve boissons / matières). */
export function zogboCatalogParametresPatch(): {
  baseDishes: { id: string; name: string; unitPrice: number }[];
  localDishes: { id: string; name: string; unitPrice: number }[];
  combos: [];
} {
  return {
    baseDishes: ZOGBO_PLATS.map((p) => ({
      id: p.id,
      name: p.name,
      unitPrice: p.unitPrice,
    })),
    localDishes: ZOGBO_ACCOMPAGNEMENTS.map((a) => ({
      id: a.id,
      name: a.name,
      unitPrice: a.unitPrice,
    })),
    combos: [],
  };
}
