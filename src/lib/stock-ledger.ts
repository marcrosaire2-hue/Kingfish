import type { VenteSite } from "@/lib/types";

/**
 * Journal d'événements de stock — source de vérité unique par site.
 *
 * Le stock n'est plus un solde stocké dans un document « jour » : il est
 * recalculé à la lecture comme une somme d'événements. Un comptage est un
 * événement horodaté qui écrit le stock (`stock = compté`) ; seuls les
 * événements postérieurs s'appliquent ensuite.
 *
 * Aucune valeur n'est bornée à 0 : un stock négatif est un signal (survente,
 * sortie non déclarée), pas une valeur à masquer.
 */

export type StockLedgerFamily = "plat" | "local" | "boisson" | "matiere";

export type StockLedgerUnit = "portion" | "bt" | "u";

export type StockEventType =
  /** Stock initial (première entrée d'un produit). */
  | "stock_initial"
  /** Achat, approvisionnement, réception interne au site. */
  | "entree"
  /** Fabrication sur place (préparé). */
  | "production"
  /** Sortie par la vente. */
  | "vente"
  /** Sortie par perte/casse. */
  | "perte"
  /** Reprise de stock (vente annulée, correction positive). */
  | "annulation"
  /** Retire une entrée saisie à tort (achat annulé, quantité corrigée à la baisse). */
  | "retrait_entree"
  /** Comptage physique : écrit le stock à l'instant `at`. */
  | "comptage";

export type StockEvent = {
  /** Identifiant stable (ObjectId Mongo côté persistance, libre côté tests). */
  id: string;
  site: VenteSite;
  family: StockLedgerFamily;
  productId: string;
  name: string;
  type: StockEventType;
  /** Quantité positive, dans `unit`. Un comptage porte la quantité constatée. */
  qty: number;
  unit: StockLedgerUnit;
  /** Horodatage ISO de l'événement (fait foi pour l'ordre et le comptage). */
  at: string;
  /** Jour de service (YYYY-MM-DD), pour les filtres et les vues par jour. */
  date: string;
  actorId?: string | null;
  /** Provenance : vente, achat, perte, inventaire, reprise… */
  source?: string | null;
  /**
   * Clé d'idempotence unique par site (`vente:<id>`, `perte:<id>`,
   * `comptage:<site>:<produit>:<at>`…). Rejouer la même clé ne crée pas
   * de doublon.
   */
  idempotencyKey: string;
};

const ENTRY_TYPES: ReadonlySet<StockEventType> = new Set([
  "stock_initial",
  "entree",
  "production",
  "annulation",
]);

/** +1 = entrée, −1 = sortie, 0 = écriture absolue (comptage). */
export function stockEventDirection(type: StockEventType): 1 | -1 | 0 {
  if (type === "comptage") return 0;
  return ENTRY_TYPES.has(type) ? 1 : -1;
}

export function stockLedgerKey(
  event: Pick<StockEvent, "site" | "family" | "productId">,
): string {
  return `${event.site}:${event.family}:${event.productId}`;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function assertQty(qty: number, eventType: StockEventType): void {
  if (!Number.isFinite(qty)) {
    throw new Error(`Quantité invalide pour un événement « ${eventType} ».`);
  }
  if (qty < 0) {
    throw new Error(
      `Quantité négative interdite sur « ${eventType} » : utilisez le type d'événement adapté.`,
    );
  }
}

export function assertStockEvent(event: StockEvent): void {
  if (!event.site) throw new Error("Événement de stock sans site.");
  if (!event.productId) throw new Error("Événement de stock sans produit.");
  if (!event.idempotencyKey) {
    throw new Error("Événement de stock sans clé d'idempotence.");
  }
  if (!event.at || Number.isNaN(Date.parse(event.at))) {
    throw new Error(`Horodatage invalide : ${event.at}`);
  }
  assertQty(event.qty, event.type);
}

function compareEvents(a: StockEvent, b: StockEvent): number {
  if (a.at !== b.at) return a.at < b.at ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export type StockBalance = {
  site: VenteSite;
  family: StockLedgerFamily;
  productId: string;
  name: string;
  unit: StockLedgerUnit;
  /** Stock théorique courant, jamais borné (peut être négatif). */
  stock: number;
  /** Cumuls positifs depuis le début du journal. */
  entrees: number;
  production: number;
  ventes: number;
  pertes: number;
  annulations: number;
  /** Dernier comptage physique. */
  lastCounted: number | null;
  lastCountAt: string | null;
  /** Écart calculé une seule fois, au moment du dernier comptage. */
  lastEcart: number | null;
  counts: number;
  lastEventAt: string | null;
  events: number;
};

function emptyBalance(event: StockEvent): StockBalance {
  return {
    site: event.site,
    family: event.family,
    productId: event.productId,
    name: event.name,
    unit: event.unit,
    stock: 0,
    entrees: 0,
    production: 0,
    ventes: 0,
    pertes: 0,
    annulations: 0,
    lastCounted: null,
    lastCountAt: null,
    lastEcart: null,
    counts: 0,
    lastEventAt: null,
    events: 0,
  };
}

/**
 * Applique un flux d'événements et renvoie un solde par `site:famille:produit`.
 * `at` (optionnel) borne la lecture : seuls les événements `at <= borne`
 * comptent.
 */
export function applyStockEvents(
  events: readonly StockEvent[],
  options?: { at?: string | null },
): Map<string, StockBalance> {
  const borne = options?.at ?? null;
  if (borne !== null && Number.isNaN(Date.parse(borne))) {
    throw new Error(`Borne de lecture invalide : ${borne}`);
  }

  const sorted = [...events]
    .filter((event) => borne === null || event.at <= borne)
    .sort(compareEvents);

  const balances = new Map<string, StockBalance>();

  for (const event of sorted) {
    assertStockEvent(event);
    const key = stockLedgerKey(event);
    const balance = balances.get(key) ?? emptyBalance(event);

    // Dernier libellé connu (un produit peut être renommé).
    if (event.name) balance.name = event.name;
    if (event.unit) balance.unit = event.unit;

    switch (event.type) {
      case "stock_initial":
      case "entree":
        balance.stock = round4(balance.stock + event.qty);
        balance.entrees = round4(balance.entrees + event.qty);
        break;
      case "retrait_entree":
        balance.stock = round4(balance.stock - event.qty);
        balance.entrees = round4(balance.entrees - event.qty);
        break;
      case "production":
        balance.stock = round4(balance.stock + event.qty);
        balance.production = round4(balance.production + event.qty);
        break;
      case "annulation":
        balance.stock = round4(balance.stock + event.qty);
        balance.annulations = round4(balance.annulations + event.qty);
        break;
      case "vente":
        balance.stock = round4(balance.stock - event.qty);
        balance.ventes = round4(balance.ventes + event.qty);
        break;
      case "perte":
        balance.stock = round4(balance.stock - event.qty);
        balance.pertes = round4(balance.pertes + event.qty);
        break;
      case "comptage":
        // Le comptage écrit le stock : l'écart est figé ici, une seule fois.
        balance.lastEcart = round4(event.qty - balance.stock);
        balance.stock = round4(event.qty);
        balance.lastCounted = round4(event.qty);
        balance.lastCountAt = event.at;
        balance.counts += 1;
        break;
    }

    balance.events += 1;
    balance.lastEventAt = event.at;
    balances.set(key, balance);
  }

  return balances;
}

/** Liste triée des soldes, pour l'affichage. */
export function listStockBalances(
  events: readonly StockEvent[],
  options?: { at?: string | null },
): StockBalance[] {
  return [...applyStockEvents(events, options).values()].sort(
    (a, b) =>
      a.site.localeCompare(b.site) ||
      a.family.localeCompare(b.family, "fr") ||
      a.name.localeCompare(b.name, "fr"),
  );
}

/** Dédoublonne un flux par clé d'idempotence (même règle que la persistance). */
export function dedupeStockEvents(
  events: readonly StockEvent[],
): StockEvent[] {
  const seen = new Set<string>();
  const out: StockEvent[] = [];
  for (const event of events) {
    const key = `${event.site}:${event.idempotencyKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(event);
  }
  return out;
}
