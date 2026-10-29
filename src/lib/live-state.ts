import { getDb } from "@/lib/mongodb";
import { cached, invalidateCache } from "@/lib/ttl-cache";

/**
 * Compteur partagé « quelque chose a changé » : chaque écriture (vente,
 * annulation, validation, caisse, versement…) l'incrémente ; les pages
 * ouvertes l'interrogent et se rafraîchissent d'elles-mêmes dès qu'il bouge.
 * Une seule petite lecture par interrogation.
 */
const DOC_ID = "live_seq";

type LiveDoc = { _id: string; seq?: number; at?: string };

export async function bumpLive(): Promise<void> {
  const db = await getDb();
  await db.collection<LiveDoc>("app_settings").updateOne(
    { _id: DOC_ID },
    { $inc: { seq: 1 }, $set: { at: new Date().toISOString() } },
    { upsert: true },
  );
  invalidateCache(`${db.databaseName}:live`);
}

export async function readLiveSeq(): Promise<number> {
  const db = await getDb();
  // 1 s : protège la base si beaucoup d'onglets interrogent en même temps.
  return cached(`${db.databaseName}:live`, 1_000, async () => {
    const doc = await db
      .collection<LiveDoc>("app_settings")
      .findOne({ _id: DOC_ID }, { projection: { seq: 1 } });
    return doc?.seq ?? 0;
  });
}
