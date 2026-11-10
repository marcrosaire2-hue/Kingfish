import type { VenteKind, VenteProduct, VenteSite } from "@/lib/types";

/** Articles qu'un administrateur peut retirer de la vente. */
export type KindGrisable = "plat" | "local" | "boisson";

export function estKindGrisable(kind: unknown): kind is KindGrisable {
  return kind === "plat" || kind === "local" || kind === "boisson";
}

export function cleProduitGrise(
  site: VenteSite,
  kind: VenteKind,
  productId: string,
): string {
  return `${site}:${kind}:${productId}`;
}

export const MOTIF_GRISE = "Indisponible (grisé par l’administrateur)";

/** Marque les articles grisés : ils restent visibles mais invendables. */
export function marquerProduitsGrises(
  products: VenteProduct[],
  site: VenteSite,
  grises: ReadonlySet<string>,
): VenteProduct[] {
  if (grises.size === 0) return products;
  return products.map((p) =>
    grises.has(cleProduitGrise(site, p.kind, p.productId))
      ? { ...p, griseAdmin: true, blockReason: MOTIF_GRISE }
      : p,
  );
}
