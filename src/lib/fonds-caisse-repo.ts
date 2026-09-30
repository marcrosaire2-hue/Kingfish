import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { newId } from "@/lib/format";
import type { CaisseKey, FondsCaisse, VenteSite } from "@/lib/types";

export type FondsCaisseDoc = Omit<FondsCaisse, "id"> & { _id: ObjectId };

function toFondsCaisse(doc: FondsCaisseDoc): FondsCaisse {
  return {
    id: doc._id.toHexString(),
    date: doc.date,
    caisse: doc.caisse,
    site: doc.site ?? null,
    soldePrevision: Number(doc.soldePrevision) || 0,
    soldeReel: Number(doc.soldeReel) || 0,
    ecart: Number(doc.ecart) || 0,
    justificationEcart: doc.justificationEcart ?? null,
    actorId: doc.actorId,
    actorName: doc.actorName,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt ?? null,
    updatedById: doc.updatedById ?? null,
    updatedByName: doc.updatedByName ?? null,
  };
}

export async function createFondsCaisse(data: Omit<FondsCaisse, "id">) {
  const db = await getDb();
  const doc: FondsCaisseDoc = {
    _id: new ObjectId(),
    ...data,
  };
  await db.collection("fonds_caisse").insertOne(doc);
  return toFondsCaisse(doc);
}

export async function updateFondsCaisse(
  id: string,
  updates: Partial<Omit<FondsCaisse, "id" | "createdAt">>,
) {
  const db = await getDb();
  const result = await db.collection("fonds_caisse").updateOne(
    { _id: new ObjectId(id) },
    {
      $set: {
        ...updates,
        updatedAt: new Date().toISOString(),
      },
    },
  );
  if (result.matchedCount === 0) throw new Error("Fonds de caisse not found");
  return getFondsCaisseById(id);
}

export async function deleteFondsCaisse(id: string) {
  const db = await getDb();
  const result = await db
    .collection("fonds_caisse")
    .deleteOne({ _id: new ObjectId(id) });
  if (result.deletedCount === 0) throw new Error("Fonds de caisse not found");
}

export async function getFondsCaisseById(id: string) {
  const db = await getDb();
  const doc = await db
    .collection("fonds_caisse")
    .findOne({ _id: new ObjectId(id) });
  if (!doc) throw new Error("Fonds de caisse not found");
  return toFondsCaisse(doc as FondsCaisseDoc);
}

export async function listFondsCaisseByDate(date: string) {
  const db = await getDb();
  const docs = await db
    .collection("fonds_caisse")
    .find({ date })
    .sort({ createdAt: -1 })
    .toArray();
  return docs.map((doc) => toFondsCaisse(doc as FondsCaisseDoc));
}

export async function listFondsCaisseByCaisse(
  caisse: CaisseKey,
  dateFrom?: string,
  dateTo?: string,
) {
  const db = await getDb();
  const filter: any = { caisse };

  if (dateFrom || dateTo) {
    filter.date = {};
    if (dateFrom) filter.date.$gte = dateFrom;
    if (dateTo) filter.date.$lte = dateTo;
  }

  const docs = await db
    .collection("fonds_caisse")
    .find(filter)
    .sort({ date: -1, createdAt: -1 })
    .toArray();
  return docs.map((doc) => toFondsCaisse(doc as FondsCaisseDoc));
}

export async function getFondsCaisseForToday(caisse: CaisseKey, date: string) {
  const db = await getDb();
  const doc = await db
    .collection("fonds_caisse")
    .findOne({ caisse, date });
  return doc ? toFondsCaisse(doc as FondsCaisseDoc) : null;
}

export async function listFondsCaisseForSite(
  site: VenteSite,
  dateFrom?: string,
  dateTo?: string,
) {
  const db = await getDb();
  const filter: any = { site };

  if (dateFrom || dateTo) {
    filter.date = {};
    if (dateFrom) filter.date.$gte = dateFrom;
    if (dateTo) filter.date.$lte = dateTo;
  }

  const docs = await db
    .collection("fonds_caisse")
    .find(filter)
    .sort({ date: -1, createdAt: -1 })
    .toArray();
  return docs.map((doc) => toFondsCaisse(doc as FondsCaisseDoc));
}
