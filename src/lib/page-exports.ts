import { computeBoissonsDay, formatCasiers } from "@/lib/boissons-calc";
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
        Compté: l.counted ?? "",
        Écart: l.variance ?? "",
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
        "Bt/casier": l.unitsPerCasier,
        "Init (cas.)": formatCasiers(l.initialStock),
        "Achats (cas.)": formatCasiers(l.purchases),
        "Vendu Zogbo (bt)": l.soldZogbo,
        "Stock (cas.)": formatCasiers(Math.max(0, l.theoreticalRemaining)),
        "Stock (bt)": l.stockBottles,
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
      name: "Reçu Zogbo",
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
        "Bt/casier": l.unitsPerCasier,
        "Init (cas.)": formatCasiers(l.initialStock),
        "Achats (cas.)": formatCasiers(l.purchases),
        "Vendu Gbégamey (bt)": l.soldGbegamey,
        "Stock (cas.)": formatCasiers(Math.max(0, l.theoreticalRemaining)),
        "Stock (bt)": l.stockBottles,
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
  }>(
    `/api/vente?date=${encodeURIComponent(date)}&site=${encodeURIComponent(site)}&limit=500`,
  );

  const sheets: ExcelSheet[] = [
    {
      name: "Produits",
      rows: board.products.map((p) => ({
        Type: p.kind,
        Produit: p.name,
        "PU (FCFA)": p.unitPrice,
        "Vendu aujourd’hui": p.soldToday,
        "Stock restant": p.stockLeft ?? "",
        Info: p.hint ?? "",
      })),
    },
    {
      name: "Journal",
      rows: board.recent.map((e) => ({
        Date: e.date || date,
        Site: siteLabel(e.site || site),
        Heure: e.at,
        Type: e.kind,
        Produit: e.name,
        Qté: e.qty,
        "PU (FCFA)": e.unitPrice,
        "Montant (FCFA)": e.amount,
      })),
    },
    {
      name: "Filtres",
      rows: [
        {
          Date: date,
          Zone: siteLabel(site),
          "CA (FCFA)": board.caToday,
          "Nb produits catalogue": board.products.length,
          "Lignes journal": board.recent.length,
        },
      ],
    },
    {
      name: "Synthèse",
      rows: [
        {
          Date: date,
          Site: siteLabel(site),
          "CA (FCFA)": board.caToday,
          "Nb produits catalogue": board.products.length,
          "Lignes journal": board.recent.length,
        },
      ],
    },
  ];

  downloadExcel(excelFilename("vente", date, site), sheets);
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
          "CA Zogbo combos": Number(d.caCombosZogbo) || 0,
          "CA Zogbo boissons": Number(d.caBoissonsZogbo) || 0,
          "CA Zogbo extra": Number(d.caExtraZogbo) || 0,
          "CA Zogbo total": Number(d.caZogbo) || 0,
          "CA Gbégamey plats": Number(d.caGbegameyPlats) || 0,
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
  aquapro: "AquaPro",
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
  const sheets: ExcelSheet[] = [
    {
      name: "Filtres",
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
      rows: input.tickets.map((t) => ({
        Ticket: t.numero,
        Date: t.date,
        Quand: t.at,
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
      rows: input.tickets.flatMap((t) =>
        t.lines.map((l) => ({
          Ticket: t.numero,
          Date: t.date,
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
