import type { Db } from "mongodb";
import { todayIsoDate } from "@/lib/zogbo-calc";
import { getDb } from "@/lib/mongodb";
import {
  estJourFuturVide,
  projeterJourBoissons,
  projeterJourMatieres,
  type JourStocke,
} from "@/lib/site-collections-calc";
import type { VenteSite } from "@/lib/types";

/**
 * Chaque site a ses propres journées de boissons et de matières : une écriture
 * de Zogbo ne peut plus toucher Gbégamey, et inversement. Les anciennes
 * collections communes ne sont jamais modifiées et servent d'archive.
 */
export const COLLECTION_BOISSONS: Record<VenteSite, string> = {
  zogbo: "boissons_jours_zogbo",
  gbegamey: "boissons_jours_gbegamey",
};

export const COLLECTION_MATIERES: Record<VenteSite, string> = {
  zogbo: "matieres_jours_zogbo",
  gbegamey: "matieres_jours_gbegamey",
};

const SITES: VenteSite[] = ["zogbo", "gbegamey"];
const separations = new Map<string, Promise<void>>();

async function recopier(
  db: Db,
  source: string,
  cible: (site: VenteSite) => string,
  projeter: (doc: JourStocke, site: VenteSite) => JourStocke | null,
): Promise<void> {
  const docs = await db.collection<JourStocke>(source).find({}).toArray();
  if (docs.length === 0) return;
  const aujourdhui = todayIsoDate();
  await Promise.all(
    SITES.map(async (site) => {
      const ops = docs
        .filter((doc) => !estJourFuturVide(doc, aujourdhui))
        .map((doc) => projeter(doc, site))
        .filter((doc): doc is JourStocke => doc !== null)
        .map(({ _id, ...reste }) => ({
          updateOne: {
            filter: { _id },
            // Jamais d'écrasement : une journée déjà propre au site reste telle quelle.
            update: { $setOnInsert: reste },
            upsert: true,
          },
        }));
      if (ops.length === 0) return;
      await db
        .collection<JourStocke>(cible(site))
        .bulkWrite(ops, { ordered: false })
        .catch((error: { code?: number }) => {
          // Deux serveurs démarrent en même temps : la journée existe déjà.
          if (error?.code !== 11000) throw error;
        });
    }),
  );
}

/** Première utilisation : chaque site reçoit sa part des journées existantes. */
export async function assurerSeparationSites(): Promise<void> {
  const db = await getDb();
  const cle = db.databaseName;
  let enCours = separations.get(cle);
  if (!enCours) {
    enCours = (async () => {
      await recopier(
        db,
        "boissons_jours",
        (s) => COLLECTION_BOISSONS[s],
        projeterJourBoissons,
      );
      await recopier(
        db,
        "matieres_jours",
        (s) => COLLECTION_MATIERES[s],
        projeterJourMatieres,
      );
    })();
    separations.set(cle, enCours);
    enCours.catch(() => separations.delete(cle));
  }
  await enCours;
}

export async function collectionBoissons(site: VenteSite): Promise<string> {
  await assurerSeparationSites();
  return COLLECTION_BOISSONS[site];
}

export async function collectionMatieres(site: VenteSite): Promise<string> {
  await assurerSeparationSites();
  return COLLECTION_MATIERES[site];
}
