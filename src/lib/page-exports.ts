import { computeBoissonsDay } from "@/lib/boissons-calc";
import { computeCombosDay } from "@/lib/combos-calc";
import {
  downloadExcel,
  excelFilename,
  type ExcelSheet,
} from "@/lib/export-excel";
import {
  computeTransferLine,
  computeLocalLine,
} from "@/lib/gbegamey-calc";
import { formatActorLabel, HISTORIQUE_KIND_LABELS } from "@/lib/historique-types";
import type { HistoriqueEvent } from "@/lib/historique-types";
import type {
  BaseDish,
  BoissonsDay,
  CombosDay,
  Drink,
  GbegameyDay,
  LocalDish,
  Parametres,
  VenteLogEntry,
  VenteProduct,
  VenteSite,
  ZogboDay,
} from "@/lib/types";
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
  combo: "Combo",
  boisson: "Boisson",
  extra: "Vente libre",
  matiere: "Matière",
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
      name: "Combos",
      rows: data.combos.map((c) => ({
        Id: c.id,
        Nom: c.name,
        "Prix (FCFA)": c.unitPrice,
        "Prix de revient": c.costPrice ?? "",
        "Plat de base": c.baseDishName ?? "",
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

/** Zogbo — plats + combos + boissons du jour */
export async function exportZogboExcel(date: string): Promise<void> {
  const [zogbo, combos, boissons] = await Promise.all([
    fetchJson<{ day: ZogboDay; baseDishes: BaseDish[] }>(
      `/api/zogbo?date=${encodeURIComponent(date)}`,
    ),
    fetchJson<{ day: CombosDay; combos: { id: string; name: string; unitPrice: number; baseDishName: string | null }[] }>(
      `/api/combos?date=${encodeURIComponent(date)}&site=zogbo`,
    ),
    fetchJson<{ day: BoissonsDay; drinks: Drink[] }>(
      `/api/boissons?date=${encodeURIComponent(date)}&site=zogbo`,
    ),
  ]);

  const z = computeZogboDay(zogbo.day, zogbo.baseDishes);
  const c = computeCombosDay(combos.day, combos.combos);
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
      name: "Combos",
      rows: c.lines.map((l) => ({
        Combo: l.name,
        "Stock Zogbo": l.stockActuelZogbo,
        Préparé: l.prepared,
        Envoyé: l.sentToGbegamey,
        "Vendu Zogbo": l.soldZogbo,
        "PU (FCFA)": l.unitPrice,
        "CA Zogbo (FCFA)": l.soldAmountZogbo,
      })),
    },
    {
      name: "Boissons",
      rows: b.lines.map((l) => ({
        Boisson: l.name,
        "Contenance (bt/casier)": l.unitsPerCasier,
        "Init (bt)": Math.round(l.initialStock * l.unitsPerCasier),
        "Achats (bt)": Math.round(l.purchases * l.unitsPerCasier),
        "Vendu Zogbo (bt)": l.soldZogbo,
        "Stock (bt)": Math.round(
          Math.max(0, l.theoreticalRemaining) * l.unitsPerCasier,
        ),
        "PA/bt": l.purchasePrice,
        "PV/bt": l.salePrice ?? "",
        Compté: l.counted ?? "",
      })),
    },
  ];

  downloadExcel(excelFilename("zogbo", date), sheets);
}

/** Gbégamey — reçu + locaux + combos + boissons */
export async function exportGbegameyExcel(date: string): Promise<void> {
  const [gbe, combos, boissons] = await Promise.all([
    fetchJson<{
      day: GbegameyDay;
      baseDishes: BaseDish[];
      localDishes: LocalDish[];
      sentByProductId: Record<string, number>;
    }>(`/api/gbegamey?date=${encodeURIComponent(date)}`),
    fetchJson<{ day: CombosDay; combos: { id: string; name: string; unitPrice: number; baseDishName: string | null }[] }>(
      `/api/combos?date=${encodeURIComponent(date)}&site=gbegamey`,
    ),
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
  const c = computeCombosDay(combos.day, combos.combos);
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
      name: "Combos",
      rows: c.lines.map((l) => ({
        Combo: l.name,
        "Init Gbégamey": l.initialGbegamey,
        Reçu: l.receivedGbegamey,
        Vendu: l.soldGbegamey,
        "Stock actuel": l.stockActuelGbegamey,
        "PU (FCFA)": l.unitPrice,
        "CA (FCFA)": l.soldAmountGbegamey,
      })),
    },
    {
      name: "Boissons",
      rows: b.lines.map((l) => ({
        Boisson: l.name,
        "Contenance (bt/casier)": l.unitsPerCasier,
        "Init (bt)": Math.round(l.initialStock * l.unitsPerCasier),
        "Achats (bt)": Math.round(l.purchases * l.unitsPerCasier),
        "Vendu Gbégamey (bt)": l.soldGbegamey,
        "Stock (bt)": Math.round(
          Math.max(0, l.theoreticalRemaining) * l.unitsPerCasier,
        ),
        "PV/bt": l.salePrice ?? "",
        Compté: l.counted ?? "",
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
      rows: board.recent.map((e) => ({
        Date: e.date || date,
        Site: siteLabel(e.site || site),
        Heure: heureLisible(e.at),
        Famille: kindLabel(e.kind),
        Produit: e.name,
        Qté: e.qty,
        "PU (FCFA)": e.unitPrice,
        "Montant (FCFA)": e.amount,
      })),
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

/** Répartition équipes — tableau jour / nuit sur une période */
export function exportEquipesExcel(input: {
  from: string;
  to: string;
  site: "all" | VenteSite;
  days: Array<{
    date: string;
    jour: number;
    nuit: number;
    aucune: number;
    total: number;
  }>;
  totals: { jour: number; nuit: number; aucune: number; total: number };
}): void {
  const showAucune = input.totals.aucune > 0;
  const pct = (part: number, whole: number) =>
    whole > 0 ? Math.round((part / whole) * 100) : "";

  const sheets: ExcelSheet[] = [
    {
      name: "Jours",
      subtitle: `${siteLabel(input.site)} · ${input.from} → ${input.to}`,
      totals: ["Total (FCFA)"],
      rows: input.days
        .filter((d) => d.total > 0)
        .map((d) => ({
          Date: d.date,
          "CA jour (FCFA)": d.jour,
          "CA nuit (FCFA)": d.nuit,
          ...(showAucune ? { "CA hors équipe (FCFA)": d.aucune } : {}),
          "Total (FCFA)": d.total,
          "% jour": pct(d.jour, d.total),
          "% nuit": pct(d.nuit, d.total),
        })),
    },
    {
      name: "Synthèse",
      subtitle: `${siteLabel(input.site)} · ${input.from} → ${input.to}`,
      rows: [
        {
          Du: input.from,
          Au: input.to,
          Zone: siteLabel(input.site),
          "CA équipe jour (FCFA)": input.totals.jour,
          "CA équipe nuit (FCFA)": input.totals.nuit,
          ...(showAucune
            ? { "CA hors équipe (FCFA)": input.totals.aucune }
            : {}),
          "CA total (FCFA)": input.totals.total,
          "% jour": pct(input.totals.jour, input.totals.total),
          "% nuit": pct(input.totals.nuit, input.totals.total),
        },
      ],
    },
  ];

  downloadExcel(
    excelFilename("equipes", `${input.from}_${input.to}`, input.site),
    sheets,
  );
}

const CONTROLE_SOURCE_LABELS: Record<string, string> = {
  caisse: "Caisse",
  aquapro: "Importé",
  "carnet-zogbo": "Carnet Zogbo",
  reprise: "Reprise historique",
  "inventaire-marco": "Inventaire",
};

function controleSourceLabel(source: string): string {
  return CONTROLE_SOURCE_LABELS[source] ?? source;
}

/** Contrôle — points initiaux et vérification CA */
export function exportControleExcel(data: import("@/lib/controle-repo").ControlePayload): void {
  const openingRows = data.openings.map((row) => {
    const extra = row.extra ?? {};
    return {
      Zone: row.zoneLabel,
      Produit: row.name,
      Ouverture: row.opening,
      Unité: row.unit,
      Détails: Object.entries(extra)
        .map(([k, v]) => `${k}: ${v}`)
        .join(" · "),
    };
  });

  const caRows = data.caDays
    .filter((d) => d.hasJournal || d.hasCompteur || d.journalTotal > 0)
    .map((d) => ({
      Date: d.date,
      "Journal Zogbo (FCFA)": d.journalZogbo || "",
      "Journal Gbé (FCFA)": d.journalGbegamey || "",
      "Journal total (FCFA)": d.journalTotal || "",
      "Estimation Zogbo (FCFA)": d.compteurZogbo || "",
      "Estimation Gbé (FCFA)": d.compteurGbegamey || "",
      "Estimation catalogue (FCFA)": d.compteurTotal || "",
      "Écart tarif (FCFA)": d.ecart,
      Sources: d.sources
        .map(
          (s) =>
            `${controleSourceLabel(s.source)} ${s.montant} (${s.lignes} lignes)`,
        )
        .join(" · "),
    }));

  const sheets: ExcelSheet[] = [
    {
      name: "Points initiaux",
      subtitle: `${data.date} · ${data.scopeSite ?? "tous sites"}`,
      rows: openingRows,
    },
    {
      name: "CA journalier",
      subtitle: `${data.from} → ${data.to}`,
      totals: ["Total (FCFA)"],
      rows: caRows,
    },
    {
      name: "Synthèse CA",
      rows: [
        {
          Du: data.from,
          Au: data.to,
          "Journal total (FCFA)": data.caTotals.journal,
          "Estimation catalogue (FCFA)": data.caTotals.compteur,
          "Écart tarif (FCFA)": data.caTotals.ecart,
        },
      ],
    },
  ];

  downloadExcel(
    excelFilename("controle", `${data.from}_${data.to}`, data.scopeSite ?? "all"),
    sheets,
  );
}

/** Stock final par zone (plats + accompagnements). */
export function exportStockExcel(
  data: import("@/lib/stock-repo").StockPayload,
): void {
  const rows = data.rows.map((row) => ({
    Zone: row.zoneLabel,
    Produit: row.name,
    Type: row.kind === "plat" ? "Plat" : "Accompagnement",
    Ouverture: row.opening,
    Entrées: row.entrees,
    "Envoyé Gbé": row.envoye || "",
    Vendu: row.vendu,
    Pertes: row.pertes,
    "Stock final": row.stockFinal,
    Vendable: row.stockVendable ?? "",
    Compté: row.compte ?? "",
    Écart: row.ecart ?? "",
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
          "CA Zogbo combos": Number(d.caCombosZogbo) || 0,
          "CA Zogbo boissons": Number(d.caBoissonsZogbo) || 0,
          "CA Zogbo extra": Number(d.caExtraZogbo) || 0,
          "CA Zogbo total": Number(d.caZogbo) || 0,
          "CA Gbégamey plats": Number(d.caGbegameyPlats) || 0,
          "CA Gbégamey accompagnements":
            Number(d.caAccompagnementsGbegamey) || 0,
          "CA Gbégamey combos": Number(d.caCombosGbegamey) || 0,
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

/** Historique des ventes — tickets filtrés (dates + zone + autres filtres) */
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
          "Tickets exportés": input.totals.count,
          "CA affiché (FCFA)": input.totals.montant,
        },
      ],
    },
    {
      name: "Tickets",
      subtitle: periode,
      totals: ["Réduction (FCFA)", "Montant (FCFA)"],
      rows: input.tickets.map((t) => ({
        Ticket: t.numero,
        Date: t.date,
        Heure: heureLisible(t.at),
        Zone: siteLabel(t.site),
        Statut: t.statutLabel || STATUT_LABEL[t.statut] || t.statut,
        Source: SOURCE_LABEL[t.source] ?? t.source,
        Type: t.typeVente,
        Serveur: t.serveur ?? "",
        Caissier: t.caissier ?? "",
        Client: t.client ?? "",
        Table: t.table ?? "",
        Paiement: t.paiement ?? "",
        "Réduction (FCFA)": t.reduction || 0,
        "Montant (FCFA)": t.montant,
      })),
    },
    {
      name: "Lignes",
      subtitle: periode,
      totals: ["Qté", "Montant (FCFA)"],
      rows: input.tickets.flatMap((t) =>
        t.lines.map((l) => ({
          Ticket: t.numero,
          Date: t.date,
          Heure: heureLisible(t.at),
          Zone: siteLabel(t.site),
          Statut: t.statutLabel || t.statut,
          Produit: l.name,
          Qté: l.qty,
          "PU (FCFA)": l.unitPrice,
          "Montant (FCFA)": l.amount,
        })),
      ),
    },
    {
      name: "Totaux",
      subtitle: periode,
      rows: [
        {
          Tickets: input.totals.count,
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
 */
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
