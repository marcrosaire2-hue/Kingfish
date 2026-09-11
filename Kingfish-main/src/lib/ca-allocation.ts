/**
 * Répartition analytique d’une réduction POS.
 *
 * SYSCOHADA : le rabais (709) est unique au ticket, sans ventilation par
 * article. Ici on répartit au prorata des montants bruts (plus fort reste)
 * uniquement pour que les lignes d’analyse somment au CA net — pas pour
 * prétendre connaître l’article remisé.
 */
export function prorateReduction(bruts: number[], reduction: number): number[] {
  const parts = bruts.map((b) => Math.max(0, Math.round(Number(b) || 0)));
  const cap = Math.min(
    Math.max(0, Math.round(Number(reduction) || 0)),
    parts.reduce((s, n) => s + n, 0),
  );
  if (cap <= 0) return parts.map(() => 0);

  const brut = parts.reduce((s, n) => s + n, 0);
  const exact = parts.map((b) => (b * cap) / brut);
  const floors = exact.map((x) => Math.floor(x));
  let rest = cap - floors.reduce((s, n) => s + n, 0);
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac);
  const extra = floors.map(() => 0);
  for (let k = 0; k < order.length && rest > 0; k++) {
    extra[order[k]!.i] += 1;
    rest -= 1;
  }
  return floors.map((f, i) => f + extra[i]!);
}

/** Montants nets = brut − quote-part de réduction. */
export function netAfterProrate(bruts: number[], reduction: number): number[] {
  const red = prorateReduction(bruts, reduction);
  return bruts.map((b, i) =>
    Math.max(0, Math.round(Number(b) || 0) - red[i]!),
  );
}

export type TicketForNetCa = {
  site?: string;
  reduction: number;
  lines: { productId: string; kind: string; amount: number }[];
};

function productKey(kind: string, productId: string): string {
  return `${kind}::${productId}`;
}

/**
 * Réductions POS ventilées ticket par ticket, au prorata des lignes
 * de ce ticket uniquement — jamais un ratio global sur tout le catalogue.
 */
export function allocatedReductionsByProduct(
  tickets: TicketForNetCa[],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of tickets) {
    const reduction = Math.max(0, Math.round(Number(t.reduction) || 0));
    if (reduction <= 0 || t.lines.length === 0) continue;
    const amounts = t.lines.map((l) => l.amount);
    const shares = prorateReduction(amounts, reduction);
    t.lines.forEach((l, i) => {
      const key = productKey(l.kind, l.productId);
      out.set(key, (out.get(key) ?? 0) + (shares[i] ?? 0));
    });
  }
  return out;
}

/** Une réduction POS appartient au site du ticket, pas au ratio maison. */
export function allocatedReductionsBySite(
  tickets: { site: string; reduction: number }[],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of tickets) {
    const reduction = Math.max(0, Math.round(Number(t.reduction) || 0));
    if (reduction <= 0) continue;
    out.set(t.site, (out.get(t.site) ?? 0) + reduction);
  }
  return out;
}

export function productNetKey(kind: string, productId: string): string {
  return productKey(kind, productId);
}
