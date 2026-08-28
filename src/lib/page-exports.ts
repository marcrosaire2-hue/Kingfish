import { computeBoissonsDay } from "@/lib/boissons-calc";
import {
  downloadExcel,
  excelFilename,
  type ExcelSheet,
} from "@/lib/export-excel";
import type {
  JournalBalanceRow,
  JournalRow,
  JournalTotals,
} from "@/lib/journal-stock-repo";
import {
  computeTransferLine,
  computeLocalLine,
} from "@/lib/gbegamey-calc";
import { formatActorLabel, HISTORIQUE_KIND_LABELS } from "@/lib/historique-types";
import type { HistoriqueEvent } from "@/lib/historique-types";
import type {
  CompteGrandLivre,
  EcritureComptable,
  LigneBalance,
} from "@/lib/journal-comptable-calc";
import type { Bilan } from "@/lib/bilan-repo";
import type {
  BaseDish,
  BoissonsDay,
  CaisseKey,
  CaisseMouvement,
  CaisseOverviewItem,
  CaisseSession,
  Drink,
  GbegameyDay,
  LocalDish,
  Parametres,
  PerteEntry,
  VenteLogEntry,
  VenteProduct,
  VenteSite,
  ZogboDay,
} from "@/lib/types";
import { CAISSE_LABELS, soldeTheorique } from "@/lib/caisse-model";
import { PERTE_MOTIF_LABELS } from "@/lib/types";
import { computeZogboDay } from "@/lib/zogbo-calc";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(
      (body as { error?: string })?.error || `Erreur export (${res.status})`,
    );
  }
  return body as T;
}

/** Familles de produits : l'export doit être lisible, pas refléter les clés. */
const KIND_LABELS: Record<string, string> = {
  plat: "Plat",
  local: "Sur place",
  boisson: "Boisson",
  extra: "Vente libre",
  matiere: "Matière",
  immobilisation: "Emballage / Actif",
  libre: "Achat hors-catalogue",
};

function kindLabel(kind: string | null | undefined): string {
  return KIND_LABELS[String(kind ?? "")] ?? String(kind ?? "—");
}

/** Horodatage ISO → heure lisible (14:35). */
function heureLisible(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function siteLabel(site: string | null | undefined): string {
  if (site === "zogbo") return "Zogbo";
  if (site === "gbegamey") return "Gbégamey";
  if (site === "tous") return "Tous";
  return site || "—";
}

/** Jour comptable puis horodatage ISO — ordre chronologique croissant. */
export function compareVenteChronology(
  a: { date: string; at: string },
  b: { date: string; at: string },
): number {
  const byDate = a.date.localeCompare(b.date);
  if (byDate !== 0) return byDate;
  return String(a.at).localeCompare(String(b.at));
}

function sortVentesChronologically<
  T extends { date: string; at: string },
>(items: T[]): T[] {
  return [...items].sort(compareVenteChronology);
}

/** Paramètres — catalogues */
export function exportParametresExcel(data: Parametres): void {
  const sheets: ExcelSheet[] = [
    {
      name: "Plats de base",
      rows: data.baseDishes.map((d) => ({
        Id: d.id,
        Nom: d.name,
        "Prix unitaire (FCFA)": d.unitPrice,
        "Prix de revient": d.costPrice ?? "",
      })),
    },
    {
      name: "Boissons",
      rows: data.drinks.map((d) => ({
        Id: d.id,
        Nom: d.name,
        "Bt / casier": d.unitsPerCasier,
        "PA / bt (FCFA)": d.purchasePrice,
        "PV / bt (FCFA)": d.salePrice ?? "",
        "Marge / bt":
          d.salePrice === null ? "" : d.salePrice - d.purchasePrice,
      })),
    },
    {
      name: "Plats locaux",
      rows: data.localDishes.map((d) => ({
        Id: d.id,
        Nom: d.name,
        "Prix (FCFA)": d.unitPrice,
        "Prix de revient": d.costPrice ?? "",
      })),
    },
    {
      name: "Matières",
      rows: (data.rawMaterials ?? []).map((m) => ({
        Id: m.id,
        Nom: m.name,
        Unité: m.unit,
        "Prix achat": m.purchasePrice,
        Seuil: m.threshold,
        Bloquant: m.stockBlocking ? "Oui" : "Non",
      })),
    },
  ];
  downloadExcel(excelFilename("parametres"), sheets);
}

/** Zogbo — plats + boissons du jour */
export async function exportZogboExcel(date: string): Promise<void> {
  const [zogbo, boissons] = await Promise.all([
    fetchJson<{ day: ZogboDay; baseDishes: BaseDish[] }>(
      `/api/zogbo?date=${encodeURIComponent(date)}`,
    ),
    fetchJson<{ day: BoissonsDay; drinks: Drink[] }>(
      `/api/boissons?date=${encodeURIComponent(date)}&site=zogbo`,
    ),
  ]);

  const z = computeZogboDay(zogbo.day, zogbo.baseDishes);
  const b = computeBoissonsDay(boissons.day, boissons.drinks);

  const sheets: ExcelSheet[] = [
    {
      name: "Plats",
      rows: z.lines.map((l) => ({
        Plat: l.name,
        Stock: l.stock,
        Préparé: l.prepared,
        "Envoyé Gbégamey": l.sentToGbegamey,
        Vendu: l.sold,
        "Stock actuel": l.theoreticalRemaining,
        "Compté (stock initial)": l.counted ?? "",
        "PU (FCFA)": l.unitPrice,
        "CA (FCFA)": l.soldAmount,
        Observations: l.observations,
      })),
    },
    {
      name: "Mouvements plats",
      rows: z.movements.map((m) => ({
        Heure: m.at,
        Type: m.type === "prepare" ? "Préparation" : "Envoi",
        Plat: m.name,
        Qté: m.qty,
        "Stock après": m.stockAfter,
        Annulé: m.cancelledAt ? "oui" : "",
      })),
    },
    {
      name: "Boissons",
      rows: b.lines.map((l) => ({
        Boisson: l.name,
        "Contenance (bt/casier)": l.unitsPerCasier,
        "Init (bt)": Math.round(l.initialStockZogbo * l.unitsPerCasier),
        "Achats (bt)": Math.round(l.purchasesZogbo * l.unitsPerCasier),
        "Vendu Zogbo (bt)": l.soldZogbo,
        "Stock (bt)": Math.round(
          Math.max(0, l.theoreticalRemainingZogbo) * l.unitsPerCasier,
        ),
        "PA/bt": l.purchasePrice,
        "PV/bt": l.salePrice ?? "",
        Compté: l.countedZogbo ?? "",
      })),
    },
  ];

  downloadExcel(excelFilename("zogbo", date), sheets);
}

/** Gbégamey — reçu + locaux + boissons */
export async function exportGbegameyExcel(date: string): Promise<void> {
  const [gbe, boissons] = await Promise.all([
    fetchJson<{
      day: GbegameyDay;
      baseDishes: BaseDish[];
      localDishes: LocalDish[];
      sentByProductId: Record<string, number>;
    }>(`/api/gbegamey?date=${encodeURIComponent(date)}`),
    fetchJson<{ day: BoissonsDay; drinks: Drink[] }>(
      `/api/boissons?date=${encodeURIComponent(date)}&site=gbegamey`,
    ),
  ]);

  const priceById = new Map(gbe.baseDishes.map((d) => [d.id, d.unitPrice]));
  const localPrice = new Map(gbe.localDishes.map((d) => [d.id, d.unitPrice]));
  const transfer = gbe.day.transferLines.map((l) =>
    computeTransferLine(
      l,
      gbe.sentByProductId[l.productId] ?? 0,
      priceById.get(l.productId) ?? 0,
    ),
  );
  const local = gbe.day.localLines.map((l) =>
    computeLocalLine(l, localPrice.get(l.productId) ?? 0),
  );
  const b = computeBoissonsDay(boissons.day, boissons.drinks);

  const sheets: ExcelSheet[] = [
    {
      name: "Plats",
      rows: transfer.map((l) => ({
        Plat: l.name,
        "Stock init.": l.initialStock,
        "Envoyé Zogbo": l.sentFromZogbo,
        Reçu: l.receivedFromZogbo,
        Vendu: l.sold,
        Dispo: l.available,
        "Reste théorique": l.theoreticalRemaining,
        Compté: l.counted ?? "",
        Écart: l.variance ?? "",
        "PU (FCFA)": l.unitPrice,
        "CA (FCFA)": l.soldAmount,
        Observations: l.observations,
      })),
    },
    {
      name: "Sur place",
      rows: local.map((l) => ({
        Plat: l.name,
        "Stock init.": l.initialStock,
        Préparé: l.prepared,
        Vendu: l.sold,
        Dispo: l.available,
        "Reste théorique": l.theoreticalRemaining,
        Compté: l.counted ?? "",
        Écart: l.variance ?? "",
        "PU (FCFA)": l.unitPrice,
        "CA (FCFA)": l.soldAmount,
        Observations: l.observations,
      })),
    },
    {
      name: "Boissons",
      rows: b.lines.map((l) => ({
        Boisson: l.name,
        "Contenance (bt/casier)": l.unitsPerCasier,
        "Init (bt)": Math.round(l.initialStockGbegamey * l.unitsPerCasier),
        "Achats (bt)": Math.round(l.purchasesGbegamey * l.unitsPerCasier),
        "Vendu Gbégamey (bt)": l.soldGbegamey,
        "Stock (bt)": Math.round(
          Math.max(0, l.theoreticalRemainingGbegamey) * l.unitsPerCasier,
        ),
        "PV/bt": l.salePrice ?? "",
        Compté: l.countedGbegamey ?? "",
      })),
    },
  ];

  downloadExcel(excelFilename("gbegamey", date), sheets);
}

/** Vente — board + journal du jour / site */
export async function exportVenteExcel(
  date: string,
  site: VenteSite,
): Promise<void> {
  const board = await fetchJson<{
    date: string;
    site: VenteSite;
    products: VenteProduct[];
    recent: VenteLogEntry[];
    caToday: number;
    caParEquipe?: Record<string, number>;
  }>(
    `/api/vente?date=${encodeURIComponent(date)}&site=${encodeURIComponent(site)}&limit=500`,
  );

  const sheets: ExcelSheet[] = [
    {
      name: "Produits",
      subtitle: `${siteLabel(site)} · ${date}`,
      totals: ["Vendu aujourd’hui"],
      rows: board.products.map((p) => ({
        Famille: kindLabel(p.kind),
        Produit: p.name,
        "PU (FCFA)": p.unitPrice,
        "Vendu aujourd’hui": p.soldToday,
        "Stock restant": p.stockLeft ?? "",
        Info: p.hint ?? "",
      })),
    },
    {
      name: "Journal",
      subtitle: `${siteLabel(site)} · ${date}`,
      totals: ["Qté", "Montant (FCFA)"],
      rows: sortVentesChronologically(
        board.recent.map((e) => ({
          date: e.date || date,
          at: e.at,
          row: {
            Date: e.date || date,
            Site: siteLabel(e.site || site),
            Heure: heureLisible(e.at),
            Famille: kindLabel(e.kind),
            Produit: e.name,
            Qté: e.qty,
            "PU (FCFA)": e.unitPrice,
            "Montant (FCFA)": e.amount,
          },
        })),
      ).map((e) => e.row),
    },
    {
      name: "Synthèse",
      subtitle: `${siteLabel(site)} · ${date}`,
      rows: [
        {
          Date: date,
          Zone: siteLabel(site),
          "CA (FCFA)": board.caToday,
          "CA équipe de jour (FCFA)": board.caParEquipe?.jour ?? 0,
          "CA équipe de nuit (FCFA)": board.caParEquipe?.nuit ?? 0,
          "CA hors équipe (FCFA)": board.caParEquipe?.aucune ?? 0,
          "Produits au catalogue": board.products.length,
          "Lignes au journal": board.recent.length,
        },
      ],
    },
  ];

  downloadExcel(excelFilename("vente", date, site), sheets);
}

const STOCK_KIND_LABELS: Record<string, string> = {
  plat: "Plat",
  local: "Accompagnement",
  boisson: "Boisson",
  matiere: "Matière première",
};

/** Stock final par zone (toutes familles : plats, accompagnements, boissons, matières). */
export function exportStockExcel(
  data: import("@/lib/stock-repo").StockPayload,
): void {
  const rows = data.rows.map((row) => ({
    Zone: row.zoneLabel,
    Produit: row.name,
    Type: STOCK_KIND_LABELS[row.kind] ?? row.kind,
    Unité: row.unit === "portions" ? "" : row.unit,
    Ouverture: row.opening,
    Entrées: row.entrees,
    "Envoyé Gbé": row.envoye || "",
    Vendu: row.vendu,
    Pertes: row.pertes,
    Théorique: row.theorique,
    "Stock final": row.stockFinal,
    Vendable: row.stockVendable ?? "",
    Compté: row.compte ?? "",
    Écart: row.ecart ?? "",
    Seuil: row.threshold ?? "",
  }));

  const synthèse = data.totalsByZone.map((t) => ({
    Zone: t.zoneLabel,
    Lignes: t.lignes,
    "Stock final": t.stockFinal,
    Vendable: t.stockVendable ?? "",
    Vendu: t.vendu,
    "Écarts inventaire": t.ecarts,
  }));

  downloadExcel(
    excelFilename("stock", data.date, data.scopeSite ?? "all"),
    [
      {
        name: "Stock final",
        subtitle: `${data.date} · ${data.scopeSite ?? "tous sites"}`,
        rows,
      },
      { name: "Par zone", rows: synthèse },
    ],
  );
}

/** Tableau de bord / synthèse */
export async function exportSyntheseExcel(input: {
  view: "day" | "month" | "year";
  date?: string;
  month?: string;
  year?: string;
}): Promise<void> {
  const params = new URLSearchParams({ view: input.view });
  if (input.view === "day" && input.date) params.set("date", input.date);
  if (input.view === "month" && input.month) params.set("month", input.month);
  if (input.view === "year" && input.year) params.set("year", input.year);

  const body = await fetchJson<Record<string, unknown>>(
    `/api/synthese?${params}`,
  );

  const sheets: ExcelSheet[] = [];

  if (body.view === "day" && body.day && typeof body.day === "object") {
    const d = body.day as Record<string, unknown>;
    sheets.push({
      name: "Jour",
      rows: [
        {
          Date: String(d.date ?? input.date ?? ""),
          "CA Zogbo plats": Number(d.caZogboPlats) || 0,
          "CA Zogbo accompagnements": Number(d.caAccompagnementsZogbo) || 0,
          "CA Zogbo boissons": Number(d.caBoissonsZogbo) || 0,
          "CA Zogbo extra": Number(d.caExtraZogbo) || 0,
          "CA Zogbo total": Number(d.caZogbo) || 0,
          "CA Gbégamey plats": Number(d.caGbegameyPlats) || 0,
          "CA Gbégamey accompagnements":
            Number(d.caAccompagnementsGbegamey) || 0,
          "CA Gbégamey boissons": Number(d.caBoissonsGbegamey) || 0,
          "CA Gbégamey extra": Number(d.caExtraGbegamey) || 0,
          "CA Gbégamey total": Number(d.caGbegamey) || 0,
          "CA total": Number(d.caTotal) || 0,
          "Marge boissons": Number(d.margeBoissons) || 0,
          Charges: Number(d.chargesTotal) || 0,
          Résultat: Number(d.resultat) || 0,
        },
      ],
    });
    const charges = d.charges as Record<string, number> | undefined;
    if (charges) {
      sheets.push({
        name: "Charges",
        rows: [
          {
            "Matières premières": charges.matieresPremieres ?? 0,
            Loyer: charges.loyer ?? 0,
            Salaires: charges.salaires ?? 0,
            Électricité: charges.electricite ?? 0,
            Carburant: charges.carburant ?? 0,
            Réparations: charges.reparations ?? 0,
          },
        ],
      });
    }
    downloadExcel(excelFilename("synthese_jour", input.date), sheets);
    return;
  }

  if (body.view === "month" && body.month && typeof body.month === "object") {
    const m = body.month as {
      days?: Array<Record<string, unknown>>;
      totals?: Record<string, number>;
    };
    sheets.push({
      name: "Filtres",
      rows: [
        {
          Vue: "Mois",
          Période: input.month ?? "",
          "Nb jours": (m.days ?? []).length,
        },
      ],
    });
    sheets.push({
      name: "Jours",
      rows: (m.days ?? []).map((d) => ({
        Date: String(d.date ?? ""),
        "CA Zogbo": Number(d.caZogbo) || 0,
        "CA Gbégamey": Number(d.caGbegamey) || 0,
        "CA total": Number(d.caTotal) || 0,
        Charges: Number(d.chargesTotal) || 0,
        Résultat: Number(d.resultat) || 0,
      })),
    });
    if (m.totals) {
      sheets.push({
        name: "Totaux mois",
        rows: [
          {
            "CA Zogbo": m.totals.caZogbo ?? 0,
            "CA Gbégamey": m.totals.caGbegamey ?? 0,
            "CA total": m.totals.caTotal ?? 0,
            Charges: m.totals.chargesTotal ?? 0,
            Résultat: m.totals.resultat ?? 0,
          },
        ],
      });
    }
    downloadExcel(excelFilename("synthese_mois", input.month), sheets);
    return;
  }

  if (body.view === "year" && body.year && typeof body.year === "object") {
    const y = body.year as {
      year?: number;
      months?: Array<Record<string, unknown>>;
      totals?: Record<string, number>;
    };
    const yearNum = y.year ?? Number(input.year) ?? "";
    sheets.push({
      name: "Mois",
      rows: (y.months ?? []).map((m) => ({
        Année: yearNum,
        Mois: Number(m.month) || 0,
        "CA total": Number(m.caTotal) || 0,
        Charges: Number(m.chargesTotal) || 0,
        Résultat: Number(m.resultat) || 0,
      })),
    });
    if (y.totals) {
      sheets.push({
        name: "Totaux année",
        rows: [
          {
            Année: yearNum,
            "CA total": y.totals.caTotal ?? 0,
            Charges: y.totals.chargesTotal ?? 0,
            Résultat: y.totals.resultat ?? 0,
          },
        ],
      });
    }
    downloadExcel(excelFilename("synthese_annee", String(yearNum)), sheets);
    return;
  }

  throw new Error("Données de synthèse invalides");
}

/** Registre / historique filtré (période + zone) */
export function exportHistoriqueExcel(
  events: HistoriqueEvent[],
  from: string,
  to: string,
  site: string = "all",
): void {
  const sheets: ExcelSheet[] = [
    {
      name: "Filtres",
      rows: [
        {
          Du: from,
          Au: to,
          Zone: siteLabel(site === "all" ? "tous" : site),
          "Nb événements": events.length,
        },
      ],
    },
    {
      name: "Registre",
      rows: events.map((ev) => ({
        Quand: ev.at,
        Type: HISTORIQUE_KIND_LABELS[ev.kind] ?? ev.kind,
        Site: siteLabel(ev.site),
        "Date métier": ev.date ?? "",
        Titre: ev.title,
        Détail: ev.detail,
        Acteur: formatActorLabel(ev),
        "Identifiant compte": ev.actorUsername ?? "",
        "Id compte": ev.actorId ?? "",
        "Montant (FCFA)": ev.amount ?? "",
      })),
    },
  ];
  downloadExcel(
    excelFilename("registre", from, to, site === "all" ? "tous" : site),
    sheets,
  );
}

const STATUT_LABEL: Record<string, string> = {
  valide: "Validé",
  annule: "Annulé",
  encours: "En cours",
  all: "Tous",
};

const SOURCE_LABEL: Record<string, string> = {
  kingfish: "King Fish",
  aquapro: "Importé",
  all: "Toutes",
};

/** Historique des ventes — articles vendus (sans numéros de ticket). */
export function exportHistoriqueVentesExcel(input: {
  tickets: Array<{
    numero: string;
    date: string;
    at: string;
    site: string;
    statut: string;
    statutLabel: string;
    source: string;
    typeVente: string;
    montant: number;
    reduction: number;
    paiement: string | null;
    serveur: string | null;
    caissier: string | null;
    client: string | null;
    table: string | null;
    lines: Array<{
      name: string;
      qty: number;
      unitPrice: number;
      amount: number;
    }>;
  }>;
  totals: {
    count: number;
    montant: number;
    valide: number;
    annule: number;
    encours: number;
  };
  from: string;
  to: string;
  site: string;
  statut?: string;
  source?: string;
  serveur?: string;
  paiement?: string;
  q?: string;
}): void {
  const zone = input.site === "all" ? "tous" : input.site;
  const periode = `${siteLabel(zone)} · du ${input.from} au ${input.to}`;
  const tickets = sortVentesChronologically(input.tickets);
  const articleRows = tickets.flatMap((t) =>
    t.lines.map((l) => ({
      Date: t.date,
      Heure: heureLisible(t.at),
      Zone: siteLabel(t.site),
      Statut: t.statutLabel || STATUT_LABEL[t.statut] || t.statut,
      Source: SOURCE_LABEL[t.source] ?? t.source,
      Type: t.typeVente,
      Article: l.name,
      Qté: l.qty,
      "PU (FCFA)": l.unitPrice,
      "Montant (FCFA)": l.amount,
      Serveur: t.serveur ?? "",
      Caissier: t.caissier ?? "",
      Client: t.client ?? "",
      Paiement: t.paiement ?? "",
    })),
  );
  const sheets: ExcelSheet[] = [
    {
      name: "Filtres",
      subtitle: periode,
      rows: [
        {
          Du: input.from,
          Au: input.to,
          Zone: siteLabel(zone),
          Statut: STATUT_LABEL[input.statut ?? "all"] ?? input.statut ?? "Tous",
          Source: SOURCE_LABEL[input.source ?? "all"] ?? input.source ?? "Toutes",
          Serveur: input.serveur?.trim() || "Tous",
          Paiement: input.paiement?.trim() || "Tous",
          Recherche: input.q?.trim() || "",
          "Commandes exportées": input.totals.count,
          "Lignes articles": articleRows.length,
          "CA affiché (FCFA)": input.totals.montant,
        },
      ],
    },
    {
      name: "Articles",
      subtitle: periode,
      totals: ["Qté", "Montant (FCFA)"],
      rows: articleRows,
    },
    {
      name: "Totaux",
      subtitle: periode,
      rows: [
        {
          Commandes: input.totals.count,
          "Lignes articles": articleRows.length,
          Validés: input.totals.valide,
          Annulés: input.totals.annule,
          "En cours": input.totals.encours,
          "Montant (FCFA)": input.totals.montant,
        },
      ],
    },
  ];

  downloadExcel(
    excelFilename("historique_ventes", input.from, input.to, zone),
    sheets,
  );
}

type HistoriqueVentesExportTicket = Parameters<
  typeof exportHistoriqueVentesExcel
>[0]["tickets"][number];

/**
 * Export Excel de TOUTES les ventes de la période (et filtres courants),
 * sans la limite d'affichage : relit l'API avec `limit=all`.
 * Feuille principale = articles (noms), sans numéros de ticket.
 */

/** Quantités vendues par article sur une période. */
export function exportQuantitesVenduesExcel(
  data: import("@/lib/quantites-vendues-repo").QuantitesVenduesPayload,
): void {
  const zone = data.site === "all" ? "tous" : data.site;
  const periode = `${siteLabel(zone)} · du ${data.from} au ${data.to}`;
  const showSites = data.site === "all";
  downloadExcel(excelFilename("quantites_vendues", data.from, data.to, zone), [
    {
      name: "Articles",
      subtitle: periode,
      totals: ["Qté", "Montant (FCFA)"],
      rows: data.rows.map((r) => {
        const row: Record<string, string | number> = {
          Article: r.name,
          Famille: kindLabel(r.kind),
          Qté: r.qty,
          "Montant (FCFA)": r.amount,
          Lignes: r.lignes,
          "Première vente": r.firstDate,
          "Dernière vente": r.lastDate,
        };
        if (showSites) {
          row["Qté Zogbo"] = r.bySite.zogbo ?? 0;
          row["Qté Gbégamey"] = r.bySite.gbegamey ?? 0;
        }
        return row;
      }),
    },
    {
      name: "Totaux",
      subtitle: periode,
      rows: [
        {
          Articles: data.totals.articles,
          Qté: data.totals.qty,
          "Montant (FCFA)": data.totals.amount,
          Lignes: data.totals.lignes,
          Recherche: data.q || "",
          Famille: data.kind === "all" ? "Toutes" : kindLabel(data.kind),
        },
      ],
    },
  ]);
}

export async function exportAllHistoriqueVentesExcel(input: {
  from: string;
  to: string;
  site: string;
  statut?: string;
  source?: string;
  serveur?: string;
  paiement?: string;
  q?: string;
}): Promise<void> {
  const params = new URLSearchParams({
    from: input.from,
    to: input.to,
    site: input.site,
    limit: "all",
  });
  if (input.statut) params.set("statut", input.statut);
  if (input.source) params.set("source", input.source);
  if (input.serveur?.trim()) params.set("serveur", input.serveur.trim());
  if (input.paiement?.trim()) params.set("paiement", input.paiement.trim());
  if (input.q?.trim()) params.set("q", input.q.trim());

  const res = await fetch(`/api/historique-ventes?${params}`, {
    cache: "no-store",
  });
  const body = (await res.json()) as {
    tickets?: HistoriqueVentesExportTicket[];
    totals?: Parameters<typeof exportHistoriqueVentesExcel>[0]["totals"];
    error?: string;
  };
  if (!res.ok) throw new Error(body.error || "Export impossible");

  const zeroTotals = {
    count: 0,
    montant: 0,
    valide: 0,
    annule: 0,
    encours: 0,
  };
  exportHistoriqueVentesExcel({
    tickets: body.tickets ?? [],
    totals: body.totals ?? zeroTotals,
    from: input.from,
    to: input.to,
    site: input.site,
    statut: input.statut,
    source: input.source,
    serveur: input.serveur,
    paiement: input.paiement,
    q: input.q,
  });
}

/** Caisse — historique des sessions d'une caisse, journal en cours, réseau. */
export function exportCaisseExcel(input: {
  date: string;
  caisse: CaisseKey;
  historique: CaisseSession[];
  overview: CaisseOverviewItem[] | null;
  activeMouvements: CaisseMouvement[];
}): void {
  const label = CAISSE_LABELS[input.caisse];

  const historiqueRows = input.historique.map((s) => {
    const t =
      typeof s.soldeTheoriqueCloture === "number"
        ? s.soldeTheoriqueCloture
        : soldeTheorique(s);
    const ecart =
      typeof s.ecart === "number"
        ? s.ecart
        : s.soldePhysique === null
          ? ""
          : s.soldePhysique - t;
    return {
      Date: s.date,
      Statut:
        s.statut === "ouverte"
          ? "Ouverte"
          : s.statut === "en_comptage"
            ? "En comptage"
            : "Clôturée",
      "Ouverte par": s.userName,
      "Clôturée par": s.closedByName ?? "",
      "Fond de caisse (FCFA)": s.soldeInitial,
      "Ventes (FCFA)": s.totalVente,
      "Dépenses (FCFA)": s.totalDepense,
      "Autres recettes (FCFA)": s.totalRecette,
      "Versements reçus (FCFA)": s.totalVersementRecu,
      "Versements sortis (FCFA)": s.totalVersementSorti,
      "Solde théorique (FCFA)": t,
      "Solde physique (FCFA)": s.soldePhysique ?? "",
      "Écart (FCFA)": ecart,
      "Justification écart": s.justificationEcart ?? "",
      Observation: s.commentaire ?? "",
    };
  });

  const mouvementRows = input.activeMouvements.map((m) => ({
    Heure: heureLisible(m.at),
    Type: MOUVEMENT_KIND_LABELS[m.kind] ?? m.kind,
    Nature: m.nature,
    "Bénéficiaire / provenance": m.beneficiaire ?? "",
    "Montant (FCFA)": m.montant,
    Acteur: m.actorName ?? "",
    Contrepartie: m.contrepartie ? CAISSE_LABELS[m.contrepartie] : "",
    Statut: m.cancelledAt
      ? `Annulé par ${m.cancelledByName ?? "—"}`
      : "Actif",
  }));

  const sheets: ExcelSheet[] = [
    {
      name: "Historique",
      subtitle: label,
      totals: [
        "Ventes (FCFA)",
        "Dépenses (FCFA)",
        "Autres recettes (FCFA)",
        "Versements reçus (FCFA)",
        "Versements sortis (FCFA)",
      ],
      rows: historiqueRows,
    },
    {
      // Pas de total automatique ici : la colonne Montant mélange dépenses,
      // recettes et mouvements annulés (visibles pour l'audit) — un total de
      // colonne brut serait trompeur. Les totaux fiables sont sur
      // « Historique », déjà nets des annulations (soldes de session).
      name: "Journal en cours",
      subtitle: `${label} · ${input.date}`,
      rows: mouvementRows,
    },
  ];

  if (input.overview) {
    sheets.push({
      name: "Réseau",
      subtitle: input.date,
      rows: input.overview.map((o) => ({
        Caisse: CAISSE_LABELS[o.caisse],
        Statut: o.session ? "Ouverte" : "Fermée",
        "Ouverte par": o.session?.userName ?? "",
        "Solde théorique (FCFA)": o.session ? o.soldeTheorique : "",
      })),
    });
  }

  downloadExcel(excelFilename("caisse", input.date, input.caisse), sheets);
}

const MOUVEMENT_KIND_LABELS: Record<CaisseMouvement["kind"], string> = {
  depense: "Dépense",
  recette: "Recette",
  "versement-sortie": "Versement sorti",
  "versement-entree": "Versement reçu",
};

/** Pertes — journal du jour, tel qu'affiché à l'écran. */
export function exportPertesExcel(input: {
  date: string;
  site: VenteSite | "tous";
  pertes: PerteEntry[];
}): void {
  const rows = input.pertes.map((p) => ({
    Heure: heureLisible(p.at),
    Zone: siteLabel(p.site),
    Famille: kindLabel(p.kind),
    Produit: p.name,
    Quantité: p.qty,
    Motif: PERTE_MOTIF_LABELS[p.motif],
    Commentaire: p.commentaire,
    "Coût (FCFA)": p.cost,
    Acteur: p.actorName ?? "",
    Statut: p.cancelledAt ? `Annulée par ${p.cancelledByName ?? "—"}` : "Active",
  }));

  const sheets: ExcelSheet[] = [
    {
      name: "Pertes",
      subtitle: `${siteLabel(input.site)} · ${input.date}`,
      totals: ["Coût (FCFA)"],
      rows,
    },
  ];

  downloadExcel(excelFilename("pertes", input.date, input.site), sheets);
}

/** Admin — utilisateurs (sans mots de passe) */
export function exportAdminUsersExcel(
  users: Array<{
    username: string;
    name: string;
    role: string;
    site: string;
    active?: boolean;
    createdAt?: string | null;
  }>,
): void {
  downloadExcel(excelFilename("utilisateurs"), [
    {
      name: "Utilisateurs",
      rows: users.map((u) => ({
        Identifiant: u.username,
        Nom: u.name,
        Rôle: u.role,
        Site: siteLabel(u.site),
        Actif: u.active === false ? "non" : "oui",
        Créé: u.createdAt ?? "",
      })),
    },
  ]);
}

/** Journal des ventes détaillé — une feuille Excel par jour de la période. */
export function exportJournalVentesExcel(input: {
  days: Array<{
    date: string;
    lines: Array<{
      at: string;
      numero: string;
      site: string;
      statut: string;
      statutLabel: string;
      source: string;
      typeVente: string;
      serveur: string | null;
      paiement: string | null;
      client: string | null;
      table: string | null;
      produit: string;
      qty: number;
      unitPrice: number;
      montant: number;
    }>;
    nbTickets: number;
    nbLignes: number;
    montant: number;
  }>;
  totals: { count: number; montant: number; valide: number; annule: number; encours: number };
  from: string;
  to: string;
  site: string;
}): void {
  const zone = input.site === "all" ? "tous" : input.site;
  const periode = `${siteLabel(zone)} · du ${input.from} au ${input.to}`;

  const days = [...input.days]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({
      ...d,
      lines: [...d.lines].sort((a, b) => String(a.at).localeCompare(String(b.at))),
    }));

  const daySheets: ExcelSheet[] = days.map((d) => ({
    name: `Jour ${d.date}`,
    subtitle: `${siteLabel(zone)} · ${d.date} · ${d.nbTickets} ticket(s) · CA ${d.montant} FCFA`,
    totals: ["Quantité", "Montant (FCFA)"],
    rows: d.lines.map((l) => ({
      Jour: d.date,
      Heure: heureLisible(l.at),
      Article: l.produit,
      Quantité: l.qty,
      "Montant (FCFA)": l.montant,
      "Chiffre (FCFA)": d.montant,
    })),
  }));

  const sheets: ExcelSheet[] = [
    {
      name: "Synthèse",
      subtitle: periode,
      totals: ["Tickets", "Lignes", "CA validé (FCFA)"],
      rows: days.map((d) => ({
        Date: d.date,
        Tickets: d.nbTickets,
        Lignes: d.nbLignes,
        "CA validé (FCFA)": d.montant,
      })),
    },
    ...daySheets,
  ];

  downloadExcel(
    excelFilename("journal_ventes", input.from, input.to, zone),
    sheets,
  );
}

/** Journal des mouvements de stock — détail complet + solde par produit. */
export function exportJournalStockExcel(input: {
  rows: JournalRow[];
  balance: JournalBalanceRow[];
  totals: JournalTotals;
  from: string | null;
  to: string | null;
  site: string;
  type: string;
}): void {
  const typeLabel = (t: string) =>
    ({ vente: "Vente", achat: "Achat", perte: "Perte", reception: "Réception" })[t] ?? t;
  const periode =
    input.from && input.to
      ? `du ${input.from} au ${input.to}`
      : input.from
        ? `depuis le ${input.from}`
        : input.to
          ? `jusqu'au ${input.to}`
          : "depuis le début";
  const zone = siteLabel(input.site === "tous" ? "tous" : input.site);
  const typeFiltre = input.type === "tous" ? "Tous" : typeLabel(input.type);
  const titre = `${zone} · ${typeFiltre} · ${periode}`;

  downloadExcel(excelFilename("journal-stock"), [
    {
      name: "Synthèse",
      subtitle: titre,
      rows: [
        {
          Lignes: input.totals.count,
          "Qté entrées": input.totals.qtyEntrees,
          "Qté sorties": input.totals.qtySorties,
          "Montant (FCFA)": input.totals.montant,
          "Ventes — lignes": input.totals.byType.vente.count,
          "Ventes — qté": input.totals.byType.vente.qty,
          "Ventes — CA (FCFA)": input.totals.byType.vente.montant,
          "Achats — lignes": input.totals.byType.achat.count,
          "Achats — qté": input.totals.byType.achat.qty,
          "Achats — coût (FCFA)": input.totals.byType.achat.montant,
          "Pertes — lignes": input.totals.byType.perte.count,
          "Pertes — qté": input.totals.byType.perte.qty,
          "Pertes — coût (FCFA)": input.totals.byType.perte.montant,
          "Réceptions — lignes": input.totals.byType.reception.count,
          "Réceptions — qté": input.totals.byType.reception.qty,
        },
      ],
    },
    {
      name: "Mouvements",
      subtitle: titre,
      totals: ["Montant (FCFA)"],
      rows: input.rows.map((r) => ({
        Date: r.date,
        Heure: heureLisible(r.at),
        Zone: siteLabel(r.site),
        Type: typeLabel(r.type),
        Famille: kindLabel(r.kind),
        Produit: r.name,
        "Qté (entrée + / sortie −)": r.direction > 0 ? r.qty : -r.qty,
        "Prix unitaire (FCFA)": r.unitPrice,
        "Montant (FCFA)": r.montant,
        Statut: r.annule ? "Annulé" : "Validé",
        Détail: r.detail,
        Équipe: r.equipe ?? "",
        Acteur: r.acteur ?? "",
      })),
    },
    {
      name: "Solde par produit",
      subtitle: `${titre} — hors mouvements annulés`,
      totals: ["Montant (FCFA)"],
      rows: input.balance.map((b) => ({
        Zone: siteLabel(b.site),
        Famille: kindLabel(b.kind),
        Produit: b.name,
        Entrées: b.entrees,
        Sorties: b.sorties,
        Solde: b.solde,
        "Montant (FCFA)": b.montant,
      })),
    },
  ]);
}

export type JournalStockRow = JournalRow;
export type JournalStockBalanceRow = JournalBalanceRow;

/**
 * Journal comptable (débit/crédit). Le mapping vers les comptes SYSCOHADA est
 * une proposition par défaut : les lignes « à reclasser » et les anomalies
 * sont mises en avant pour qu'un expert-comptable les valide avant tout usage
 * fiscal ou légal — voir la feuille « Points d'attention ».
 */
export function exportJournalComptableExcel(input: {
  from: string;
  to: string;
  ecritures: EcritureComptable[];
  totalDebit: number;
  totalCredit: number;
  equilibre: boolean;
  anomalies: { date: string; message: string }[];
  pertesExclues: { montant: number; note: string };
}): void {
  const sheets: ExcelSheet[] = [
    {
      name: "Résumé",
      rows: [
        {
          Du: input.from,
          Au: input.to,
          "Total débit (FCFA)": input.totalDebit,
          "Total crédit (FCFA)": input.totalCredit,
          Équilibré: input.equilibre ? "Oui" : "NON — à corriger",
          "Pertes exclues (FCFA)": input.pertesExclues.montant,
        },
      ],
    },
    {
      name: "Journal",
      totals: ["Débit", "Crédit"],
      rows: input.ecritures.map((e) => ({
        Date: e.date,
        Pièce: e.piece,
        Compte: e.compte,
        "Libellé compte": e.compteLibelle,
        Libellé: e.libelle,
        Débit: e.debit || "",
        Crédit: e.credit || "",
        "À vérifier": e.confiant ? "" : "oui",
      })),
    },
    {
      name: "Points d'attention",
      rows: [
        ...input.anomalies.map((a) => ({
          Date: a.date,
          Type: "Anomalie",
          Message: a.message,
        })),
        {
          Date: `${input.from} → ${input.to}`,
          Type: "Pertes",
          Message: input.pertesExclues.note,
        },
        {
          Date: "—",
          Type: "Rappel",
          Message:
            "Le mapping comptes/opérations est un défaut à faire valider par un expert-comptable avant toute déclaration.",
        },
      ],
    },
  ];
  downloadExcel(excelFilename("journal-comptable", input.from, input.to), sheets);
}

/** Grand livre : mêmes écritures que le journal, groupées par compte. */
export function exportGrandLivreExcel(input: {
  from: string;
  to: string;
  comptes: CompteGrandLivre[];
}): void {
  const rows: Record<string, string | number>[] = [];
  for (const c of input.comptes) {
    for (const m of c.mouvements) {
      rows.push({
        Compte: c.compte,
        "Libellé compte": c.compteLibelle,
        Date: m.date,
        Pièce: m.piece,
        Libellé: m.libelle,
        Débit: m.debit || "",
        Crédit: m.credit || "",
        Solde: m.solde,
      });
    }
    rows.push({
      Compte: c.compte,
      "Libellé compte": `Total ${c.compteLibelle}`,
      Date: "",
      Pièce: "",
      Libellé: "",
      Débit: c.totalDebit,
      Crédit: c.totalCredit,
      Solde: c.soldeFinal,
    });
  }
  downloadExcel(excelFilename("grand-livre", input.from, input.to), [
    { name: "Grand livre", rows },
  ]);
}

/** Balance générale : un total par compte. */
export function exportBalanceExcel(input: {
  from: string;
  to: string;
  lignes: LigneBalance[];
}): void {
  const sheets: ExcelSheet[] = [
    {
      name: "Balance",
      totals: ["Débit", "Crédit", "Solde débiteur", "Solde créditeur"],
      rows: input.lignes.map((l) => ({
        Compte: l.compte,
        "Libellé compte": l.compteLibelle,
        Débit: l.debit,
        Crédit: l.credit,
        "Solde débiteur": l.soldeDebiteur || "",
        "Solde créditeur": l.soldeCrediteur || "",
      })),
    },
  ];
  downloadExcel(excelFilename("balance-generale", input.from, input.to), sheets);
}

/**
 * Bilan simplifié. Les postes marqués « non fiable » (capital, stocks,
 * créances, dettes) sont à 0 par construction — l'application ne les tient
 * pas — d'où l'écart affiché tant qu'un expert-comptable ne les a pas fournis.
 */
export function exportBilanExcel(bilan: Omit<Bilan, "balance">): void {
  const sheets: ExcelSheet[] = [
    {
      name: "Bilan",
      rows: [
        { Colonne: "ACTIF", Poste: "", "Montant (FCFA)": "", Note: "" },
        ...bilan.actif.map((l) => ({
          Colonne: "",
          Poste: l.libelle,
          "Montant (FCFA)": l.montant,
          Note: l.fiable ? "" : l.note ?? "à vérifier",
        })),
        {
          Colonne: "",
          Poste: "Total actif",
          "Montant (FCFA)": bilan.totalActif,
          Note: "",
        },
        { Colonne: "PASSIF", Poste: "", "Montant (FCFA)": "", Note: "" },
        ...bilan.passif.map((l) => ({
          Colonne: "",
          Poste: l.libelle,
          "Montant (FCFA)": l.montant,
          Note: l.fiable ? "" : l.note ?? "à vérifier",
        })),
        {
          Colonne: "",
          Poste: "Total passif",
          "Montant (FCFA)": bilan.totalPassif,
          Note: "",
        },
        {
          Colonne: "",
          Poste: "Écart (actif − passif)",
          "Montant (FCFA)": bilan.ecart,
          Note: bilan.equilibre
            ? "Équilibré"
            : "Déséquilibré tant que le capital et les autres postes non suivis ne sont pas renseignés par le comptable.",
        },
      ],
    },
  ];
  downloadExcel(excelFilename("bilan", bilan.asOf), sheets);
}

export type JournalStockTotals = JournalTotals;
