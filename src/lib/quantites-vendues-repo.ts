import type { Filter } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { VenteKind, VenteSite } from "@/lib/types";

/** Ligne active dans ventes_log (annulées / formules exclues). */
const ACTIVE = {
  cancelledAt: null,
  caExcluded: { $ne: true },
  kind: { $ne: "combo" },
} as const;

export type QuantiteVendueRow = {
  productId: string;
  name: string;
  kind: VenteKind;
  qty: number;
  amount: number;
  lignes: number;
  /** Répartition par site (utile quand le filtre est « tous »). */
  bySite: Partial<Record<VenteSite, number>>;
  firstDate: string;
  lastDate: string;
};

export type QuantitesVenduesPayload = {
  from: string;
  to: string;
  site: "all" | VenteSite;
  kind: "all" | VenteKind;
  q: string;
  rows: QuantiteVendueRow[];
  totals: {
    articles: number;
    qty: number;
    amount: number;
    lignes: number;
  };
};

type AggRow = {
  _id: { productId: string; kind: string };
  name: string;
  qty: number;
  amount: number;
  lignes: number;
  firstDate: string;
  lastDate: string;
  sites: Array<{ site: string; qty: number }>;
};

function isValidDate(d: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(d);
}

/**
 * Quantités vendues par article sur une période.
 * Source : ventes_log actives (hors annulations).
 */
export async function getQuantitesVendues(input: {
  from: string;
  to: string;
  site: "all" | VenteSite;
  kind?: "all" | VenteKind;
  q?: string;
}): Promise<QuantitesVenduesPayload> {
  const from = isValidDate(input.from) ? input.from : input.to;
  const to = isValidDate(input.to) ? input.to : from;
  const kind = input.kind ?? "all";
  const q = (input.q ?? "").trim();

  const match: Filter<Record<string, unknown>> = {
    ...ACTIVE,
    date: { $gte: from, $lte: to },
    qty: { $gt: 0 },
  };
  if (input.site !== "all") {
    match.site = input.site;
  }
  if (kind !== "all") {
    match.kind = kind;
  }
  if (q) {
    match.name = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
  }

  const db = await getDb();
  const rows = await db
    .collection("ventes_log")
    .aggregate<AggRow>([
      { $match: match },
      {
        $group: {
          _id: {
            productId: "$productId",
            kind: "$kind",
            site: "$site",
          },
          name: { $last: "$name" },
          qty: { $sum: "$qty" },
          amount: { $sum: "$amount" },
          lignes: { $sum: 1 },
          firstDate: { $min: "$date" },
          lastDate: { $max: "$date" },
        },
      },
      {
        $group: {
          _id: {
            productId: "$_id.productId",
            kind: "$_id.kind",
          },
          name: { $last: "$name" },
          qty: { $sum: "$qty" },
          amount: { $sum: "$amount" },
          lignes: { $sum: "$lignes" },
          firstDate: { $min: "$firstDate" },
          lastDate: { $max: "$lastDate" },
          sites: {
            $push: { site: "$_id.site", qty: "$qty" },
          },
        },
      },
      { $sort: { qty: -1, name: 1 } },
    ])
    .toArray();

  const mapped: QuantiteVendueRow[] = rows.map((r) => {
    const bySite: Partial<Record<VenteSite, number>> = {};
    for (const s of r.sites ?? []) {
      if (s.site === "zogbo" || s.site === "gbegamey") {
        bySite[s.site] = (bySite[s.site] ?? 0) + (Number(s.qty) || 0);
      }
    }
    return {
      productId: String(r._id.productId ?? ""),
      name: String(r.name || "Sans nom"),
      kind: (r._id.kind || "extra") as VenteKind,
      qty: Number(r.qty) || 0,
      amount: Number(r.amount) || 0,
      lignes: Number(r.lignes) || 0,
      bySite,
      firstDate: String(r.firstDate || from),
      lastDate: String(r.lastDate || to),
    };
  });

  const totals = mapped.reduce(
    (acc, row) => {
      acc.qty += row.qty;
      acc.amount += row.amount;
      acc.lignes += row.lignes;
      return acc;
    },
    { articles: mapped.length, qty: 0, amount: 0, lignes: 0 },
  );

  return {
    from,
    to,
    site: input.site,
    kind,
    q,
    rows: mapped,
    totals,
  };
}
