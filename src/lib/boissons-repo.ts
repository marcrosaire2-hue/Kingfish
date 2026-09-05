import { assertDayOpen, isValidDate, updateDayDocument } from "@/lib/day-doc";
import { getDb } from "@/lib/mongodb";
import { getParametres } from "@/lib/parametres-repo";
import type {
  BoissonsDay,
  BoissonsLine,
  BoissonsMovement,
  Drink,
  VenteSite,
} from "@/lib/types";
import {
  applyBoissonsPurchaseToState,
  cancelBoissonsMovementInState,
  createEmptyBoissonsDay,
  DEFAULT_UNITS_PER_CASIER,
  leftoverFromBoissonsLines,
  normalizeBoissonsLine,
  normalizeBoissonsMovement,
  syncBoissonsLines,
} from "@/lib/boissons-calc";
import { loadAquaBoissonOpeningCasiers } from "@/lib/aquapro-opening-stock";
import { previousIsoDate } from "@/lib/zogbo-calc";

type BoissonsDoc = Omit<BoissonsDay, "date"> & { _id: string; rev?: number };

function toDay(doc: BoissonsDoc): BoissonsDay {
  const movements = (doc.movements ?? [])
    .map((m) => normalizeBoissonsMovement(m))
    .filter((m): m is BoissonsMovement => !!m);
  return {
    date: doc._id,
    status: doc.status ?? "ouverte",
    lines: (doc.lines ?? []).map((l) => normalizeBoissonsLine(l)),
    movements,
    updatedAt: doc.updatedAt ?? null,
  };
}

export type BoissonsDayPayload = {
  day: BoissonsDay;
  drinks: Drink[];
};

async function leftoversForDate(
  date: string,
  drinks: Drink[],
): Promise<{ zogbo: Map<string, number>; gbegamey: Map<string, number> }> {
  const prev = previousIsoDate(date);
  if (prev) {
    const db = await getDb();
    const prevDoc = await db
      .collection<BoissonsDoc>("boissons_jours")
      .find({ _id: { $lte: prev } })
      .sort({ _id: -1 })
      .limit(1)
      .next();
    if (prevDoc?.lines?.length) {
      return leftoverFromBoissonsLines(
        prevDoc.lines.map((l) => normalizeBoissonsLine(l)),
        drinks,
      );
    }
  }
  try {
    // Import historique AquaPro : un seul relevé (avant la séparation par
    // site) — reflété à l'identique sur les deux sites, comme toute donnée
    // combinée héritée (voir `normalizeBoissonsLine`).
    const combined = await loadAquaBoissonOpeningCasiers(drinks);
    return { zogbo: combined, gbegamey: new Map(combined) };
  } catch {
    return { zogbo: new Map(), gbegamey: new Map() };
  }
}

export async function getBoissonsDayPayload(
  date: string,
): Promise<BoissonsDayPayload> {
  if (!isValidDate(date)) throw new Error("Date invalide (attendu YYYY-MM-DD)");

  const { drinks } = await getParametres();
  const db = await getDb();
  const existing = await db
    .collection<BoissonsDoc>("boissons_jours")
    .findOne({ _id: date });

  if (!existing) {
    const leftovers = await leftoversForDate(date, drinks);
    const day = createEmptyBoissonsDay(date, drinks, leftovers);
    if (leftovers.zogbo.size > 0 || leftovers.gbegamey.size > 0) {
      const updatedAt = new Date().toISOString();
      const lines = day.lines.map((l) => {
        // Le report arrive en casiers ; le comptage d'ouverture est en bouteilles.
        const upc = Math.max(
          1,
          Math.round(
            drinks.find((d) => d.id === l.productId)?.unitsPerCasier ||
              DEFAULT_UNITS_PER_CASIER,
          ),
        );
        // Une bouteille ne se compte pas en fractions : le report casiers →
        // bouteilles est arrondi à l'unité pour chaque site, sans quoi le
        // résidu de la conversion (casiers stockés à 2 décimales)
        // réapparaissait tel quel dans le comptage d'ouverture.
        const hasZogbo = leftovers.zogbo.has(l.productId);
        const hasGbegamey = leftovers.gbegamey.has(l.productId);
        return {
          ...l,
          countedZogbo: hasZogbo
            ? Math.max(0, Math.round(leftovers.zogbo.get(l.productId)! * upc))
            : null,
          countedGbegamey: hasGbegamey
            ? Math.max(
                0,
                Math.round(leftovers.gbegamey.get(l.productId)! * upc),
              )
            : null,
          observations:
            hasZogbo || hasGbegamey ? "Ouverture (dernier inventaire)" : "",
        };
      });
      await db.collection<BoissonsDoc>("boissons_jours").updateOne(
        { _id: date },
        {
          $set: {
            status: "ouverte",
            lines,
            movements: [],
            updatedAt,
            source: "aquapro-opening",
          },
          $setOnInsert: { _id: date },
        },
        { upsert: true },
      );
      return { day: { ...day, lines, updatedAt }, drinks };
    }
    return { day, drinks };
  }

  const day = toDay(existing);
  return {
    day: { ...day, lines: syncBoissonsLines(day.lines, drinks) },
    drinks,
  };
}

export async function saveBoissonsDay(
  input: {
    date: string;
    /**
     * Point de vente à l'origine de l'enregistrement : seuls ses propres
     * champs (comptage, achats déjà tracés côté vente) sont pris depuis
     * `lines` — l'autre site reste intégralement verrouillé sur ce qu'il
     * avait déjà, comme `lockSold` le fait déjà pour les ventes.
     */
    site: VenteSite;
    status?: BoissonsDay["status"];
    lines: BoissonsLine[];
  },
  options?: { lockSold?: boolean; directWrite?: boolean; stockSaisie?: boolean },
): Promise<BoissonsDayPayload> {
  if (!isValidDate(input.date)) {
    throw new Error("Date invalide (attendu YYYY-MM-DD)");
  }

  const lockSold = options?.lockSold !== false;
  const directWrite = options?.directWrite === true;
  const isZogbo = input.site === "zogbo";
  const { drinks } = await getParametres();

  const saved = await updateDayDocument<BoissonsDoc, BoissonsDayPayload>(
    "boissons_jours",
    input.date,
    async (existing) => {
      const leftovers = existing ? null : await leftoversForDate(input.date, drinks);

      const held = new Map(
        (existing?.lines ?? []).map((l) => [
          l.productId,
          normalizeBoissonsLine(l),
        ]),
      );

      const movements = directWrite
        ? []
        : (existing?.movements ?? [])
            .map((m) => normalizeBoissonsMovement(m))
            .filter((m): m is BoissonsMovement => !!m);

      const lines = syncBoissonsLines(input.lines, drinks).map((line) => {
        const normalized = normalizeBoissonsLine(line);
        if (directWrite) {
          return {
            ...normalized,
            pertesZogbo: 0,
            pertesGbegamey: 0,
          };
        }
        const prev = held.get(line.productId);
        const initialStockZogbo = existing
          ? (prev?.initialStockZogbo ?? 0)
          : (leftovers?.zogbo.get(line.productId) ?? 0);
        const initialStockGbegamey = existing
          ? (prev?.initialStockGbegamey ?? 0)
          : (leftovers?.gbegamey.get(line.productId) ?? 0);

        return {
          productId: line.productId,
          name: line.name,
          initialStockZogbo,
          purchasesZogbo: prev?.purchasesZogbo ?? 0,
          soldZogbo:
            isZogbo && !lockSold
              ? Math.max(0, Number(line.soldZogbo) || 0)
              : (prev?.soldZogbo ?? 0),
          pertesZogbo: prev?.pertesZogbo ?? 0,
          countedZogbo: isZogbo
            ? normalized.countedZogbo
            : (prev?.countedZogbo ?? null),
          initialStockGbegamey,
          purchasesGbegamey: prev?.purchasesGbegamey ?? 0,
          soldGbegamey:
            !isZogbo && !lockSold
              ? Math.max(0, Number(line.soldGbegamey) || 0)
              : (prev?.soldGbegamey ?? 0),
          pertesGbegamey: prev?.pertesGbegamey ?? 0,
          countedGbegamey: !isZogbo
            ? normalized.countedGbegamey
            : (prev?.countedGbegamey ?? null),
          observations: String(line.observations ?? prev?.observations ?? ""),
        };
      });

      const updatedAt = new Date().toISOString();
      const status = input.status ?? "ouverte";

      return {
        set: { status, lines, movements, updatedAt },
        result: {
          day: { date: input.date, status, lines, movements, updatedAt },
          drinks,
        },
      };
    },
  );
  // Suivi produit × site : on ne bascule plus toute la journée.
  void options?.stockSaisie;
  return saved;
}

export async function applyBoissonsPurchase(input: {
  date: string;
  site: VenteSite;
  productId: string;
  qty: number;
}): Promise<BoissonsDayPayload & { movement: BoissonsMovement }> {
  if (!isValidDate(input.date)) throw new Error("Date invalide");
  const payload = await getBoissonsDayPayload(input.date);
  const drink = payload.drinks.find((d) => d.id === input.productId);

  // Écriture sous verrou optimiste : une vente ou un comptage simultané ne
  // peut plus être écrasé par la réécriture du document complet.
  const saved = await updateDayDocument<BoissonsDoc, BoissonsDayPayload & { movement: BoissonsMovement }>(
    "boissons_jours",
    input.date,
    async (existing) => {
      assertDayOpen(
        existing?.status,
        "Journée clôturée : achat boissons impossible.",
      );

      const leftovers = existing ? null : await leftoversForDate(input.date, payload.drinks);
      const baseLines = existing
        ? (existing.lines ?? []).map((l) => normalizeBoissonsLine(l))
        : createEmptyBoissonsDay(
            input.date,
            payload.drinks,
            leftovers ?? { zogbo: new Map(), gbegamey: new Map() },
          ).lines;
      const baseMovements = (existing?.movements ?? [])
        .map((m) => normalizeBoissonsMovement(m))
        .filter((m): m is BoissonsMovement => !!m);

      const applied = applyBoissonsPurchaseToState(
        baseLines,
        baseMovements,
        {
          productId: input.productId,
          site: input.site,
          qty: input.qty,
          unitsPerCasier: drink?.unitsPerCasier,
        },
      );

      const updatedAt = new Date().toISOString();
      const status = existing?.status ?? "ouverte";
      return {
        set: { status, lines: applied.lines, movements: applied.movements, updatedAt },
        result: {
          day: {
            date: input.date,
            status,
            lines: syncBoissonsLines(applied.lines, payload.drinks),
            movements: applied.movements,
            updatedAt,
          },
          drinks: payload.drinks,
          movement: applied.movement,
        },
      };
    },
  );
  // Suivi produit × site uniquement — Zogbo et Gbégamey restent indépendants.
  return saved;
}

export async function cancelBoissonsMovement(input: {
  date: string;
  movementId: string;
  /** Périmètre du compte : un mouvement d'un autre point de vente est traité comme introuvable. */
  site?: VenteSite | null;
}): Promise<BoissonsDayPayload & { movement: BoissonsMovement }> {
  if (!isValidDate(input.date)) throw new Error("Date invalide");
  const payload = await getBoissonsDayPayload(input.date);
  const drinkFound = (payload.day.movements ?? []).find(
    (m) => m.id === input.movementId,
  );
  const drink = drinkFound
    ? payload.drinks.find((d) => d.id === drinkFound.productId)
    : undefined;

  return updateDayDocument<BoissonsDoc, BoissonsDayPayload & { movement: BoissonsMovement }>(
    "boissons_jours",
    input.date,
    async (existing) => {
      const baseMovements = (existing?.movements ?? [])
        .map((m) => normalizeBoissonsMovement(m))
        .filter((m): m is BoissonsMovement => !!m);
      const target = baseMovements.find((m) => m.id === input.movementId);
      if (!target || (input.site && target.site !== input.site)) {
        throw new Error("Mouvement introuvable.");
      }

      const cancelled = cancelBoissonsMovementInState(
        (existing?.lines ?? []).map((l) => normalizeBoissonsLine(l)),
        baseMovements,
        input.movementId,
        drink?.unitsPerCasier,
      );

      const updatedAt = new Date().toISOString();
      const status = existing?.status ?? "ouverte";
      return {
        set: { status, lines: cancelled.lines, movements: cancelled.movements, updatedAt },
        result: {
          day: {
            date: input.date,
            status,
            lines: syncBoissonsLines(cancelled.lines, payload.drinks),
            movements: cancelled.movements,
            updatedAt,
          },
          drinks: payload.drinks,
          movement: cancelled.movement,
        },
      };
    },
  );
}
