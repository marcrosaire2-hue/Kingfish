/**
 * Ordre d'affichage du catalogue. La position dans la liste est l'ordre de la
 * grille de vente : le n° 1 apparaît en premier, le dernier tout en bas.
 */
export function deplacerA<T extends { id: string }>(
  rows: readonly T[],
  id: string,
  position: number,
): T[] {
  const from = rows.findIndex((r) => r.id === id);
  if (from < 0 || !Number.isFinite(position)) return [...rows];
  const to = Math.min(rows.length, Math.max(1, Math.round(position))) - 1;
  if (to === from) return [...rows];
  const next = [...rows];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
