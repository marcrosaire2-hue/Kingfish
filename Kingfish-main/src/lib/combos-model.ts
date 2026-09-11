/**
 * Logique pure des combos / formules — catalogue + disponibilité stock.
 */
import type {
  ComboComponent,
  ComboDish,
  Parametres,
  VenteProduct,
} from "@/lib/types";

export function normalizeComboComponent(
  raw: Partial<ComboComponent> | null | undefined,
): ComboComponent | null {
  if (!raw) return null;
  const kind = raw.kind;
  if (kind !== "plat" && kind !== "local" && kind !== "boisson") return null;
  const productId = String(raw.productId || "").trim();
  if (!productId) return null;
  const qty = Math.max(1, Math.round(Number(raw.qty) || 1));
  return { kind, productId, qty };
}

export function normalizeComboDish(
  raw: Partial<ComboDish> & { id?: string; name?: string },
): ComboDish {
  const components = (raw.components ?? [])
    .map((c) => normalizeComboComponent(c))
    .filter((c): c is ComboComponent => !!c);
  return {
    id: String(raw.id || "").trim() || `combo-${Date.now()}`,
    name: String(raw.name || "").trim() || "Combo",
    unitPrice: Math.max(0, Math.round(Number(raw.unitPrice) || 0)),
    components,
    active: raw.active !== false,
    imageUrl: raw.imageUrl ?? null,
    baseDishName: raw.baseDishName ?? null,
    costPrice:
      raw.costPrice === undefined || raw.costPrice === null
        ? undefined
        : Math.max(0, Number(raw.costPrice) || 0),
    alertThreshold:
      raw.alertThreshold === undefined || raw.alertThreshold === null
        ? undefined
        : Math.max(0, Number(raw.alertThreshold) || 0),
  };
}

export function normalizeCombos(
  list: ComboDish[] | undefined | null,
): ComboDish[] {
  return (list ?? []).map((c) => normalizeComboDish(c));
}

/** Prix catalogue des composants (prix « normal » avant remise combo). */
export function comboPrixNormal(
  combo: ComboDish,
  parametres: Parametres,
): number {
  let total = 0;
  for (const c of combo.components) {
    const unit = componentUnitPrice(c, parametres);
    total += unit * c.qty;
  }
  return total;
}

export function componentUnitPrice(
  c: ComboComponent,
  parametres: Parametres,
): number {
  if (c.kind === "plat") {
    return (
      parametres.baseDishes.find((d) => d.id === c.productId)?.unitPrice ?? 0
    );
  }
  if (c.kind === "local") {
    return (
      parametres.localDishes.find((d) => d.id === c.productId)?.unitPrice ?? 0
    );
  }
  return parametres.drinks.find((d) => d.id === c.productId)?.salePrice ?? 0;
}

export function componentName(
  c: ComboComponent,
  parametres: Parametres,
): string {
  if (c.kind === "plat") {
    return (
      parametres.baseDishes.find((d) => d.id === c.productId)?.name ??
      c.productId
    );
  }
  if (c.kind === "local") {
    return (
      parametres.localDishes.find((d) => d.id === c.productId)?.name ??
      c.productId
    );
  }
  return (
    parametres.drinks.find((d) => d.id === c.productId)?.name ?? c.productId
  );
}

export function comboEconomie(
  combo: ComboDish,
  parametres: Parametres,
): number {
  return Math.max(0, comboPrixNormal(combo, parametres) - combo.unitPrice);
}

/**
 * Combos vendables = min des portions possibles selon le stock restant
 * de chaque composant sur le board du site.
 */
export function comboStockLeft(
  combo: ComboDish,
  products: VenteProduct[],
): number | null {
  if (!combo.components.length) return 0;
  let min: number | null = null;
  for (const c of combo.components) {
    const p = products.find(
      (x) => x.kind === c.kind && x.productId === c.productId,
    );
    if (!p) return 0;
    // Accompagnement / stock non suivi : ne plafonne pas.
    if (p.stockLeft === null || p.stockLeft === undefined) continue;
    const portions = Math.floor(p.stockLeft / Math.max(1, c.qty));
    min = min === null ? portions : Math.min(min, portions);
  }
  return min === null ? null : Math.max(0, min);
}

export function newComboId(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `combo-${slug || "formule"}-${Date.now().toString(36)}`;
}
