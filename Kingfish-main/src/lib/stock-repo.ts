import { getParametres } from "@/lib/parametres-repo";
import { computeGbegameyDay, computeLocalLine } from "@/lib/gbegamey-calc";
import {
  computeZogboDay,
} from "@/lib/zogbo-calc";
import {
  physicalBoissonsStockForSite,
  DEFAULT_UNITS_PER_CASIER,
} from "@/lib/boissons-calc";
import { computeMatieresDay } from "@/lib/matieres-calc";
import { getGbegameyDayPayload } from "@/lib/gbegamey-repo";
import { getZogboDayPayload } from "@/lib/zogbo-repo";
import { getBoissonsDayPayload } from "@/lib/boissons-repo";
import { getMatieresDayPayload } from "@/lib/matieres-repo";
import type { VenteSite } from "@/lib/types";
import {
  type StockFamily,
  type StockKind,
  type StockZone,
  stockKindHasRuptureAlerts,
} from "@/lib/stock-meta";
import { isValidDate } from "@/lib/day-doc";

export {
  STOCK_FAMILY_META,
  zoneFamily,
} from "@/lib/stock-meta";
export type {
  StockFamily,
  StockKind,
  StockZone,
} from "@/lib/stock-meta";

const ZONE_LABELS: Record<StockZone, string> = {
  "zogbo-plats": "Zogbo · plats",
  "zogbo-accompagnements": "Zogbo · accompagnements",
  "gbegamey-plats": "Gbégamey · plats reçus",
  "gbegamey-accompagnements": "Gbégamey · accompagnements",
  "zogbo-boissons": "Boissons · Zogbo",
  "gbegamey-boissons": "Boissons · Gbégamey",
  matieres: "Matières premières",
};

export type StockRow = {
  zone: StockZone;
  zoneLabel: string;
  productId: string;
  name: string;
  kind: StockKind;
  /** Solde d'ouverture du jour (report veille ou inventaire). */
  opening: number;
  /** Entrées du jour : préparé, reçu ou acheté (converti dans l'unité de la ligne). */
  entrees: number;
  /** Envoyé vers Gbégamey (plats préparés à Zogbo). */
  envoye: number;
  /** Sorties par la vente (consommation déclarée pour les matières). */
  vendu: number;
  pertes: number;
  /** Théorique reconstruit depuis les mouvements : ouverture + entrées − envoyé − vendu − pertes. */
  theorique: number;
  /** Reste en fin de journée (le comptage prévaut quand il existe). */
  stockFinal: number;
  /** Stock encore vendable sur place (null pour les matières). */
  stockVendable: number | null;
  compte: number | null;
  /** Écart d'inventaire : compté − théorique (null sans comptage). */
  ecart: number | null;
  unit: string;
  /** Seuil de réapprovisionnement (matières, boissons) ; null sinon. */
  threshold: number | null;
  belowThreshold: boolean;
};

export type StockZoneTotal = {
  zone: StockZone;
  zoneLabel: string;
  lignes: number;
  stockFinal: number;
  stockVendable: number | null;
  vendu: number;
  ecarts: number;
};

export type StockPayload = {
  date: string;
  scopeSite: VenteSite | null;
  families: StockFamily[];
  rows: StockRow[];
  totalsByZone: StockZoneTotal[];
  dayStatus: {
    zogbo: string | null;
    gbegamey: string | null;
    boissons?: string | null;
    matieres?: string | null;
  };
};

export type EpuiseRow = {
  zone: StockZone;
  zoneLabel: string;
  productId: string;
  name: string;
  kind: StockKind;
  restant: number;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Produits épuisés pour une journée : plus rien à vendre en fin de journée
 * (stockVendable nul à Zogbo, reste théorique nul partout ailleurs).
 * Le catalogue complet est requis (onlyActive=false) : un produit à zéro
 * n'a par définition aucune ligne « active » à signaler.
 */
export async function getEpuises(input: {
  date: string;
  scopeSite?: VenteSite | null;
}): Promise<EpuiseRow[]> {
  const { rows } = await getStockPayload({
    date: input.date,
    scopeSite: input.scopeSite,
    onlyActive: false,
    // Le tableau de bord ne liste que le vendable cuisine/salle : les
    // matières premières n'y ont pas leur place.
    // Plats uniquement : les accompagnements ne déclenchent pas d'alerte.
    families: ["plats"],
  });
  return rows
    .map((r) => ({
      zone: r.zone,
      zoneLabel: r.zoneLabel,
      productId: r.productId,
      name: r.name,
      kind: r.kind,
      // Le comptage saisi prévaut : reste = compté − vendu, exactement la
      // même règle que le contrôle de vente (un produit compté 3 puis vendu
      // 3 est épuisé, malgré un comptage brut positif).
      stock:
        r.compte !== null
          ? r.compte - r.vendu
          : (r.stockVendable ?? r.stockFinal),
    }))
    .filter((r) => r.stock <= 0 && stockKindHasRuptureAlerts(r.kind))
    .map(({ stock, ...e }) => ({ ...e, restant: stock }))
    .sort(
      (a, b) =>
        a.zoneLabel.localeCompare(b.zoneLabel, "fr") ||
        a.name.localeCompare(b.name, "fr"),
    );
}

/** Ouverture brute (peut être négative si survente : c'est voulu, ça alerte). */
function zogboOpeningStock(line: {
  stock: number;
  prepared: number;
  sentToGbegamey: number;
}): number {
  return line.stock - line.prepared + line.sentToGbegamey;
}

function hasActivity(row: Omit<StockRow, "zone" | "zoneLabel" | "kind">): boolean {
  return (
    row.opening > 0 ||
    row.opening < 0 ||
    row.entrees > 0 ||
    row.envoye > 0 ||
    row.vendu > 0 ||
    row.pertes > 0 ||
    row.stockFinal !== 0 ||
    (row.stockVendable !== null && row.stockVendable !== 0) ||
    row.theorique < 0 ||
    row.compte !== null
  );
}

function pushRow(rows: StockRow[], row: StockRow, onlyActive: boolean) {
  if (!onlyActive || hasActivity(row)) rows.push(row);
}

function buildZoneTotals(rows: StockRow[]): StockZoneTotal[] {
  const byZone = new Map<StockZone, StockZoneTotal>();
  for (const row of rows) {
    const existing = byZone.get(row.zone) ?? {
      zone: row.zone,
      zoneLabel: row.zoneLabel,
      lignes: 0,
      stockFinal: 0,
      stockVendable: row.stockVendable !== null ? 0 : null,
      vendu: 0,
      ecarts: 0,
    };
    existing.lignes += 1;
    existing.stockFinal += row.stockFinal;
    if (existing.stockVendable !== null && row.stockVendable !== null) {
      existing.stockVendable += row.stockVendable;
    }
    existing.vendu += row.vendu;
    if (row.ecart !== null && Math.abs(row.ecart) > 1) existing.ecarts += 1;
    byZone.set(row.zone, existing);
  }
  return [...byZone.values()].sort((a, b) =>
    a.zoneLabel.localeCompare(b.zoneLabel, "fr"),
  );
}

/** Écart d'inventaire : ce qui est compté moins ce que les mouvements prévoient. */
function ecartDe(compte: number | null, theorique: number): number | null {
  if (compte === null || compte === undefined) return null;
  return round2(compte - theorique);
}

export async function getStockPayload(input: {
  date: string;
  scopeSite?: VenteSite | null;
  /** false = tout le catalogue ; true = lignes avec stock ou mouvement */
  onlyActive?: boolean;
  /**
   * Familles à inclure. Par défaut plats + accompagnements (comportement
   * historique, consommé par le tableau « épuisés » de la synthèse) ;
   * la page Stock demande explicitement tout.
   */
  families?: StockFamily[];
}): Promise<StockPayload> {
  const { date, scopeSite = null, onlyActive = true } = input;
  if (!isValidDate(date)) throw new Error("Date invalide (attendu YYYY-MM-DD)");

  const wanted = new Set<StockFamily>(
    input.families ?? ["plats", "accompagnements"],
  );

  const parametres = await getParametres();
  const priceLocal = new Map(
    parametres.localDishes.map((d) => [d.id, d.unitPrice]),
  );

  const rows: StockRow[] = [];
  let zogboStatus: string | null = null;
  let gbegameyStatus: string | null = null;
  let boissonsStatus: string | null = null;
  let matieresStatus: string | null = null;

  if (scopeSite !== "gbegamey") {
    const { day } = await getZogboDayPayload(date);
    zogboStatus = day.status;
    const computed = computeZogboDay(day, parametres.baseDishes);

    if (wanted.has("plats")) {
      for (const line of computed.lines) {
        const opening = zogboOpeningStock(line);
        const theorique =
          opening - line.sentToGbegamey + line.prepared - line.sold - line.pertes;
        const row: StockRow = {
          zone: "zogbo-plats",
          zoneLabel: ZONE_LABELS["zogbo-plats"],
          productId: line.productId,
          name: line.name,
          kind: "plat",
          opening,
          entrees: line.prepared,
          envoye: line.sentToGbegamey,
          vendu: line.sold,
          pertes: line.pertes,
          theorique,
          stockFinal: line.theoreticalRemaining,
          stockVendable: line.prevalentRemaining,
          compte: line.counted,
          ecart: ecartDe(line.counted, theorique),
          unit: "portions",
          threshold: null,
          belowThreshold: false,
        };
        pushRow(rows, row, onlyActive);
      }
    }

    if (wanted.has("accompagnements")) {
      const accLines = day.accompanimentLines ?? [];
      for (const raw of accLines) {
        const line = computeLocalLine(
          raw,
          priceLocal.get(raw.productId) ?? 0,
        );
        const theorique =
          line.initialStock + line.prepared - line.sold - line.pertes;
        const row: StockRow = {
          zone: "zogbo-accompagnements",
          zoneLabel: ZONE_LABELS["zogbo-accompagnements"],
          productId: line.productId,
          name: line.name,
          kind: "local",
          opening: line.initialStock,
          entrees: line.prepared,
          envoye: 0,
          vendu: line.sold,
          pertes: line.pertes,
          theorique,
          stockFinal: line.theoreticalRemaining,
          stockVendable: line.theoreticalRemaining,
          compte: line.counted,
          ecart: ecartDe(line.counted, theorique),
          unit: "portions",
          threshold: null,
          belowThreshold: false,
        };
        pushRow(rows, row, onlyActive);
      }
    }
  }

  if (scopeSite !== "zogbo") {
    const gb = await getGbegameyDayPayload(date);
    gbegameyStatus = gb.day.status;
    const computed = computeGbegameyDay(
      gb.day,
      parametres.baseDishes,
      parametres.localDishes,
      new Map(Object.entries(gb.sentByProductId)),
    );

    if (wanted.has("plats")) {
      for (const line of computed.transfers) {
        const theorique =
          line.initialStock +
          line.receivedFromZogbo -
          line.sold -
          line.pertes;
        const row: StockRow = {
          zone: "gbegamey-plats",
          zoneLabel: ZONE_LABELS["gbegamey-plats"],
          productId: line.productId,
          name: line.name,
          kind: "plat",
          opening: line.initialStock,
          entrees: line.receivedFromZogbo,
          envoye: 0,
          vendu: line.sold,
          pertes: line.pertes,
          theorique,
          stockFinal: line.theoreticalRemaining,
          stockVendable: line.theoreticalRemaining,
          compte: line.counted,
          ecart: ecartDe(line.counted, theorique),
          unit: "portions",
          threshold: null,
          belowThreshold: false,
        };
        pushRow(rows, row, onlyActive);
      }
    }

    if (wanted.has("accompagnements")) {
      for (const line of computed.locals) {
        const theorique =
          line.initialStock + line.prepared - line.sold - line.pertes;
        const row: StockRow = {
          zone: "gbegamey-accompagnements",
          zoneLabel: ZONE_LABELS["gbegamey-accompagnements"],
          productId: line.productId,
          name: line.name,
          kind: "local",
          opening: line.initialStock,
          entrees: line.prepared,
          envoye: 0,
          vendu: line.sold,
          pertes: line.pertes,
          theorique,
          stockFinal: line.theoreticalRemaining,
          stockVendable: line.theoreticalRemaining,
          compte: line.counted,
          ecart: ecartDe(line.counted, theorique),
          unit: "portions",
          threshold: null,
          belowThreshold: false,
        };
        pushRow(rows, row, onlyActive);
      }
    }
  }

  if (wanted.has("boissons")) {
    const { day, drinks } = await getBoissonsDayPayload(date);
    boissonsStatus = day.status;

    const sites: VenteSite[] =
      scopeSite === null ? ["zogbo", "gbegamey"] : [scopeSite];
    for (const site of sites) {
      const isZogbo = site === "zogbo";
      for (const line of day.lines) {
        const drink = drinks.find((d) => d.id === line.productId);
        const upc = Math.max(
          1,
          Math.round(drink?.unitsPerCasier || DEFAULT_UNITS_PER_CASIER),
        );
        const initial = isZogbo ? line.initialStockZogbo : line.initialStockGbegamey;
        const purchases = isZogbo ? line.purchasesZogbo : line.purchasesGbegamey;
        const sold = isZogbo ? line.soldZogbo : line.soldGbegamey;
        const pertes = Math.max(
          0,
          isZogbo ? line.pertesZogbo : line.pertesGbegamey,
        );
        const countedRaw = isZogbo ? line.countedZogbo : line.countedGbegamey;
        const counted =
          countedRaw === null || countedRaw === undefined ? null : Math.max(0, Number(countedRaw) || 0);
        const openingBt = round2(initial * upc);
        const entreesBt = round2(purchases * upc);
        const theorique = round2(openingBt + entreesBt - sold - pertes);
        const finalBt = physicalBoissonsStockForSite(line, site, upc);
        const threshold =
          drink?.alertThreshold && drink.alertThreshold > 0
            ? drink.alertThreshold
            : null;
        const row: StockRow = {
          zone: isZogbo ? "zogbo-boissons" : "gbegamey-boissons",
          zoneLabel: isZogbo
            ? ZONE_LABELS["zogbo-boissons"]
            : ZONE_LABELS["gbegamey-boissons"],
          productId: line.productId,
          name: line.name,
          kind: "boisson",
          opening: openingBt,
          entrees: entreesBt,
          envoye: 0,
          vendu: sold,
          pertes,
          theorique,
          stockFinal: finalBt,
          stockVendable: finalBt,
          compte: counted,
          ecart: ecartDe(counted, theorique),
          unit: "bt",
          threshold,
          belowThreshold:
            threshold !== null &&
            threshold > 0 &&
            finalBt <= threshold &&
            (openingBt > 0 || entreesBt > 0 || sold > 0),
        };
        pushRow(rows, row, onlyActive);
      }
    }
  }

  if (wanted.has("matieres") && scopeSite !== "gbegamey") {
    const { day, materials } = await getMatieresDayPayload(date);
    matieresStatus = day.status;
    const computed = computeMatieresDay(day, materials);

    for (const line of computed.lines) {
      const theorique =
        line.initialStock + line.purchases - line.consumed - line.pertes;
      const row: StockRow = {
        zone: "matieres",
        zoneLabel: ZONE_LABELS.matieres,
        productId: line.productId,
        name: line.name,
        kind: "matiere",
        opening: line.initialStock,
        entrees: line.purchases,
        envoye: 0,
        vendu: line.consumed,
        pertes: line.pertes,
        theorique,
        stockFinal: line.stock,
        stockVendable: null,
        compte: line.counted,
        ecart: ecartDe(line.counted, theorique),
        unit: line.unit || "u",
        threshold: line.threshold > 0 ? line.threshold : null,
        belowThreshold: line.belowThreshold,
      };
      pushRow(rows, row, onlyActive);
    }
  }

  return {
    date,
    scopeSite,
    families: [...wanted],
    rows,
    totalsByZone: buildZoneTotals(rows),
    dayStatus: {
      zogbo: zogboStatus,
      gbegamey: gbegameyStatus,
      boissons: boissonsStatus,
      matieres: matieresStatus,
    },
  };
}
