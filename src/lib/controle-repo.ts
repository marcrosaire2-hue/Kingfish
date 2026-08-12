import { getDb } from "@/lib/mongodb";
import { getParametres } from "@/lib/parametres-repo";
import { computeBoissonsDay } from "@/lib/boissons-calc";
import { computeCombosDay } from "@/lib/combos-calc";
import { computeGbegameyDay } from "@/lib/gbegamey-calc";
import { computeMatieresDay } from "@/lib/matieres-calc";
import { computeZogboDay } from "@/lib/zogbo-calc";
import { getBoissonsDayPayload } from "@/lib/boissons-repo";
import { getCombosDayPayload } from "@/lib/combos-repo";
import { getGbegameyDayPayload } from "@/lib/gbegamey-repo";
import { getMatieresDayPayload } from "@/lib/matieres-repo";
import { getZogboDayPayload } from "@/lib/zogbo-repo";
import type { VenteSite } from "@/lib/types";
import { shiftIsoDate } from "@/lib/zogbo-calc";

const ACTIVE = { cancelledAt: null, caExcluded: { $ne: true } };

export type OpeningRow = {
  zone:
    | "zogbo-plats"
    | "gbegamey-recu"
    | "gbegamey-local"
    | "combos"
    | "boissons"
    | "matieres";
  zoneLabel: string;
  productId: string;
  name: string;
  /** Point initial / ouverture du jour */
  opening: number;
  /** Unité affichée (portions, casiers, etc.) */
  unit: string;
  extra?: Record<string, number | string | null>;
};

export type CaSourceRow = {
  source: string;
  lignes: number;
  montant: number;
};

export type CaDayRow = {
  date: string;
  journalZogbo: number;
  journalGbegamey: number;
  journalTotal: number;
  compteurZogbo: number;
  compteurGbegamey: number;
  compteurTotal: number;
  ecart: number;
  sources: CaSourceRow[];
  hasJournal: boolean;
  hasCompteur: boolean;
};

export type ControlePayload = {
  date: string;
  from: string;
  to: string;
  scopeSite: VenteSite | null;
  gbegameyOpeningEditable: boolean;
  openings: OpeningRow[];
  caDays: CaDayRow[];
  caTotals: {
    journal: number;
    compteur: number;
    ecart: number;
  };
};

function recordToSentMap(sent: Record<string, number>): Map<string, number> {
  return new Map(Object.entries(sent));
}

function isValidDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

function counterCaForDate(input: {
  date: string;
  scopeSite: VenteSite | null;
  zogboDay: Awaited<ReturnType<typeof getZogboDayPayload>> | null;
  gbegameyDay: Awaited<ReturnType<typeof getGbegameyDayPayload>> | null;
  combosDay: Awaited<ReturnType<typeof getCombosDayPayload>> | null;
  boissonsDay: Awaited<ReturnType<typeof getBoissonsDayPayload>> | null;
  parametres: Awaited<ReturnType<typeof getParametres>>;
}): { zogbo: number; gbegamey: number; hasData: boolean } {
  const {
    scopeSite,
    zogboDay,
    gbegameyDay,
    combosDay,
    boissonsDay,
    parametres,
  } = input;

  let zogbo = 0;
  let gbegamey = 0;
  let hasData = false;

  if (scopeSite !== "gbegamey" && zogboDay?.day.updatedAt) {
    hasData = true;
    const t = computeZogboDay(zogboDay.day, parametres.baseDishes).totals;
    zogbo += t.soldAmount;
  }

  if (scopeSite !== "zogbo" && gbegameyDay?.day.updatedAt) {
    hasData = true;
    const sent = zogboDay
      ? new Map(
          zogboDay.day.lines.map((l) => [l.productId, l.sentToGbegamey]),
        )
      : recordToSentMap(gbegameyDay.sentByProductId);
    const t = computeGbegameyDay(
      gbegameyDay.day,
      parametres.baseDishes,
      parametres.localDishes,
      sent,
    ).totals;
    gbegamey += t.soldAmount;
  }

  if (combosDay?.day.updatedAt) {
    hasData = true;
    const t = computeCombosDay(combosDay.day, parametres.combos).totals;
    if (scopeSite !== "gbegamey") zogbo += t.soldAmountZogbo;
    if (scopeSite !== "zogbo") gbegamey += t.soldAmountGbegamey;
  }

  if (boissonsDay?.day.updatedAt) {
    hasData = true;
    const t = computeBoissonsDay(boissonsDay.day, parametres.drinks).totals;
    if (scopeSite !== "gbegamey") zogbo += t.soldAmountZogbo;
    if (scopeSite !== "zogbo") gbegamey += t.soldAmountGbegamey;
  }

  return { zogbo, gbegamey, hasData };
}

async function loadOpenings(
  date: string,
  scopeSite: VenteSite | null,
): Promise<{ rows: OpeningRow[]; gbegameyOpeningEditable: boolean }> {
  const parametres = await getParametres();
  const rows: OpeningRow[] = [];
  let gbegameyOpeningEditable = false;

  if (scopeSite !== "gbegamey") {
    const { day } = await getZogboDayPayload(date);
    const computed = computeZogboDay(day, parametres.baseDishes);
    for (const line of computed.lines) {
      rows.push({
        zone: "zogbo-plats",
        zoneLabel: "Zogbo · plats",
        productId: line.productId,
        name: line.name,
        opening: line.stock,
        unit: "portions",
        extra: {
          prepared: line.prepared,
          sent: line.sentToGbegamey,
          sold: line.sold,
          reste: line.theoreticalRemaining,
        },
      });
    }
  }

  if (scopeSite !== "zogbo") {
    const gb = await getGbegameyDayPayload(date);
    gbegameyOpeningEditable = gb.openingEditable;
    const computed = computeGbegameyDay(
      gb.day,
      parametres.baseDishes,
      parametres.localDishes,
      recordToSentMap(gb.sentByProductId),
    );
    for (const line of computed.transfers) {
      rows.push({
        zone: "gbegamey-recu",
        zoneLabel: "Gbégamey · reçu Zogbo",
        productId: line.productId,
        name: line.name,
        opening: line.initialStock,
        unit: "portions",
        extra: {
          received: line.received,
          sold: line.sold,
          reste: line.theoreticalRemaining,
        },
      });
    }
    for (const line of computed.locals) {
      rows.push({
        zone: "gbegamey-local",
        zoneLabel: "Gbégamey · sur place",
        productId: line.productId,
        name: line.name,
        opening: line.initialStock,
        unit: "portions",
        extra: {
          prepared: line.prepared,
          sold: line.sold,
          reste: line.theoreticalRemaining,
        },
      });
    }
  }

  const combos = await getCombosDayPayload(date);
  const combosComputed = computeCombosDay(combos.day, parametres.combos);
  for (const line of combosComputed.lines) {
    if (scopeSite !== "gbegamey" && (line.stockZogbo > 0 || line.soldZogbo > 0)) {
      rows.push({
        zone: "combos",
        zoneLabel: "Combos · Zogbo",
        productId: line.productId,
        name: line.name,
        opening: line.stockZogbo,
        unit: "portions",
        extra: { sold: line.soldZogbo },
      });
    }
    if (
      scopeSite !== "zogbo" &&
      (line.initialGbegamey > 0 || line.soldGbegamey > 0)
    ) {
      rows.push({
        zone: "combos",
        zoneLabel: "Combos · Gbégamey",
        productId: line.productId,
        name: line.name,
        opening: line.initialGbegamey,
        unit: "portions",
        extra: { sold: line.soldGbegamey },
      });
    }
  }

  const boissons = await getBoissonsDayPayload(date);
  const boissonsComputed = computeBoissonsDay(boissons.day, parametres.drinks);
  for (const line of boissonsComputed.lines) {
    if (line.initialStock > 0 || line.soldZogbo > 0 || line.soldGbegamey > 0) {
      rows.push({
        zone: "boissons",
        zoneLabel: "Boissons",
        productId: line.productId,
        name: line.name,
        opening: line.initialStock,
        unit: "casiers",
        extra: {
          soldZogbo: line.soldZogbo,
          soldGbegamey: line.soldGbegamey,
          resteBt: line.stockBottles,
        },
      });
    }
  }

  const matieres = await getMatieresDayPayload(date);
  const matieresComputed = computeMatieresDay(
    matieres.day,
    parametres.rawMaterials ?? [],
  );
  for (const line of matieresComputed.lines) {
    if (line.initialStock > 0 || line.consumed > 0 || line.purchases > 0) {
      rows.push({
        zone: "matieres",
        zoneLabel: "Matières",
        productId: line.productId,
        name: line.name,
        opening: line.initialStock,
        unit: line.unit || "unités",
        extra: {
          purchases: line.purchases,
          consumed: line.consumed,
          reste: line.stock,
        },
      });
    }
  }

  return { rows, gbegameyOpeningEditable };
}

export async function getControlePayload(input: {
  date: string;
  from: string;
  to: string;
  scopeSite?: VenteSite | null;
}): Promise<ControlePayload> {
  const { date, from, to, scopeSite = null } = input;
  if (!isValidDate(date) || !isValidDate(from) || !isValidDate(to)) {
    throw new Error("Date invalide (attendu YYYY-MM-DD)");
  }
  if (from > to) throw new Error("La date de début doit précéder la fin.");

  const parametres = await getParametres();
  const db = await getDb();

  const journalMatch: Record<string, unknown> = {
    date: { $gte: from, $lte: to },
    ...ACTIVE,
  };
  if (scopeSite) journalMatch.site = scopeSite;

  const [journalByDateSite, sourcesByDate, openings] = await Promise.all([
    db
      .collection("ventes_log")
      .aggregate<{ _id: { date: string; site: VenteSite }; amount: number }>([
        { $match: journalMatch },
        {
          $group: {
            _id: { date: "$date", site: "$site" },
            amount: { $sum: "$amount" },
          },
        },
      ])
      .toArray(),
    db
      .collection("ventes_log")
      .aggregate<{
        _id: { date: string; source: string };
        amount: number;
        n: number;
      }>([
        { $match: journalMatch },
        {
          $group: {
            _id: {
              date: "$date",
              source: { $ifNull: ["$source", "caisse"] },
            },
            amount: { $sum: "$amount" },
            n: { $sum: 1 },
          },
        },
        { $sort: { "_id.date": 1, "_id.source": 1 } },
      ])
      .toArray(),
    loadOpenings(date, scopeSite),
  ]);

  const journalMap = new Map<string, { zogbo: number; gbegamey: number }>();
  for (const row of journalByDateSite) {
    const bucket = journalMap.get(row._id.date) ?? { zogbo: 0, gbegamey: 0 };
    if (row._id.site === "zogbo") bucket.zogbo += row.amount;
    else bucket.gbegamey += row.amount;
    journalMap.set(row._id.date, bucket);
  }

  const sourcesMap = new Map<string, CaSourceRow[]>();
  for (const row of sourcesByDate) {
    const list = sourcesMap.get(row._id.date) ?? [];
    list.push({
      source: row._id.source,
      lignes: row.n,
      montant: row.amount,
    });
    sourcesMap.set(row._id.date, list);
  }

  const dates: string[] = [];
  let cursor: string | null = from;
  while (cursor && cursor <= to) {
    dates.push(cursor);
    cursor = shiftIsoDate(cursor, 1);
  }

  const caDays: CaDayRow[] = [];
  let totalJournal = 0;
  let totalCompteur = 0;

  for (const d of dates) {
    const journal = journalMap.get(d) ?? { zogbo: 0, gbegamey: 0 };
    const journalZogbo = scopeSite === "gbegamey" ? 0 : journal.zogbo;
    const journalGbegamey = scopeSite === "zogbo" ? 0 : journal.gbegamey;
    const journalTotal = journalZogbo + journalGbegamey;

    let compteurZogbo = 0;
    let compteurGbegamey = 0;
    let hasCompteur = false;

    const [zogboDay, gbegameyDay, combosDay, boissonsDay] = await Promise.all([
      scopeSite !== "gbegamey"
        ? getZogboDayPayload(d).catch(() => null)
        : Promise.resolve(null),
      scopeSite !== "zogbo"
        ? getGbegameyDayPayload(d).catch(() => null)
        : Promise.resolve(null),
      getCombosDayPayload(d).catch(() => null),
      getBoissonsDayPayload(d).catch(() => null),
    ]);

    const counter = counterCaForDate({
      date: d,
      scopeSite,
      zogboDay,
      gbegameyDay,
      combosDay,
      boissonsDay,
      parametres,
    });
    compteurZogbo = counter.zogbo;
    compteurGbegamey = counter.gbegamey;
    hasCompteur = counter.hasData;

    const compteurTotal = compteurZogbo + compteurGbegamey;
    const ecart = journalTotal - compteurTotal;

    caDays.push({
      date: d,
      journalZogbo,
      journalGbegamey,
      journalTotal,
      compteurZogbo,
      compteurGbegamey,
      compteurTotal,
      ecart,
      sources: sourcesMap.get(d) ?? [],
      hasJournal: journalTotal > 0,
      hasCompteur,
    });

    totalJournal += journalTotal;
    totalCompteur += compteurTotal;
  }

  return {
    date,
    from,
    to,
    scopeSite,
    gbegameyOpeningEditable: openings.gbegameyOpeningEditable,
    openings: openings.rows,
    caDays,
    caTotals: {
      journal: totalJournal,
      compteur: totalCompteur,
      ecart: totalJournal - totalCompteur,
    },
  };
}
