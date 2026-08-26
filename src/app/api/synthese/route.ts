import { NextResponse } from "next/server";
import type { DayCharges } from "@/lib/types";
import { authErrorResponse, requireUser } from "@/lib/api-auth";
import { hasFinanceAccess, resolveRequiredSiteScope } from "@/lib/auth-types";
import {
  chargesTotal,
  daysInMonth,
  parseYearMonth,
} from "@/lib/synthese-calc";
import {
  getCaCumuls,
  getDayPoint,
  getMonthPoint,
  getProductRanking,
  getVenteCancelNotice,
  getYearPoint,
  resolvePeriod,
  saveDayCharges,
} from "@/lib/synthese-repo";
import { sumCaByShift } from "@/lib/vente-repo";
import { getEpuises } from "@/lib/stock-repo";
import { isValidCalendarDate, todayIsoDate } from "@/lib/zogbo-calc";
import { logActivity } from "@/lib/log-activity";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const scope = resolveRequiredSiteScope(user, searchParams.get("site"));
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status });
    }
    const scopeSite = scope.site;
    const period = resolvePeriod(
      {
        view: searchParams.get("view"),
        date: searchParams.get("date"),
        month: searchParams.get("month"),
        year: searchParams.get("year"),
      },
      todayIsoDate(),
    );

    if (period.view === "day") {
      const date = period.date!;
      const match: Record<string, unknown> = { date, site: scopeSite };
      const [day, ranking, cancelNotice, caCumuls, shiftTotals, epuises] =
        await Promise.all([
          getDayPoint(date, scopeSite),
          getProductRanking(match),
          getVenteCancelNotice(match),
          getCaCumuls(date, scopeSite),
          sumCaByShift(date, scopeSite),
          getEpuises({ date, scopeSite }),
        ]);
      return NextResponse.json({
        view: "day",
        day,
        ranking,
        cancelNotice,
        caCumuls,
        shiftTotals,
        epuises,
        role: user.role,
        scopeSite,
        lockedSite: user.site !== "tous",
        allowedSites:
          user.site === "tous"
            ? (["zogbo", "gbegamey"] as const)
            : ([user.site] as const),
      });
    }

    if (period.view === "month") {
      const { year, month } = parseYearMonth(period.month!);
      const dates = daysInMonth(year, month);
      const match: Record<string, unknown> = {
        date: { $in: dates },
        site: scopeSite,
      };
      const [data, ranking, cancelNotice, caCumuls] = await Promise.all([
        getMonthPoint(year, month, scopeSite),
        getProductRanking(match),
        getVenteCancelNotice(match),
        getCaCumuls(`${period.month}-01`, scopeSite),
      ]);
      return NextResponse.json({
        view: "month",
        month: data,
        ranking,
        cancelNotice,
        caCumuls,
        role: user.role,
        scopeSite,
        lockedSite: user.site !== "tous",
        allowedSites:
          user.site === "tous"
            ? (["zogbo", "gbegamey"] as const)
            : ([user.site] as const),
      });
    }

    const yearNum = period.year!;
    const match: Record<string, unknown> = {
      date: { $gte: `${yearNum}-01-01`, $lte: `${yearNum}-12-31` },
      site: scopeSite,
    };
    const [data, ranking, cancelNotice, caCumuls] = await Promise.all([
      getYearPoint(yearNum, scopeSite),
      getProductRanking(match),
      getVenteCancelNotice(match),
      getCaCumuls(`${yearNum}-12-31`, scopeSite),
    ]);
    return NextResponse.json({
      view: "year",
      year: data,
      ranking,
      cancelNotice,
      caCumuls,
      role: user.role,
      scopeSite,
      lockedSite: user.site !== "tous",
      allowedSites:
        user.site === "tous"
          ? (["zogbo", "gbegamey"] as const)
          : ([user.site] as const),
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const user = await requireUser();
    const body = (await request.json()) as Partial<DayCharges> & {
      date?: string;
      site?: string;
    };
    const scope = resolveRequiredSiteScope(user, body.site);
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status });
    }

    // `date` est utilisé comme _id du document de charges : un objet JSON
    // malveillant (ex. {"$regex": "^2026-08"}) ne doit jamais atteindre la
    // requête Mongo — type et forme calendaire exigés.
    if (!isValidCalendarDate(body.date)) {
      return NextResponse.json(
        { error: "date invalide (jour calendaire attendu, YYYY-MM-DD)." },
        { status: 400 },
      );
    }

    // Les charges sont globales (loyer, salaires… des deux restaurants) :
    // leur écriture fausse le compte de résultat entier, elle est donc
    // réservée à la direction — comme l'affichage du bouton côté écran.
    if (!hasFinanceAccess(user.role)) {
      return NextResponse.json(
        {
          error:
            "Enregistrement des charges réservé au comptable, au DAF ou à l'administrateur.",
        },
        { status: 403 },
      );
    }

    for (const value of [
      body.matieresPremieres,
      body.loyer,
      body.salaires,
      body.electricite,
      body.carburant,
      body.reparations,
    ]) {
      if (
        value !== undefined &&
        (!Number.isFinite(Number(value)) || Number(value) < 0)
      ) {
        return NextResponse.json(
          { error: "Montants invalides : nombres positifs attendus." },
          { status: 400 },
        );
      }
    }

    const charges = {
      date: body.date,
      matieresPremieres: body.matieresPremieres ?? 0,
      loyer: body.loyer ?? 0,
      salaires: body.salaires ?? 0,
      electricite: body.electricite ?? 0,
      carburant: body.carburant ?? 0,
      reparations: body.reparations ?? 0,
    };

    const saved = await saveDayCharges(charges);
    await logActivity({
      user,
      kind: "charges",
      title: `Charges · ${body.date}`,
      detail: `Charges du jour · ${scope.site === "zogbo" ? "Zogbo" : "Gbégamey"}`,
      date: body.date,
      site: scope.site,
      amount: chargesTotal({ ...charges, updatedAt: null }),
    });

    const day = await getDayPoint(saved.date, scope.site);
    return NextResponse.json({ charges: saved, day, scopeSite: scope.site });
  } catch (error) {
    return authErrorResponse(error);
  }
}
