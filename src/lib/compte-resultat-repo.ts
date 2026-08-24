import {
  sumCaisseDepensesRecettes,
  sumCaisseDepensesRecettesParCaisse,
  type CaisseDepensesRecettesRow,
} from "@/lib/caisse-repo";
import { sumMatieresPurchasesForDate } from "@/lib/matieres-repo";
import {
  allocatedReductionsByProduct,
  productNetKey,
} from "@/lib/ca-allocation";
import { getDb } from "@/lib/mongodb";
import type { PosTicket } from "@/lib/types";
import {
  getDayPoint,
  getMonthPoint,
  getYearPoint,
} from "@/lib/synthese-repo";
import type {
  CompteResultatDetailLine,
  DayPoint,
  MonthPoint,
  VenteSite,
  YearPoint,
} from "@/lib/types";

export type CompteResultatDay = {
  view: "day";
  label: string;
  date: string;
  day: DayPoint;
  caisseDepenses: number;
  caisseRecettes: number;
  caisseSessions: number;
  caisseParCaisse: CaisseDepensesRecettesRow[];
  /** Achats matières du jour (Achats → Stock), pour suggérer la charge. */
  matieresPurchasesToday: number;
  detailProduits: CompteResultatDetailLine[];
};

export type CompteResultatMonth = {
  view: "month";
  label: string;
  month: string;
  data: MonthPoint;
  caisseDepenses: number;
  caisseRecettes: number;
  caisseSessions: number;
  caisseParCaisse: CaisseDepensesRecettesRow[];
  detailProduits: CompteResultatDetailLine[];
};

export type CompteResultatYear = {
  view: "year";
  label: string;
  year: number;
  data: YearPoint;
  caisseDepenses: number;
  caisseRecettes: number;
  caisseSessions: number;
  caisseParCaisse: CaisseDepensesRecettesRow[];
  detailProduits: CompteResultatDetailLine[];
};

export type CompteResultatPayload =
  | CompteResultatDay
  | CompteResultatMonth
  | CompteResultatYear;

const MONTH_NAMES = [
  "Janvier",
  "Février",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Août",
  "Septembre",
  "Octobre",
  "Novembre",
  "Décembre",
];

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** Ventes actives contribuant au CA (hors annulées / exclues). */
function caActifMatch(extra: Record<string, unknown> = {}) {
  return {
    cancelledAt: null,
    caExcluded: { $ne: true },
    ...extra,
  };
}

/**
 * Détail produit par produit (qté, tickets, CA) pour la période.
 * `$ne: "combo"` : filet de sécurité pour d’anciennes lignes Mongo
 * (catalogue formules retiré, plus vendu).
 */
export async function listDetailProduits(input: {
  dateFrom: string;
  dateTo: string;
  scopeSite?: VenteSite | null;
}): Promise<CompteResultatDetailLine[]> {
  const db = await getDb();
  const match: Record<string, unknown> = {
    date: { $gte: input.dateFrom, $lte: input.dateTo },
    kind: { $ne: "combo" },
    qty: { $gt: 0 },
  };
  if (input.scopeSite) match.site = input.scopeSite;

  const siteFilter = input.scopeSite ? { site: input.scopeSite } : {};
  const [rows, tickets] = await Promise.all([
    db
      .collection("ventes_log")
      .aggregate<{
        _id: { site: string; kind: string; productId: string };
        name: string;
        qty: number;
        amount: number;
        tickets: number;
      }>([
        { $match: caActifMatch(match) },
        {
          $group: {
            _id: {
              site: "$site",
              kind: "$kind",
              productId: "$productId",
            },
            name: { $last: "$name" },
            qty: { $sum: "$qty" },
            amount: { $sum: "$amount" },
            tickets: { $sum: 1 },
          },
        },
        { $sort: { amount: -1, qty: -1 } },
      ])
      .toArray(),
    db
      .collection<PosTicket>("pos_tickets")
      .find({
        date: { $gte: input.dateFrom, $lte: input.dateTo },
        statut: "valide",
        reduction: { $gt: 0 },
        ...siteFilter,
      }, { projection: { reduction: 1, lines: 1 } })
      .toArray(),
  ]);

  const redByProduct = allocatedReductionsByProduct(
    tickets.map((t) => ({
      reduction: Number(t.reduction) || 0,
      lines: (t.lines ?? []).map((l) => ({
        productId: String(l.productId || ""),
        kind: String(l.kind || "extra"),
        amount: Number(l.amount) || 0,
      })),
    })),
  );

  return rows.map((r) => {
    const kind = String(r._id.kind || "extra");
    const productId = String(r._id.productId || "");
    const allocated = redByProduct.get(productNetKey(kind, productId)) ?? 0;
    return {
      site: String(r._id.site || ""),
      kind,
      productId,
      name: String(r.name || "Sans nom"),
      qty: Number(r.qty) || 0,
      amount: Math.max(0, Math.round((Number(r.amount) || 0) - allocated)),
      tickets: Number(r.tickets) || 0,
    };
  });
}

export async function getCompteResultatDay(
  date: string,
  scopeSite?: VenteSite | null,
): Promise<CompteResultatDay> {
  const [day, caisse, caisseParCaisse, matieresPurchasesToday, detailProduits] =
    await Promise.all([
      getDayPoint(date, scopeSite),
      sumCaisseDepensesRecettes({ dateFrom: date, dateTo: date, scopeSite }),
      sumCaisseDepensesRecettesParCaisse({
        dateFrom: date,
        dateTo: date,
        scopeSite,
      }),
      sumMatieresPurchasesForDate(date),
      listDetailProduits({ dateFrom: date, dateTo: date, scopeSite }),
    ]);
  return {
    view: "day",
    label: date,
    date,
    day,
    caisseDepenses: caisse.totalDepense,
    caisseRecettes: caisse.totalRecette,
    caisseSessions: caisse.sessions,
    caisseParCaisse,
    matieresPurchasesToday,
    detailProduits,
  };
}

export async function getCompteResultatMonth(
  year: number,
  month: number,
  scopeSite?: VenteSite | null,
): Promise<CompteResultatMonth> {
  const mm = String(month).padStart(2, "0");
  const monthKey = `${year}-${mm}`;
  const dateFrom = `${monthKey}-01`;
  const dateTo = `${monthKey}-${String(daysInMonth(year, month)).padStart(2, "0")}`;
  const [data, caisse, caisseParCaisse, detailProduits] = await Promise.all([
    getMonthPoint(year, month, scopeSite),
    sumCaisseDepensesRecettes({ dateFrom, dateTo, scopeSite }),
    sumCaisseDepensesRecettesParCaisse({ dateFrom, dateTo, scopeSite }),
    listDetailProduits({ dateFrom, dateTo, scopeSite }),
  ]);
  return {
    view: "month",
    label: `${MONTH_NAMES[month - 1] ?? monthKey} ${year}`,
    month: monthKey,
    data,
    caisseDepenses: caisse.totalDepense,
    caisseRecettes: caisse.totalRecette,
    caisseSessions: caisse.sessions,
    caisseParCaisse,
    detailProduits,
  };
}

export async function getCompteResultatYear(
  year: number,
  scopeSite?: VenteSite | null,
): Promise<CompteResultatYear> {
  const yearRange = {
    dateFrom: `${year}-01-01`,
    dateTo: `${year}-12-31`,
    scopeSite,
  };
  const [data, caisse, caisseParCaisse, detailProduits] = await Promise.all([
    getYearPoint(year, scopeSite),
    sumCaisseDepensesRecettes(yearRange),
    sumCaisseDepensesRecettesParCaisse(yearRange),
    listDetailProduits(yearRange),
  ]);
  return {
    view: "year",
    label: String(year),
    year,
    data,
    caisseParCaisse,
    caisseDepenses: caisse.totalDepense,
    caisseRecettes: caisse.totalRecette,
    caisseSessions: caisse.sessions,
    detailProduits,
  };
}
