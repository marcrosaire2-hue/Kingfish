import { normalizeBoissonsLine } from "@/lib/boissons-calc";
import type { BoissonsLine, VenteSite } from "@/lib/types";

/** Début du stock de matières propre à Gbégamey (toute date antérieure : Zogbo). */
export const DEBUT_MATIERES_GBEGAMEY = "2026-11-02";

type Mouvement = { site?: string | null };
export type JourStocke = {
  _id: string;
  lines?: unknown[];
  movements?: Mouvement[];
  updatedAt?: string | null;
  status?: string;
} & Record<string, unknown>;

/** Ne garde d'une ligne que ce qui appartient au site. */
export function projeterLigneBoisson(
  raw: BoissonsLine,
  site: VenteSite,
): BoissonsLine {
  const l = normalizeBoissonsLine(raw);
  const zogbo = site === "zogbo";
  return {
    productId: l.productId,
    name: l.name,
    initialStockZogbo: zogbo ? l.initialStockZogbo : 0,
    purchasesZogbo: zogbo ? l.purchasesZogbo : 0,
    soldZogbo: zogbo ? l.soldZogbo : 0,
    pertesZogbo: zogbo ? l.pertesZogbo : 0,
    countedZogbo: zogbo ? l.countedZogbo : null,
    initialStockGbegamey: zogbo ? 0 : l.initialStockGbegamey,
    purchasesGbegamey: zogbo ? 0 : l.purchasesGbegamey,
    soldGbegamey: zogbo ? 0 : l.soldGbegamey,
    pertesGbegamey: zogbo ? 0 : l.pertesGbegamey,
    countedGbegamey: zogbo ? null : l.countedGbegamey,
    observations: l.observations,
    ...(zogbo && l.comptageZogbo ? { comptageZogbo: l.comptageZogbo } : {}),
    ...(!zogbo && l.comptageGbegamey ? { comptageGbegamey: l.comptageGbegamey } : {}),
    ...(zogbo && l.stockTrackedZogbo !== undefined
      ? { stockTrackedZogbo: l.stockTrackedZogbo }
      : {}),
    ...(!zogbo && l.stockTrackedGbegamey !== undefined
      ? { stockTrackedGbegamey: l.stockTrackedGbegamey }
      : {}),
  };
}

const appartientAuSite = (m: Mouvement, site: VenteSite) =>
  m.site === "gbegamey" ? site === "gbegamey" : site === "zogbo";

export function projeterJourBoissons(
  doc: JourStocke,
  site: VenteSite,
): JourStocke {
  return {
    ...doc,
    lines: (doc.lines ?? []).map((l) =>
      projeterLigneBoisson(l as BoissonsLine, site),
    ),
    movements: (doc.movements ?? []).filter((m) => appartientAuSite(m, site)),
  };
}

export function projeterJourMatieres(
  doc: JourStocke,
  site: VenteSite,
): JourStocke | null {
  if (site === "gbegamey" && doc._id < DEBUT_MATIERES_GBEGAMEY) return null;
  return {
    ...doc,
    movements: (doc.movements ?? []).filter((m) => appartientAuSite(m, site)),
  };
}

/**
 * Journée créée à l'avance, sans aucune activité : on ne la recopie pas, car
 * son ouverture périmée remplacerait le vrai stock le jour venu.
 */
export function estJourFuturVide(doc: JourStocke, aujourdhui: string): boolean {
  if (doc._id <= aujourdhui) return false;
  if ((doc.movements ?? []).length > 0) return false;
  return (doc.lines ?? []).every((raw) => {
    const l = normalizeBoissonsLine(raw as BoissonsLine);
    return (
      l.purchasesZogbo + l.soldZogbo + l.pertesZogbo +
        l.purchasesGbegamey + l.soldGbegamey + l.pertesGbegamey ===
        0 &&
      l.countedZogbo === null &&
      l.countedGbegamey === null
    );
  });
}

/** Lecture consolidée seule : réunit les deux sites sur une ligne par produit. */
export function fusionnerLignesBoissons(
  zogbo: BoissonsLine[],
  gbegamey: BoissonsLine[],
): BoissonsLine[] {
  const z = new Map(zogbo.map((l) => [l.productId, normalizeBoissonsLine(l)]));
  const g = new Map(gbegamey.map((l) => [l.productId, normalizeBoissonsLine(l)]));
  return [...new Set([...z.keys(), ...g.keys()])].map((id) => {
    const lz = z.get(id);
    const lg = g.get(id);
    const base = (lz ?? lg)!;
    return {
      ...projeterLigneBoisson(base, "zogbo"),
      ...(lz ? projeterLigneBoisson(lz, "zogbo") : {}),
      initialStockGbegamey: lg?.initialStockGbegamey ?? 0,
      purchasesGbegamey: lg?.purchasesGbegamey ?? 0,
      soldGbegamey: lg?.soldGbegamey ?? 0,
      pertesGbegamey: lg?.pertesGbegamey ?? 0,
      countedGbegamey: lg?.countedGbegamey ?? null,
      ...(lg?.comptageGbegamey ? { comptageGbegamey: lg.comptageGbegamey } : {}),
      ...(lg?.stockTrackedGbegamey !== undefined
        ? { stockTrackedGbegamey: lg.stockTrackedGbegamey }
        : {}),
    };
  });
}

export function fusionnerParJour<T extends { _id: string }>(
  zogbo: T[],
  gbegamey: T[],
  fusion: (z: T | undefined, g: T | undefined) => T,
): T[] {
  const z = new Map(zogbo.map((d) => [d._id, d]));
  const g = new Map(gbegamey.map((d) => [d._id, d]));
  return [...new Set([...z.keys(), ...g.keys()])]
    .sort()
    .map((id) => fusion(z.get(id), g.get(id)));
}
