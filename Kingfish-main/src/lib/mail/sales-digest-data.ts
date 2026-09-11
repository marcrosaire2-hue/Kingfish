import { getDb } from "@/lib/mongodb";
import type { UserShift } from "@/lib/auth-types";
import type { VenteSite } from "@/lib/types";
import {
  sumCaByShiftRange,
  sumCaForSite,
  sumPosReductions,
  sumPosReductionsByShiftRange,
} from "@/lib/vente-repo";

function sumRemisesMap(
  map: Map<string, Record<UserShift, number>>,
): number {
  let total = 0;
  for (const bucket of map.values()) {
    for (const n of Object.values(bucket)) total += n;
  }
  return total;
}

/** Aligné sur le CA journal : hors annulés / exclus / lignes combo (composants déjà comptés). */
const ACTIVE = {
  cancelledAt: null,
  caExcluded: { $ne: true },
  kind: { $ne: "combo" },
};

export const DIGEST_KIND_LABELS: Record<string, string> = {
  plat: "Plat",
  local: "Accompagnement",
  boisson: "Boisson",
  extra: "Extra / libre",
  combo: "Combo",
};

export type DigestProductLine = {
  name: string;
  kind: string;
  kindLabel: string;
  site: VenteSite;
  qty: number;
  /** Prix unitaire moyen (FCFA). */
  unitPrice: number;
  amount: number;
};

export type DigestKindSlice = {
  kind: string;
  label: string;
  qty: number;
  amount: number;
};

export type SalesDigestReport = {
  kind: "day" | "month";
  label: string;
  from: string;
  to: string;
  zogbo: number;
  gbegamey: number;
  total: number;
  remises: number;
  brut: number;
  articles: number;
  lignes: number;
  byKind: DigestKindSlice[];
  products: DigestProductLine[];
};

type AggRow = {
  _id: {
    site: VenteSite;
    kind: string;
    productId: string;
    name: string;
  };
  qty: number;
  amount: number;
  unitPriceSum: number;
  lines: number;
};

async function aggregateProducts(
  from: string,
  to: string,
): Promise<{ products: DigestProductLine[]; lignes: number; articles: number }> {
  const db = await getDb();
  const rows = await db
    .collection("ventes_log")
    .aggregate<AggRow>([
      {
        $match: {
          ...ACTIVE,
          date: from === to ? from : { $gte: from, $lte: to },
        },
      },
      {
        $group: {
          _id: {
            site: "$site",
            kind: "$kind",
            productId: "$productId",
            name: "$name",
          },
          qty: { $sum: "$qty" },
          amount: { $sum: "$amount" },
          unitPriceSum: { $sum: { $multiply: ["$unitPrice", "$qty"] } },
          lines: { $sum: 1 },
        },
      },
      { $sort: { amount: -1, qty: -1 } },
    ])
    .toArray();

  let lignes = 0;
  let articles = 0;
  const products: DigestProductLine[] = rows.map((r) => {
    lignes += r.lines;
    articles += r.qty;
    const qty = r.qty || 0;
    const unitPrice =
      qty > 0
        ? Math.round(r.unitPriceSum / qty)
        : Math.round(r.amount || 0);
    const kind = String(r._id.kind || "extra");
    return {
      name: String(r._id.name || "—"),
      kind,
      kindLabel: DIGEST_KIND_LABELS[kind] ?? kind,
      site: r._id.site === "gbegamey" ? "gbegamey" : "zogbo",
      qty,
      unitPrice,
      amount: Math.round(r.amount || 0),
    };
  });

  return { products, lignes, articles };
}

function slicesFromProducts(products: DigestProductLine[]): DigestKindSlice[] {
  const map = new Map<string, DigestKindSlice>();
  for (const p of products) {
    const cur = map.get(p.kind) ?? {
      kind: p.kind,
      label: p.kindLabel,
      qty: 0,
      amount: 0,
    };
    cur.qty += p.qty;
    cur.amount += p.amount;
    map.set(p.kind, cur);
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}

function monthLabel(ym: string): string {
  const [ys, ms] = ym.split("-");
  const y = Number(ys);
  const m = Number(ms);
  return new Intl.DateTimeFormat("fr-FR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, 1)));
}

function dayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** Rapport détaillé pour un jour calendaire (Zogbo + Gbégamey). */
export async function buildDailySalesDigest(
  date: string,
): Promise<SalesDigestReport> {
  const [{ products, lignes, articles }, zogbo, gbegamey, remZ, remG] =
    await Promise.all([
      aggregateProducts(date, date),
      sumCaForSite(date, "zogbo"),
      sumCaForSite(date, "gbegamey"),
      sumPosReductions(date, "zogbo"),
      sumPosReductions(date, "gbegamey"),
    ]);
  const remises = remZ + remG;
  const total = zogbo + gbegamey;
  const brut = total + remises;
  return {
    kind: "day",
    label: dayLabel(date),
    from: date,
    to: date,
    zogbo,
    gbegamey,
    total,
    remises,
    brut,
    articles,
    lignes,
    byKind: slicesFromProducts(products),
    products,
  };
}

/** Rapport détaillé pour un mois civil (YYYY-MM). */
export async function buildMonthlySalesDigest(
  ym: string,
): Promise<SalesDigestReport> {
  const [ys, ms] = ym.split("-");
  const y = Number(ys);
  const m = Number(ms);
  const from = `${ys}-${ms}-01`;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const to = `${ys}-${ms}-${String(last).padStart(2, "0")}`;

  const [{ products, lignes, articles }, zogbo, gbegamey, remises] =
    await Promise.all([
      aggregateProducts(from, to),
      sumCaByShiftRange(from, to, "zogbo").then((r) => r.totals.total),
      sumCaByShiftRange(from, to, "gbegamey").then((r) => r.totals.total),
      Promise.all([
        sumPosReductionsByShiftRange(from, to, "zogbo"),
        sumPosReductionsByShiftRange(from, to, "gbegamey"),
      ]).then(([a, b]) => sumRemisesMap(a) + sumRemisesMap(b)),
    ]);

  const total = zogbo + gbegamey;
  return {
    kind: "month",
    label: monthLabel(ym),
    from,
    to,
    zogbo,
    gbegamey,
    total,
    remises,
    brut: total + remises,
    articles,
    lignes,
    byKind: slicesFromProducts(products),
    products,
  };
}
