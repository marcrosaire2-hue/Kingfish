/**
 * Report d'une correction de reste vers les journées suivantes (plats et
 * accompagnements, Zogbo et Gbégamey). Voir `stock-carry.ts`.
 */

const CARRY_EPSILON = 1e-6;

function roundQty(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/** Écart de reste par produit (après − avant) ; les écarts nuls sont omis. */
export function leftoverDelta(
  before: Map<string, number>,
  after: Map<string, number>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const d = (after.get(id) ?? 0) - (before.get(id) ?? 0);
    if (Math.abs(d) > CARRY_EPSILON) out.set(id, d);
  }
  return out;
}

/**
 * Ajoute l'écart à l'ouverture de chaque ligne d'une journée suivante.
 *
 * `openingField` : champ qui porte l'ouverture (`stock` pour un plat Zogbo,
 * `initialStock` ailleurs). Une ouverture corrigée à la main est conservée :
 * seul l'écart s'ajoute. Un comptage saisi sur la ligne fige le reste du
 * jour (le report repart du comptage) : l'écart s'arrête là pour ce produit.
 */
export function applyOpeningCarry<
  L extends { productId: string; counted?: number | null },
>(
  lines: L[],
  delta: Map<string, number>,
  openingField: string,
): { lines: L[]; next: Map<string, number>; changed: boolean } {
  const next = new Map(delta);
  let changed = false;
  const out = lines.map((line) => {
    const d = delta.get(line.productId) ?? 0;
    if (d === 0) return line;
    if (line.counted !== null && line.counted !== undefined) {
      next.delete(line.productId);
    }
    const raw = (line as Record<string, unknown>)[openingField];
    const current = Math.max(0, Number(raw) || 0);
    const value = roundQty(Math.max(0, current + d));
    if (value === raw) return line;
    changed = true;
    return { ...line, [openingField]: value };
  });
  return { lines: out, next, changed };
}
