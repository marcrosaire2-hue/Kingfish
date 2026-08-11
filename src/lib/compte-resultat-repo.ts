import { sumCaisseDepensesRecettes } from "@/lib/caisse-repo";
import {
  getDayPoint,
  getMonthPoint,
  getYearPoint,
} from "@/lib/synthese-repo";
import type { DayPoint, MonthPoint, YearPoint } from "@/lib/types";

export type CompteResultatDay = {
  view: "day";
  label: string;
  date: string;
  day: DayPoint;
  caisseDepenses: number;
  caisseRecettes: number;
  caisseSessions: number;
};

export type CompteResultatMonth = {
  view: "month";
  label: string;
  month: string;
  data: MonthPoint;
  caisseDepenses: number;
  caisseRecettes: number;
  caisseSessions: number;
};

export type CompteResultatYear = {
  view: "year";
  label: string;
  year: number;
  data: YearPoint;
  caisseDepenses: number;
  caisseRecettes: number;
  caisseSessions: number;
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
): Promise<CompteResultatDay> {
  const [day, caisse] = await Promise.all([
    getDayPoint(date),
    sumCaisseDepensesRecettes({ dateFrom: date, dateTo: date }),
  ]);
  return {
    view: "day",
    label: date,
    date,
    day,
    caisseDepenses: caisse.totalDepense,
    caisseRecettes: caisse.totalRecette,
    caisseSessions: caisse.sessions,
  };
}

export async function getCompteResultatMonth(
  year: number,
  month: number,
): Promise<CompteResultatMonth> {
  const mm = String(month).padStart(2, "0");
  const monthKey = `${year}-${mm}`;
  const dateFrom = `${monthKey}-01`;
  const dateTo = `${monthKey}-${String(daysInMonth(year, month)).padStart(2, "0")}`;
  const [data, caisse] = await Promise.all([
    getMonthPoint(year, month),
    sumCaisseDepensesRecettes({ dateFrom, dateTo }),
  ]);
  return {
    view: "month",
    label: `${MONTH_NAMES[month - 1] ?? monthKey} ${year}`,
    month: monthKey,
    data,
    caisseDepenses: caisse.totalDepense,
    caisseRecettes: caisse.totalRecette,
    caisseSessions: caisse.sessions,
  };
}

export async function getCompteResultatYear(
  year: number,
): Promise<CompteResultatYear> {
  const [data, caisse] = await Promise.all([
    getYearPoint(year),
    sumCaisseDepensesRecettes({
      dateFrom: `${year}-01-01`,
      dateTo: `${year}-12-31`,
    }),
  ]);
  return {
    view: "year",
    label: String(year),
    year,
    data,
    caisseDepenses: caisse.totalDepense,
    caisseRecettes: caisse.totalRecette,
    caisseSessions: caisse.sessions,
  };
}
