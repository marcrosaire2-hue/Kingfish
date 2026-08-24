import { getDb } from "@/lib/mongodb";
import {
  allocatedReductionsByProduct,
  type TicketForNetCa,
} from "@/lib/ca-allocation";
import type { SessionUser } from "@/lib/auth-types";
import { canAccessPath } from "@/lib/auth-types";
import {
  analyseWindow,
  applyReductionsToProducts,
  buildAnalyseReport,
  kindLabel,
  parseAnalyseKind,
  parseAnalysePeriod,
  parseAnalyseShift,
  rankProducts,
  resolveAnalyseSite,
  shiftLabel,
  siteLabel,
  snapshotFromHouse,
  slicesFromMap,
  type AnalyseKindFilter,
  type AnalysePeriod,
  type AnalyseReport,
  type AnalyseShiftFilter,
  type ProductSnapshot,
} from "@/lib/analyse-calc";
import { sumChargesBreakdown } from "@/lib/synthese-calc";
import { getPointsInRange } from "@/lib/synthese-repo";
import { sumCaByShiftRange } from "@/lib/vente-repo";
import { sumCaisseDepensesRecettes } from "@/lib/caisse-repo";
import { getEpuises } from "@/lib/stock-repo";
import { listImmobilisations } from "@/lib/immobilisations-repo";
import { isValidCalendarDate } from "@/lib/zogbo-calc";
import type { DayPoint, PosTicket, VenteKind, VenteSite } from "@/lib/types";

export class AnalyseError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function assertAnalyseAccess(user: SessionUser) {
  if (!canAccessPath(user.role, "/analyse", user.site, user.username)) {
    throw new AnalyseError("Accès refusé.", 403);
  }
}

/** Aligné sur le CA actif (hors annulées, hors combo, hors caExcluded). */
export function ventesActivesMatch(
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const kind = extra.kind;
  const rest = { ...extra };
  delete rest.kind;
  return {
    cancelledAt: null,
    caExcluded: { $ne: true },
    kind: kind ?? { $ne: "combo" },
    ...rest,
    ...(kind !== undefined ? { kind } : {}),
  };
}

type ProductAgg = {
  _id: { productId: string; kind: string };
  name: string;
  qty: number;
  caBrut: number;
  costAmount: number;
};

function houseFromDays(days: DayPoint[]) {
  const breakdown = sumChargesBreakdown(days);
  const caNet = days.reduce((s, d) => s + d.caTotal, 0);
  const remises = days.reduce(
    (s, d) => s + d.caReductionsZogbo + d.caReductionsGbegamey,
    0,
  );
  const cmv =
    breakdown.matieresConsommees +
    breakdown.cmvBoissons +
    breakdown.cmvEmballages;
  return snapshotFromHouse({
    caBrut: caNet + remises,
    remises,
    caNet,
    cmv,
    chargesExploitation: days.reduce((s, d) => s + d.chargesTotal, 0),
    resultat: days.reduce((s, d) => s + d.resultat, 0),
    pertes: breakdown.pertes,
    achatsStock: breakdown.achatsStock,
    amortissements: breakdown.amortissements,
    acquisitionsImmobilisations: 0,
    caisseDepenses: 0,
    caisseRecettes: 0,
    epuises: 0,
  });
}

async function loadProductSnapshots(input: {
  from: string;
  to: string;
  site: VenteSite | null;
  shift: AnalyseShiftFilter;
  kind: AnalyseKindFilter;
}): Promise<ProductSnapshot[]> {
  const db = await getDb();
  const match: Record<string, unknown> = {
    date: { $gte: input.from, $lte: input.to },
    qty: { $gt: 0 },
  };
  if (input.site) match.site = input.site;
  if (input.shift !== "all") match.shift = input.shift;
  if (input.kind !== "all") match.kind = input.kind;

  const ticketMatch: Record<string, unknown> = {
    statut: "valide",
    reduction: { $gt: 0 },
    date: { $gte: input.from, $lte: input.to },
  };
  if (input.site) ticketMatch.site = input.site;
  if (input.shift !== "all") {
    ticketMatch.$or =
      input.shift === "aucune"
        ? [{ shift: "aucune" }, { shift: { $exists: false } }, { shift: null }]
        : [{ shift: input.shift }];
  }

  const [rows, tickets] = await Promise.all([
    db
      .collection("ventes_log")
      .aggregate<ProductAgg>([
        { $match: ventesActivesMatch(match) },
        {
          $group: {
            _id: { productId: "$productId", kind: "$kind" },
            name: { $first: "$name" },
            qty: { $sum: "$qty" },
            caBrut: { $sum: "$amount" },
            costAmount: {
              $sum: { $multiply: ["$qty", { $ifNull: ["$costPrice", 0] }] },
            },
          },
        },
      ])
      .toArray(),
    db
      .collection<PosTicket>("pos_tickets")
      .find(ticketMatch, {
        projection: { site: 1, reduction: 1, lines: 1, shift: 1 },
      })
      .toArray(),
  ]);

  const remisesByKey = allocatedReductionsByProduct(
    tickets.map(
      (t): TicketForNetCa => ({
        site: t.site,
        reduction: Number(t.reduction) || 0,
        lines: (t.lines ?? [])
          .filter((l) => (input.kind === "all" ? true : l.kind === input.kind))
          .map((l) => ({
            productId: String(l.productId || ""),
            kind: String(l.kind || "extra"),
            amount: Number(l.amount) || 0,
          })),
      }),
    ),
  );

  return applyReductionsToProducts(
    rows.map((r) => ({
      productId: String(r._id.productId ?? ""),
      name: String(r.name || "Sans nom"),
      kind: (r._id.kind || "extra") as VenteKind,
      qty: Number(r.qty) || 0,
      caBrut: Math.round(Number(r.caBrut) || 0),
      costAmount: Math.round(Number(r.costAmount) || 0),
    })),
    remisesByKey,
  );
}

async function acquisitionsInRange(
  from: string,
  to: string,
  site: VenteSite | null,
): Promise<number> {
  const items = await listImmobilisations({
    kind: "all",
    active: "all",
    site: site ?? "all",
    includeUnscoped: !site,
  });
  let total = 0;
  for (const item of items) {
    if (item.date < from || item.date > to) continue;
    const amount =
      item.acquisitionAmount != null
        ? Number(item.acquisitionAmount) || 0
        : (Number(item.cost) || 0) * (Number(item.qty) || 0);
    total += Math.max(0, Math.round(amount));
  }
  return total;
}

async function loadSiteCa(input: {
  from: string;
  to: string;
  shift: AnalyseShiftFilter;
  kind: AnalyseKindFilter;
}): Promise<Map<string, number>> {
  const db = await getDb();
  const extra: Record<string, unknown> = {
    date: { $gte: input.from, $lte: input.to },
    qty: { $gt: 0 },
  };
  if (input.shift !== "all") extra.shift = input.shift;
  if (input.kind !== "all") extra.kind = input.kind;
  const rows = await db
    .collection("ventes_log")
    .aggregate<{ _id: string; ca: number }>([
      { $match: ventesActivesMatch(extra) },
      { $group: { _id: "$site", ca: { $sum: "$amount" } } },
    ])
    .toArray();
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(String(row._id), Math.round(Number(row.ca) || 0));
  }
  return map;
}

export async function loadAnalyseReport(input: {
  user: SessionUser;
  period: AnalysePeriod;
  date: string;
  requestedSite: string | null;
  shift: AnalyseShiftFilter;
  kind: AnalyseKindFilter;
}): Promise<AnalyseReport> {
  assertAnalyseAccess(input.user);
  const scope = resolveAnalyseSite(input.user.site, input.requestedSite);
  if (!scope.ok) throw new AnalyseError(scope.error, scope.status);

  const window = analyseWindow(input.period, input.date);
  const filteredCa = input.shift !== "all" || input.kind !== "all";
  const siteArg = scope.site ?? "all";

  const [
    currentDays,
    previousDays,
    currentProducts,
    previousProducts,
    currentShifts,
    currentCaisse,
    previousCaisse,
    currentEpuises,
    currentAcq,
    previousAcq,
    siteCa,
  ] = await Promise.all([
    getPointsInRange(window.from, window.to, scope.site),
    getPointsInRange(window.previousFrom, window.previousTo, scope.site),
    loadProductSnapshots({
      from: window.from,
      to: window.to,
      site: scope.site,
      shift: input.shift,
      kind: input.kind,
    }),
    loadProductSnapshots({
      from: window.previousFrom,
      to: window.previousTo,
      site: scope.site,
      shift: input.shift,
      kind: input.kind,
    }),
    sumCaByShiftRange(window.from, window.to, siteArg),
    sumCaisseDepensesRecettes({
      dateFrom: window.from,
      dateTo: window.to,
      scopeSite: scope.site,
    }),
    sumCaisseDepensesRecettes({
      dateFrom: window.previousFrom,
      dateTo: window.previousTo,
      scopeSite: scope.site,
    }),
    getEpuises({ date: window.to, scopeSite: scope.site }),
    acquisitionsInRange(window.from, window.to, scope.site),
    acquisitionsInRange(
      window.previousFrom,
      window.previousTo,
      scope.site,
    ),
    scope.site
      ? Promise.resolve(new Map<string, number>())
      : loadSiteCa({
          from: window.from,
          to: window.to,
          shift: input.shift,
          kind: input.kind,
        }),
  ]);

  const current = {
    ...houseFromDays(currentDays),
    acquisitionsImmobilisations: currentAcq,
    caisseDepenses: currentCaisse.totalDepense,
    caisseRecettes: currentCaisse.totalRecette,
    epuises: currentEpuises.length,
  };
  const previous = {
    ...houseFromDays(previousDays),
    acquisitionsImmobilisations: previousAcq,
    caisseDepenses: previousCaisse.totalDepense,
    caisseRecettes: previousCaisse.totalRecette,
    epuises: 0,
  };

  if (filteredCa) {
    current.caNet = currentProducts.reduce((s, p) => s + p.caNet, 0);
    current.remises = currentProducts.reduce((s, p) => s + p.remises, 0);
    current.caBrut = currentProducts.reduce((s, p) => s + p.caBrut, 0);
    previous.caNet = previousProducts.reduce((s, p) => s + p.caNet, 0);
    previous.remises = previousProducts.reduce((s, p) => s + p.remises, 0);
    previous.caBrut = previousProducts.reduce((s, p) => s + p.caBrut, 0);
  }

  const byKindMap = new Map<string, number>();
  for (const p of currentProducts) {
    byKindMap.set(p.kind, (byKindMap.get(p.kind) ?? 0) + p.caNet);
  }

  const bySiteMap = scope.site
    ? new Map([[scope.site, current.caNet]])
    : siteCa;

  const byShiftMap = new Map<string, number>([
    ["jour", currentShifts.totals.jour],
    ["nuit", currentShifts.totals.nuit],
    ["aucune", currentShifts.totals.aucune],
  ]);

  return buildAnalyseReport({
    window,
    current,
    previous,
    products: rankProducts(currentProducts, previousProducts),
    byKind: slicesFromMap(byKindMap, kindLabel),
    bySite: slicesFromMap(bySiteMap, siteLabel),
    byShift: slicesFromMap(byShiftMap, shiftLabel),
    filteredCa,
  });
}

export function parseAnalyseQuery(
  searchParams: URLSearchParams,
  fallbackDate: string,
) {
  const period = parseAnalysePeriod(searchParams.get("period"));
  const date = searchParams.get("date") ?? fallbackDate;
  if (!isValidCalendarDate(date)) {
    throw new AnalyseError("Date invalide (YYYY-MM-DD attendu).", 400);
  }
  const shift = parseAnalyseShift(searchParams.get("shift"));
  if (shift === null) throw new AnalyseError("Équipe invalide.", 400);
  const kind = parseAnalyseKind(searchParams.get("kind"));
  if (kind === null) throw new AnalyseError("Nature de produit invalide.", 400);
  return {
    period,
    date,
    requestedSite: searchParams.get("site"),
    shift,
    kind,
  };
}
