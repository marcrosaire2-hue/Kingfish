/**
 * Point des ventes : classe les articles d'une famille (plats,
 * accompagnements, boissons) du mieux vendu au moins vendu, et liste à part
 * les articles du catalogue qui n'ont rien vendu sur la période.
 */

export type PointArticle = {
  productId: string;
  name: string;
  qty: number;
  amount: number;
};

export type PointFamille = {
  /** Les mieux vendus, du plus vendu au moins vendu. */
  top: PointArticle[];
  /** Les moins vendus parmi ceux qui ont vendu, du moins vendu au plus vendu. */
  flop: PointArticle[];
  /** Tous les articles du catalogue sans aucune vente, par ordre alphabétique. */
  jamaisVendusListe: PointArticle[];
  jamaisVendus: number;
  /** Articles ayant vendu au moins une unité. */
  vendus: number;
  /** Nombre total d'articles considérés. */
  total: number;
  qty: number;
  amount: number;
};

export function classerFamille(
  catalogue: Array<{ id: string; name: string }>,
  ventes: PointArticle[],
  limite = 10,
): PointFamille {
  const parId = new Map<string, PointArticle>();
  for (const item of catalogue) {
    parId.set(item.id, { productId: item.id, name: item.name, qty: 0, amount: 0 });
  }
  for (const v of ventes) {
    const existant = parId.get(v.productId);
    if (existant) {
      existant.qty += v.qty;
      existant.amount += v.amount;
    } else {
      // Article vendu mais retiré du catalogue depuis : on le garde.
      parId.set(v.productId, { ...v });
    }
  }

  const tous = [...parId.values()];
  const vendus = tous.filter((a) => a.qty > 0);
  const jamais = tous
    .filter((a) => a.qty <= 0)
    .sort((a, b) => a.name.localeCompare(b.name));

  // Peu d’articles vendus : on les partage entre les deux classements (la
  // meilleure moitié en haut, le reste en bas) pour ne jamais laisser
  // « Les moins vendus » vide ni répéter un article.
  const tailleTop = Math.min(limite, Math.ceil(vendus.length / 2));
  const top = [...vendus]
    .sort((a, b) => b.qty - a.qty || b.amount - a.amount || a.name.localeCompare(b.name))
    .slice(0, tailleTop);
  const dansTop = new Set(top.map((a) => a.productId));
  const flop = [...vendus]
    .filter((a) => !dansTop.has(a.productId))
    .sort((a, b) => a.qty - b.qty || a.amount - b.amount || a.name.localeCompare(b.name))
    .slice(0, limite);

  return {
    top,
    flop,
    jamaisVendusListe: jamais,
    jamaisVendus: jamais.length,
    vendus: vendus.length,
    total: tous.length,
    qty: vendus.reduce((s, a) => s + a.qty, 0),
    amount: vendus.reduce((s, a) => s + a.amount, 0),
  };
}
