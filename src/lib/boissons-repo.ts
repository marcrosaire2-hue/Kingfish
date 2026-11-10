import { assertDayOpen, isValidDate, updateDayDocument } from "@/lib/day-doc";
import { noterStockInitial } from "@/lib/stock-si-repo";
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
  leftoverFromBoissonsLines,
  normalizeBoissonsLine,
  normalizeBoissonsMovement,
  syncBoissonsLines,
  unitsPerCasierOf,
} from "@/lib/boissons-calc";
import { loadAquaBoissonOpeningCasiers } from "@/lib/aquapro-opening-stock";
import { previousIsoDate } from "@/lib/zogbo-calc";
import { isDrinkStockTracked } from "@/lib/stock-tracked";
import { markGbegameyStockEntry } from "@/lib/gbegamey-repo";
import { boissonsScope, withStockCarry } from "@/lib/stock-carry";
import { collectionBoissons } from "@/lib/site-collections";
import { poserComptage } from "@/lib/stock-comptage";
import { mapAchatToStockEvents } from "@/lib/stock-ledger-map";
import { recordStockEvents } from "@/lib/stock-ledger-write";
import { boissonsComptageEvents } from "@/lib/stock-ledger-sync";
import {
  fusionnerLignesBoissons,
  fusionnerParJour,
} from "@/lib/site-collections-calc";
import type { Filter } from "mongodb";

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

/** Lecture consolidée (direction) : jamais utilisée pour écrire. */
export type BoissonsDayFullPayload = BoissonsDayPayload & {
  drinksBySite: Record<VenteSite, Drink[]>;
};

async function dernierJourAvant(
  site: VenteSite,
  date: string,
): Promise<BoissonsDoc | null> {
  const prev = previousIsoDate(date);
  if (!prev) return null;
  const db = await getDb();
  return db
    .collection<BoissonsDoc>(await collectionBoissons(site))
    .find({ _id: { $lte: prev } })
    .sort({ _id: -1 })
    .limit(1)
    .next();
}

async function leftoversForDate(
  site: VenteSite,
  date: string,
  drinks: Drink[],
): Promise<Map<string, number>> {
  const prevDoc = await dernierJourAvant(site, date);
  if (prevDoc?.lines?.length) {
    return leftoverFromBoissonsLines(
      prevDoc.lines.map((l) => normalizeBoissonsLine(l)),
      drinks,
    )[site];
  }
  try {
    return await loadAquaBoissonOpeningCasiers(drinks);
  } catch {
    return new Map();
  }
}

/**
 * Boissons dont le stock Gbégamey est suivi la veille : le suivi est reporté,
 * sans quoi une boisson épuisée redevenait vendable sans stock le lendemain.
 */
async function trackedGbegameyForDate(date: string): Promise<Set<string>> {
  const prevDoc = await dernierJourAvant("gbegamey", date);
  return new Set(
    (prevDoc?.lines ?? [])
      .map((l) => normalizeBoissonsLine(l))
      .filter((l) => isDrinkStockTracked(l, "gbegamey"))
      .map((l) => l.productId),
  );
}

export async function getBoissonsDayPayload(
  date: string,
): Promise<BoissonsDayFullPayload>;
export async function getBoissonsDayPayload(
  date: string,
  site: VenteSite,
): Promise<BoissonsDayPayload>;
export async function getBoissonsDayPayload(
  date: string,
  site?: VenteSite,
): Promise<BoissonsDayPayload> {
  if (site) return chargerJourDuSite(date, site);
  const [zogbo, gbegamey, tous] = await Promise.all([
    chargerJourDuSite(date, "zogbo"),
    chargerJourDuSite(date, "gbegamey"),
    getParametres(),
  ]);
  const consolide: BoissonsDayFullPayload = {
    day: {
      ...zogbo.day,
      lines: syncBoissonsLines(
        fusionnerLignesBoissons(zogbo.day.lines, gbegamey.day.lines),
        tous.drinks,
      ),
      movements: [...zogbo.day.movements, ...gbegamey.day.movements],
    },
    drinks: tous.drinks,
    drinksBySite: { zogbo: zogbo.drinks, gbegamey: gbegamey.drinks },
  };
  return consolide;
}

/** Journées consolidées d'une période, pour les totaux de la direction. */
export async function lireJoursBoissonsConsolides(
  filter: Filter<BoissonsDoc>,
): Promise<BoissonsDoc[]> {
  const db = await getDb();
  const [zogbo, gbegamey] = await Promise.all(
    (["zogbo", "gbegamey"] as const).map(async (site) =>
      db
        .collection<BoissonsDoc>(await collectionBoissons(site))
        .find(filter)
        .toArray(),
    ),
  );
  return fusionnerParJour(zogbo!, gbegamey!, (z, g) => ({
    ...(z ?? g)!,
    lines: fusionnerLignesBoissons(z?.lines ?? [], g?.lines ?? []),
    movements: [...(z?.movements ?? []), ...(g?.movements ?? [])],
  }));
}

async function chargerJourDuSite(
  date: string,
  site: VenteSite,
): Promise<BoissonsDayPayload> {
  if (!isValidDate(date)) throw new Error("Date invalide (attendu YYYY-MM-DD)");

  const { drinks } = await getParametres(site);
  const db = await getDb();
  const collection = await collectionBoissons(site);
  const existing = await db
    .collection<BoissonsDoc>(collection)
    .findOne({ _id: date });

  if (!existing) {
    const leftovers = await leftoversForDate(site, date, drinks);
    const trackedGbegamey =
      site === "gbegamey" ? await trackedGbegameyForDate(date) : new Set<string>();
    const day = createEmptyBoissonsDay(date, drinks, { [site]: leftovers });
    if (leftovers.size > 0) {
      const updatedAt = new Date().toISOString();
      const lines = day.lines.map((l) => ({
        ...l,
        // Le reste de la veille est déjà l'ouverture (stock initial du jour) ;
        // le comptage reste vide jusqu'au prochain inventaire.
        countedZogbo: null,
        countedGbegamey: null,
        observations: leftovers.has(l.productId)
          ? "Ouverture (dernier inventaire)"
          : "",
        ...(trackedGbegamey.has(l.productId)
          ? { stockTrackedGbegamey: true }
          : {}),
      }));
      await db.collection<BoissonsDoc>(collection).updateOne(
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
  input: Parameters<typeof saveBoissonsDayRaw>[0],
  options?: Parameters<typeof saveBoissonsDayRaw>[1],
): Promise<BoissonsDayPayload> {
  const saved = await withStockCarry(boissonsScope(input.site), input.date, () =>
    saveBoissonsDayRaw(input, options),
  );
  await recordStockEvents(
    boissonsComptageEvents({
      site: input.site,
      date: input.date,
      lines: saved.day.lines,
    }),
    "Journal stock · comptage boissons",
  );
  return saved;
}

async function saveBoissonsDayRaw(
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
  const { drinks } = await getParametres(input.site);
  const collection = await collectionBoissons(input.site);

  const saved = await updateDayDocument<BoissonsDoc, BoissonsDayPayload>(
    collection,
    input.date,
    async (existing) => {
      const leftovers = existing
        ? null
        : await leftoversForDate(input.site, input.date, drinks);

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
          : isZogbo
            ? (leftovers?.get(line.productId) ?? 0)
            : 0;
        const initialStockGbegamey = existing
          ? (prev?.initialStockGbegamey ?? 0)
          : isZogbo
            ? 0
            : (leftovers?.get(line.productId) ?? 0);

        const ligne: BoissonsLine = {
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
          // Sans ces champs, un simple enregistrement retirait le suivi du
          // produit : à Gbégamey, ses ventes ne décomptaient plus le stock.
          ...(prev?.stockTrackedZogbo !== undefined
            ? { stockTrackedZogbo: prev.stockTrackedZogbo }
            : {}),
          ...(prev?.stockTrackedGbegamey !== undefined
            ? { stockTrackedGbegamey: prev.stockTrackedGbegamey }
            : {}),
        };
        const upc = unitsPerCasierOf(drinks.find((d) => d.id === line.productId));
        const vendu = isZogbo ? ligne.soldZogbo : ligne.soldGbegamey;
        const pertes = isZogbo ? ligne.pertesZogbo : ligne.pertesGbegamey;
        const comptage = poserComptage({
          ancienCompte: isZogbo ? prev?.countedZogbo : prev?.countedGbegamey,
          ancienRef: isZogbo ? prev?.comptageZogbo : prev?.comptageGbegamey,
          nouveauCompte: isZogbo ? ligne.countedZogbo : ligne.countedGbegamey,
          etat: {
            theorique:
              (isZogbo
                ? ligne.initialStockZogbo + ligne.purchasesZogbo
                : ligne.initialStockGbegamey + ligne.purchasesGbegamey) -
              (vendu + pertes) / upc,
            vendu,
            pertes,
          },
        });
        return comptage
          ? { ...ligne, [isZogbo ? "comptageZogbo" : "comptageGbegamey"]: comptage }
          : ligne;
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

export async function applyBoissonsPurchase(
  input: Parameters<typeof applyBoissonsPurchaseRaw>[0],
): ReturnType<typeof applyBoissonsPurchaseRaw> {
  return withStockCarry(boissonsScope(input.site), input.date, () =>
    applyBoissonsPurchaseRaw(input),
  );
}

async function applyBoissonsPurchaseRaw(input: {
  date: string;
  site: VenteSite;
  productId: string;
  qty: number;
}): Promise<BoissonsDayPayload & { movement: BoissonsMovement }> {
  if (!isValidDate(input.date)) throw new Error("Date invalide");
  const payload = await getBoissonsDayPayload(input.date, input.site);
  const siteDrinks = payload.drinks;
  const drink = siteDrinks.find((d) => d.id === input.productId);
  const collection = await collectionBoissons(input.site);
  if (!drink) throw new Error("Boisson absente du catalogue de ce site.");

  // Écriture sous verrou optimiste : une vente ou un comptage simultané ne
  // peut plus être écrasé par la réécriture du document complet.
  const saved = await updateDayDocument<BoissonsDoc, BoissonsDayPayload & { movement: BoissonsMovement }>(
    collection,
    input.date,
    async (existing) => {
      assertDayOpen(
        existing?.status,
        "Journée clôturée : achat boissons impossible.",
      );

      const leftovers = existing
        ? null
        : await leftoversForDate(input.site, input.date, siteDrinks);
      const baseLines = existing
        ? (existing.lines ?? []).map((l) => normalizeBoissonsLine(l))
        : createEmptyBoissonsDay(
            input.date,
            payload.drinks,
            { [input.site]: leftovers ?? new Map() },
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
            lines: syncBoissonsLines(applied.lines, siteDrinks),
            movements: applied.movements,
            updatedAt,
          },
          drinks: siteDrinks,
          movement: applied.movement,
        },
      };
    },
  );
  await recordStockEvents(
    mapAchatToStockEvents({
      id: saved.movement.id,
      date: input.date,
      site: input.site,
      family: "boisson",
      productId: input.productId,
      name: saved.movement.name,
      qty: Math.round(saved.movement.qty * unitsPerCasierOf(drink)),
      at: saved.movement.at,
      cancelledAt: null,
      source: "achat-boisson",
    }),
    "Journal stock · achat boisson",
  );
  // Suivi produit × site uniquement — Zogbo et Gbégamey restent indépendants.
  // Premier achat de la boisson sur ce site : il devient son SI (bouteilles).
  await noterStockInitial({
    site: input.site,
    kind: "boisson",
    productId: input.productId,
    qty: Math.round(input.qty * unitsPerCasierOf(drink)),
    date: input.date,
  });
  // Gbégamey : un achat est une entrée de stock → vente selon le stock.
  if (input.site === "gbegamey") {
    await markGbegameyStockEntry(input.date);
  }
  return saved;
}

export async function cancelBoissonsMovement(
  input: Omit<Parameters<typeof cancelBoissonsMovementRaw>[0], "site"> & {
    /** Absent pour un compte multi-sites. */
    site?: VenteSite | null;
  },
): ReturnType<typeof cancelBoissonsMovementRaw> {
  const site = input.site ?? (await siteDuMouvement(input.date, input.movementId));
  return withStockCarry(boissonsScope(site), input.date, () =>
    cancelBoissonsMovementRaw({ ...input, site }),
  );
}

/** Compte multi-sites : le mouvement désigne lui-même son site. */
async function siteDuMouvement(
  date: string,
  movementId: string,
): Promise<VenteSite> {
  const db = await getDb();
  for (const site of ["zogbo", "gbegamey"] as const) {
    const doc = await db
      .collection<BoissonsDoc>(await collectionBoissons(site))
      .findOne({ _id: date, "movements.id": movementId }, { projection: { _id: 1 } });
    if (doc) return site;
  }
  throw new Error("Mouvement introuvable.");
}

async function cancelBoissonsMovementRaw(input: {
  date: string;
  movementId: string;
  site: VenteSite;
}): Promise<BoissonsDayPayload & { movement: BoissonsMovement }> {
  if (!isValidDate(input.date)) throw new Error("Date invalide");
  const payload = await getBoissonsDayPayload(input.date, input.site);
  const collection = await collectionBoissons(input.site);
  const drinkFound = (payload.day.movements ?? []).find(
    (m) => m.id === input.movementId,
  );
  const drink = drinkFound
    ? payload.drinks.find((d) => d.id === drinkFound.productId)
    : undefined;
  const vueDrinks = payload.drinks;

  const result = await updateDayDocument<
    BoissonsDoc,
    BoissonsDayPayload & { movement: BoissonsMovement }
  >(
    collection,
    input.date,
    async (existing) => {
      const baseMovements = (existing?.movements ?? [])
        .map((m) => normalizeBoissonsMovement(m))
        .filter((m): m is BoissonsMovement => !!m);
      const target = baseMovements.find((m) => m.id === input.movementId);
      if (!target) {
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
            lines: syncBoissonsLines(cancelled.lines, vueDrinks),
            movements: cancelled.movements,
            updatedAt,
          },
          drinks: vueDrinks,
          movement: cancelled.movement,
        },
      };
    },
  );

  await recordStockEvents(
    mapAchatToStockEvents({
      id: result.movement.id,
      date: input.date,
      site: input.site,
      family: "boisson",
      productId: result.movement.productId,
      name: result.movement.name,
      qty: Math.round(result.movement.qty * unitsPerCasierOf(drink)),
      at: result.movement.at,
      cancelledAt: result.movement.cancelledAt ?? new Date().toISOString(),
      source: "achat-boisson",
    }),
    "Journal stock · annulation achat boisson",
  );

  return result;
}
