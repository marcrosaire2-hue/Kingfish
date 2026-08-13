import {
  sumCaisseDepensesRecettes,
  sumCaisseDepensesRecettesParCaisse,
  type CaisseDepensesRecettesRow,
} from "@/lib/caisse-repo";
import { sumMatieresPurchasesForDate } from "@/lib/matieres-repo";
import {
  getDayPoint,
  getMonthPoint,
  getYearPoint,
} from "@/lib/synthese-repo";
import type {
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

export async function getCompteResultatDay(
  date: string,
  scopeSite?: VenteSite | null,
): Promise<CompteResultatDay> {
  const [day, caisse, caisseParCaisse, matieresPurchasesToday] = await Promise.all([
    getDayPoint(date, scopeSite),
    sumCaisseDepensesRecettes({ dateFrom: date, dateTo: date, scopeSite }),
    sumCaisseDepensesRecettesParCaisse({ dateFrom: date, dateTo: date, scopeSite }),
    sumMatieresPurchasesForDate(date),
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
  const [data, caisse, caisseParCaisse] = await Promise.all([
    getMonthPoint(year, month, scopeSite),
    sumCaisseDepensesRecettes({ dateFrom, dateTo, scopeSite }),
    sumCaisseDepensesRecettesParCaisse({ dateFrom, dateTo, scopeSite }),
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
  };
}

export async function getCompteResultatYear(
  year: number,
  scopeSite?: VenteSite | null,
): Promise<CompteResultatYear> {
  const yearRange = { dateFrom: `${year}-01-01`, dateTo: `${year}-12-31`, scopeSite };
  const [data, caisse, caisseParCaisse] = await Promise.all([
    getYearPoint(year, scopeSite),
    sumCaisseDepensesRecettes(yearRange),
    sumCaisseDepensesRecettesParCaisse(yearRange),
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
  };
}
