import { getDb } from "@/lib/mongodb";
import { PERTE_MOTIF_LABELS } from "@/lib/types";

/**
 * Journal des mouvements de stock : chaque ligne est un événement de vente,
 * d'achat, de perte ou de réception (Zogbo → Gbégamey). Les quatre sources
 * sont réunies et triées chronologiquement pour l'audit complet.
 */

export type JournalType = "vente" | "achat" | "perte" | "reception";

export type JournalRow = {
  id: string;
  /** Horodatage ISO (tri) — les réceptions n'ont que la date. */
  at: string;
  date: string;
  site: "zogbo" | "gbegamey";
  type: JournalType;
  /** Famille du produit (plat, local, combo, boisson, extra, matiere…) */
  kind: string;
  productId: string;
  name: string;
  /** Quantité physique du mouvement (positive) */
  qty: number;
  /** +1 = entrée en stock, -1 = sortie de stock */
  direction: 1 | -1;
  unitPrice: number;
  /** qty × prix unitaire (0 pour les réceptions, sans valeur) */
  montant: number;
  /** Mouvement annulé (vente / achat / perte) : il sort du solde réel */
  annule: boolean;
  /** Motif de perte, source de vente, fournisseur d'achat… */
  detail: string;
  acteur: string | null;
  equipe: string | null;
};

export type JournalBalanceRow = {
  site: "zogbo" | "gbegamey";
  kind: string;
  productId: string;
  name: string;
  entrees: number;
  sorties: number;
  /** Entrées − sorties des mouvements non annulés */
  solde: number;
  montant: number;
};

export type JournalTotals = {
  count: number;
  qtyEntrees: number;
  qtySorties: number;
  montant: number;
  byType: Record<JournalType, { count: number; qty: number; montant: number }>;
};

export type JournalStockInput = {
  from?: string | null;
  to?: string | null;
  site?: "tous" | "zogbo" | "gbegamey";
  type?: "tous" | JournalType;
};

export type JournalStockPayload = {
  rows: JournalRow[];
  total: number;
  balance: JournalBalanceRow[];
  totals: JournalTotals;
};

type RawVente = {
  _id: { toHexString(): string };
  date: string;
  site: "zogbo" | "gbegamey";
  kind: string;
  productId: string;
  name: string;
  qty: number;
  unitPrice: number;
  amount: number;
  at: string;
  cancelledAt: string | null;
  source?: string | null;
  shift?: string | null;
  actorName?: string | null;
};

type RawMovement = {
  id: string;
  at: string;
  type: string;
  productId: string;
  name: string;
  qty: number;
  unitPrice: number;
  cancelledAt: string | null;
  fournisseurNom?: string | null;
};

type RawPerte = {
  id: string;
  date: string;
  site: "zogbo" | "gbegamey";
  kind: string;
  productId: string;
  name: string;
  qty: number;
  motif: string;
  commentaire: string;
  unitCost: number;
  cost: number;
  at: string;
  cancelledAt: string | null;
  actorName: string | null;
};

function inRange(
  date: string,
  from: string | null,
  to: string | null,
): boolean {
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

function matchesSite(
  site: "zogbo" | "gbegamey",
  filter: "tous" | "zogbo" | "gbegamey",
): boolean {
  return filter === "tous" || filter === site;
}

function matchesType(type: "tous" | JournalType, want: JournalType): boolean {
  return type === "tous" || type === want;
}

const EMPTY_TOTALS: JournalTotals = {
  count: 0,
  qtyEntrees: 0,
  qtySorties: 0,
  montant: 0,
  byType: {
    vente: { count: 0, qty: 0, montant: 0 },
    achat: { count: 0, qty: 0, montant: 0 },
    perte: { count: 0, qty: 0, montant: 0 },
    reception: { count: 0, qty: 0, montant: 0 },
  },
};

export function buildJournalTotals(
  rows: JournalRow[],
  base: JournalTotals = EMPTY_TOTALS,
): JournalTotals {
  const totals: JournalTotals = {
    count: base.count,
    qtyEntrees: base.qtyEntrees,
    qtySorties: base.qtySorties,
    montant: base.montant,
    byType: {
      vente: { ...base.byType.vente },
      achat: { ...base.byType.achat },
      perte: { ...base.byType.perte },
      reception: { ...base.byType.reception },
    },
  };
  for (const row of rows) {
    totals.count += 1;
    if (row.direction > 0) totals.qtyEntrees += row.qty;
    else totals.qtySorties += row.qty;
    totals.montant += row.montant;
    const t = totals.byType[row.type];
    t.count += 1;
    t.qty += row.qty;
    t.montant += row.montant;
  }
  return totals;
}

export function buildJournalBalance(rows: JournalRow[]): JournalBalanceRow[] {
  const map = new Map<string, JournalBalanceRow>();
  for (const row of rows) {
    if (row.annule) continue;
    const key = `${row.site}|${row.kind}|${row.productId}|${row.name}`;
    let b = map.get(key);
    if (!b) {
      b = {
        site: row.site,
        kind: row.kind,
        productId: row.productId,
        name: row.name,
        entrees: 0,
        sorties: 0,
        solde: 0,
        montant: 0,
      };
      map.set(key, b);
    }
    if (row.direction > 0) b.entrees += row.qty;
    else b.sorties += row.qty;
    b.solde += row.qty * row.direction;
    b.montant += row.montant;
  }
  return [...map.values()].sort((a, b) =>
    a.site === b.site
      ? a.name.localeCompare(b.name, "fr")
      : a.site.localeCompare(b.site),
  );
}

/**
 * Toutes les lignes du journal sur la période, triées chronologiquement.
 * Quatre collections : ventes_log, matieres_jours (achats), pertes et
 * gbegamey_jours (réceptions Zogbo → Gbégamey).
 */
export async function listJournalRows(
  input: JournalStockInput,
): Promise<JournalRow[]> {
  const from = input.from?.trim() || null;
  const to = input.to?.trim() || null;
  const site = input.site ?? "tous";
  const type = input.type ?? "tous";

  const db = await getDb();
  const dateRange =
    from || to
      ? {
          ...(from ? { $gte: from } : {}),
          ...(to ? { $lte: to } : {}),
        }
      : undefined;
  const dateFilter = dateRange ? { date: dateRange } : {};
  const rows: JournalRow[] = [];

  if (matchesType(type, "vente")) {
    const ventes = await db
      .collection("ventes_log")
      .find<RawVente>(
        {
          ...dateFilter,
          ...(site !== "tous" ? { site } : {}),
        },
        {
          projection: {
            date: 1, site: 1, kind: 1, productId: 1, name: 1, qty: 1,
            unitPrice: 1, amount: 1, at: 1, cancelledAt: 1, source: 1,
            shift: 1, actorName: 1,
          },
        },
      )
      .toArray();
    for (const v of ventes) {
      const annule = !!v.cancelledAt;
      rows.push({
        id: `v${v._id.toHexString()}`,
        at: v.at,
        date: v.date,
        site: v.site,
        type: "vente",
        kind: v.kind,
        productId: v.productId,
        name: v.name,
        qty: v.qty,
        // Une vente sort du stock ; son annulation le restitue.
        direction: annule ? 1 : -1,
        unitPrice: v.unitPrice,
        montant: Math.abs(v.amount),
        annule,
        detail: annule ? "Vente annulée" : v.source ?? "",
        acteur: v.actorName ?? null,
        equipe: v.shift ?? null,
      });
    }
  }

  if (matchesType(type, "achat")) {
    const jours = await db
      .collection<{ _id: string; movements?: RawMovement[] }>(
        "matieres_jours",
      )
      .find(
        dateRange ? { _id: dateRange } : {},
        { projection: { movements: 1 } },
      )
      .toArray();
    for (const jour of jours) {
      for (const m of jour.movements ?? []) {
        const annule = !!m.cancelledAt;
        rows.push({
          id: `a${jour._id}|${m.id}`,
          at: m.at,
          date: jour._id,
          site: "zogbo",
          type: "achat",
          kind: "matiere",
          productId: m.productId,
          name: m.name,
          qty: m.qty,
          direction: annule ? -1 : 1,
          unitPrice: m.unitPrice,
          montant: m.qty * m.unitPrice,
          annule,
          detail: annule
            ? "Achat annulé"
            : m.fournisseurNom
              ? `Fournisseur : ${m.fournisseurNom}`
              : "",
          acteur: null,
          equipe: null,
        });
      }
    }
  }

  if (matchesType(type, "perte")) {
    const pertes = await db
      .collection<RawPerte>("pertes")
      .find(
        {
          ...dateFilter,
          ...(site !== "tous" ? { site } : {}),
        },
        {
          projection: {
            date: 1, site: 1, kind: 1, productId: 1, name: 1, qty: 1,
            motif: 1, commentaire: 1, unitCost: 1, cost: 1, at: 1,
            cancelledAt: 1, actorName: 1,
          },
        },
      )
      .toArray();
    for (const p of pertes) {
      const annule = !!p.cancelledAt;
      const motif = PERTE_MOTIF_LABELS[p.motif as keyof typeof PERTE_MOTIF_LABELS] ?? p.motif;
      rows.push({
        id: `p${p.id}`,
        at: p.at,
        date: p.date,
        site: p.site,
        type: "perte",
        kind: p.kind,
        productId: p.productId,
        name: p.name,
        qty: p.qty,
        direction: annule ? 1 : -1,
        unitPrice: p.unitCost,
        montant: p.cost,
        annule,
        detail: annule ? "Perte annulée" : [motif, p.commentaire].filter(Boolean).join(" — "),
        acteur: p.actorName ?? null,
        equipe: null,
      });
    }
  }

  if (matchesType(type, "reception") && (site === "tous" || site === "gbegamey")) {
    const jours = await db
      .collection<{
        _id: string;
        transferLines?: { productId: string; name?: string; received?: number | null }[];
      }>("gbegamey_jours")
      .find(
        dateRange ? { _id: dateRange } : {},
        { projection: { transferLines: 1 } },
      )
      .toArray();
    if (jours.length > 0) {
      // Ce que Zogbo déclare envoyer : référence quand le reçu n'est pas constaté.
      const zogbo = await db
        .collection<{
          _id: string;
          lines?: { productId: string; sentToGbegamey?: number }[];
        }>("zogbo_jours")
        .find(
          dateRange
            ? { _id: dateRange }
            : { "lines.sentToGbegamey": { $gt: 0 } },
          { projection: { lines: 1 } },
        )
        .toArray();
      const sentByDay = new Map<string, Map<string, number>>();
      for (const z of zogbo) {
        const map = new Map<string, number>();
        for (const l of z.lines ?? []) {
          if ((l.sentToGbegamey ?? 0) > 0) map.set(l.productId, l.sentToGbegamey!);
        }
        if (map.size > 0) sentByDay.set(z._id, map);
      }

      for (const jour of jours) {
        const sent = sentByDay.get(jour._id);
        for (const l of jour.transferLines ?? []) {
          const qty = l.received ?? (sent?.get(l.productId) ?? 0);
          if (!(qty > 0)) continue;
          rows.push({
            id: `r${jour._id}|${l.productId}`,
            at: `${jour._id}T00:00:00.000Z`,
            date: jour._id,
            site: "gbegamey",
            type: "reception",
            kind: "plat",
            productId: l.productId,
            name: l.name ?? l.productId,
            qty,
            direction: 1,
            unitPrice: 0,
            montant: 0,
            annule: false,
            detail: l.received === null ? "Selon déclaration Zogbo" : "Reçu constaté",
            acteur: null,
            equipe: null,
          });
        }
      }
    }
  }

  rows.sort((a, b) =>
    a.at === b.at
      ? a.type.localeCompare(b.type)
      : a.at < b.at
        ? -1
        : 1,
  );
  return rows;
}
