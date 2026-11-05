import { getParametres } from "@/lib/parametres-repo";
import { classerFamille, type PointFamille } from "@/lib/point-ventes-calc";
import { getQuantitesVendues } from "@/lib/quantites-vendues-repo";
import type { VenteKind, VenteSite } from "@/lib/types";

export type PointVentesPayload = {
  from: string;
  to: string;
  site: "all" | VenteSite;
  limite: number;
  plats: PointFamille;
  accompagnements: PointFamille;
  boissons: PointFamille;
};

/**
 * Point des ventes sur une période : mieux vendus et moins vendus par famille.
 * Source : ventes_log actives (annulations et ventes direction exclues),
 * croisées avec le catalogue pour faire apparaître les articles jamais vendus.
 */
export async function getPointVentes(input: {
  from: string;
  to: string;
  site: "all" | VenteSite;
  limite?: number;
}): Promise<PointVentesPayload> {
  const limite = Math.min(50, Math.max(3, Math.round(input.limite ?? 10)));
  const [ventes, parametres] = await Promise.all([
    getQuantitesVendues({ from: input.from, to: input.to, site: input.site, kind: "all", avecCorrections: true }),
    getParametres(),
  ]);

  const deFamille = (kind: VenteKind) =>
    ventes.rows
      .filter((r) => r.kind === kind)
      .map((r) => ({ productId: r.productId, name: r.name, qty: r.qty, amount: r.amount }));

  return {
    from: ventes.from,
    to: ventes.to,
    site: input.site,
    limite,
    plats: classerFamille(parametres.baseDishes ?? [], deFamille("plat"), limite),
    accompagnements: classerFamille(parametres.localDishes ?? [], deFamille("local"), limite),
    boissons: classerFamille(parametres.drinks ?? [], deFamille("boisson"), limite),
  };
}
