import type {
  StockEvent,
  StockLedgerFamily,
  StockLedgerUnit,
} from "@/lib/stock-ledger";
import type { VenteKind, VenteSite } from "@/lib/types";

/**
 * Traduction des sources existantes (ventes, pertes, achats, inventaires) en
 * événements de stock. Une vente annulée produit deux événements (sortie puis
 * reprise) : le journal reste auditable, le solde net est juste.
 */

export type VenteSourceLike = {
  id: string;
  date: string;
  site: VenteSite;
  kind: VenteKind;
  productId: string;
  name: string;
  qty: number;
  at: string;
  cancelledAt?: string | null;
  source?: string | null;
  actorId?: string | null;
};

export function ledgerFamilyOfVente(
  kind: VenteKind,
): StockLedgerFamily | null {
  if (kind === "plat") return "plat";
  if (kind === "boisson") return "boisson";
  return null;
}

function unitOfFamily(family: StockLedgerFamily): StockLedgerUnit {
  if (family === "boisson") return "bt";
  if (family === "matiere") return "u";
  return "portion";
}

function baseEvent(input: {
  id: string;
  site: VenteSite;
  family: StockLedgerFamily;
  productId: string;
  name: string;
  type: StockEvent["type"];
  qty: number;
  unit?: StockLedgerUnit;
  at: string;
  date: string;
  actorId?: string | null;
  source?: string | null;
  idempotencyKey: string;
}): StockEvent {
  return {
    id: input.id,
    site: input.site,
    family: input.family,
    productId: input.productId,
    name: input.name,
    type: input.type,
    qty: Math.abs(input.qty),
    unit: input.unit ?? unitOfFamily(input.family),
    at: input.at,
    date: input.date,
    actorId: input.actorId ?? null,
    source: input.source ?? null,
    idempotencyKey: input.idempotencyKey,
  };
}

export function mapVenteToStockEvents(vente: VenteSourceLike): StockEvent[] {
  const family = ledgerFamilyOfVente(vente.kind);
  if (!family || !Number.isFinite(vente.qty) || vente.qty === 0) return [];

  const unit = unitOfFamily(family);
  const saleType: StockEvent["type"] = vente.qty > 0 ? "vente" : "annulation";
  const events: StockEvent[] = [
    baseEvent({
      id: `${vente.id}:vente`,
      site: vente.site,
      family,
      productId: vente.productId,
      name: vente.name,
      type: saleType,
      qty: vente.qty,
      unit,
      at: vente.at,
      date: vente.date,
      actorId: vente.actorId,
      source: vente.source ?? "vente",
      idempotencyKey: `vente:${vente.id}`,
    }),
  ];

  if (vente.cancelledAt) {
    // L'annulation remet exactement ce que la vente a sorti.
    events.push(
      baseEvent({
        id: `${vente.id}:annulation`,
        site: vente.site,
        family,
        productId: vente.productId,
        name: vente.name,
        type: vente.qty > 0 ? "annulation" : "vente",
        qty: vente.qty,
        unit,
        at: vente.cancelledAt,
        date: vente.date,
        actorId: vente.actorId,
        source: "annulation-vente",
        idempotencyKey: `annulation-vente:${vente.id}`,
      }),
    );
  }

  return events;
}

export type PerteSourceLike = {
  id: string;
  date: string;
  site: VenteSite;
  kind: string;
  productId: string;
  name: string;
  qty: number;
  at: string;
  cancelledAt?: string | null;
};

export function ledgerFamilyOfPerte(
  kind: string,
): StockLedgerFamily | null {
  if (kind === "plat") return "plat";
  if (kind === "boisson") return "boisson";
  if (kind === "matiere") return "matiere";
  // Immobilisations et achats libres n'ont pas de ligne de stock suivie ici.
  return null;
}

export function mapPerteToStockEvents(perte: PerteSourceLike): StockEvent[] {
  const family = ledgerFamilyOfPerte(perte.kind);
  if (!family || !Number.isFinite(perte.qty) || perte.qty <= 0) return [];

  const events: StockEvent[] = [
    baseEvent({
      id: `${perte.id}:perte`,
      site: perte.site,
      family,
      productId: perte.productId,
      name: perte.name,
      type: "perte",
      qty: perte.qty,
      at: perte.at,
      date: perte.date,
      source: "perte",
      idempotencyKey: `perte:${perte.id}`,
    }),
  ];

  if (perte.cancelledAt) {
    events.push(
      baseEvent({
        id: `${perte.id}:annulation`,
        site: perte.site,
        family,
        productId: perte.productId,
        name: perte.name,
        type: "annulation",
        qty: perte.qty,
        at: perte.cancelledAt,
        date: perte.date,
        source: "annulation-perte",
        idempotencyKey: `annulation-perte:${perte.id}`,
      }),
    );
  }

  return events;
}

export type AchatSourceLike = {
  id: string;
  date: string;
  site: VenteSite;
  family: StockLedgerFamily;
  productId: string;
  name: string;
  qty: number;
  at: string;
  cancelledAt?: string | null;
  source?: string | null;
};

/** Achat / entrée de stock (quantité déjà convertie dans l'unité du produit). */
export function mapAchatToStockEvents(achat: AchatSourceLike): StockEvent[] {
  if (!Number.isFinite(achat.qty) || achat.qty <= 0) return [];

  const events: StockEvent[] = [
    baseEvent({
      id: `${achat.id}:entree`,
      site: achat.site,
      family: achat.family,
      productId: achat.productId,
      name: achat.name,
      type: "entree",
      qty: achat.qty,
      at: achat.at,
      date: achat.date,
      source: achat.source ?? "achat",
      idempotencyKey: `achat:${achat.id}`,
    }),
  ];

  if (achat.cancelledAt) {
    events.push(
      baseEvent({
        id: `${achat.id}:annulation`,
        site: achat.site,
        family: achat.family,
        productId: achat.productId,
        name: achat.name,
        type: "retrait_entree",
        qty: achat.qty,
        at: achat.cancelledAt,
        date: achat.date,
        source: "annulation-achat",
        idempotencyKey: `annulation-achat:${achat.id}`,
      }),
    );
  }

  return events;
}

/**
 * Quantité d'un achat corrigée après coup : seul l'écart est journalisé, le
 * mouvement d'origine reste tel quel. `editedAt` distingue les corrections
 * successives d'un même achat.
 */
export function mapAchatCorrectionToStockEvents(input: {
  id: string;
  date: string;
  site: VenteSite;
  family: StockLedgerFamily;
  productId: string;
  name: string;
  qtyAvant: number;
  qtyApres: number;
  editedAt: string;
  source?: string | null;
}): StockEvent[] {
  const ecart = input.qtyApres - input.qtyAvant;
  if (!Number.isFinite(ecart) || ecart === 0) return [];
  return [
    baseEvent({
      id: `${input.id}:correction:${input.editedAt}`,
      site: input.site,
      family: input.family,
      productId: input.productId,
      name: input.name,
      type: ecart > 0 ? "entree" : "retrait_entree",
      qty: ecart,
      at: input.editedAt,
      date: input.date,
      source: input.source ?? "correction-achat",
      idempotencyKey: `correction-achat:${input.id}:${input.editedAt}`,
    }),
  ];
}

export type ComptageSourceLike = {
  site: VenteSite;
  family: StockLedgerFamily;
  productId: string;
  name: string;
  qty: number;
  unit?: StockLedgerUnit;
  at: string;
  date: string;
  /** Identifiant stable du comptage (date + révision, ou id de document). */
  reference: string;
};

/** Comptage physique : écrit le stock à `at` et fige l'écart. */
export function mapComptageToStockEvent(
  comptage: ComptageSourceLike,
): StockEvent {
  return baseEvent({
    id: `comptage:${comptage.reference}`,
    site: comptage.site,
    family: comptage.family,
    productId: comptage.productId,
    name: comptage.name,
    type: "comptage",
    qty: comptage.qty,
    unit: comptage.unit,
    at: comptage.at,
    date: comptage.date,
    source: "inventaire",
    idempotencyKey: `comptage:${comptage.site}:${comptage.family}:${comptage.productId}:${comptage.reference}`,
  });
}
