import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { Immobilisation, ImmobilisationKind, VenteSite } from "@/lib/types";

type ImmobilisationDoc = Omit<Immobilisation, "id"> & { _id: ObjectId };

function isValidDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

function toEntry(doc: ImmobilisationDoc): Immobilisation {
  return {
    id: doc._id.toHexString(),
    name: doc.name,
    kind: doc.kind,
    cost: Math.max(0, Math.round(Number(doc.cost) || 0)),
    salePrice:
      doc.salePrice === null || doc.salePrice === undefined
        ? null
        : Math.max(0, Math.round(Number(doc.salePrice) || 0)),
    date: doc.date,
    site: doc.site ?? null,
    notes: String(doc.notes ?? ""),
    active: doc.active !== false,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function normalizeName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

export async function listImmobilisations(input?: {
  kind?: ImmobilisationKind | "all";
  active?: boolean | "all";
  /** Filtre site : inclut aussi les fiches « tous sites » (site null). */
  site?: VenteSite | "all";
}): Promise<Immobilisation[]> {
  const filter: Record<string, unknown> = {};
  if (input?.kind && input.kind !== "all") filter.kind = input.kind;
  if (input?.active === true) filter.active = true;
  if (input?.active === false) filter.active = false;
  if (input?.site && input.site !== "all") {
    filter.$or = [{ site: input.site }, { site: null }];
  }

  const db = await getDb();
  const docs = await db
    .collection<ImmobilisationDoc>("immobilisations")
    .find(filter)
    .sort({ active: -1, name: 1 })
    .toArray();
  return docs.map(toEntry);
}

export async function createImmobilisation(input: {
  name: string;
  kind: ImmobilisationKind;
  cost?: number;
  salePrice?: number | null;
  date: string;
  site?: VenteSite | null;
  notes?: string;
}): Promise<Immobilisation> {
  const name = normalizeName(input.name);
  if (name.length < 2) throw new Error("Nom trop court (2 caractères min.).");
  if (name.length > 120) throw new Error("Nom trop long (120 caractères max.).");
  if (input.kind !== "actif" && input.kind !== "emballage") {
    throw new Error("Type invalide (actif ou emballage).");
  }
  if (!isValidDate(input.date)) throw new Error("Date invalide.");

  const cost = Math.max(0, Math.round(Number(input.cost) || 0));
  let salePrice: number | null =
    input.salePrice === null || input.salePrice === undefined
      ? null
      : Math.max(0, Math.round(Number(input.salePrice) || 0));

  if (input.kind === "emballage") {
    const price = Math.round(Number(input.salePrice) || 0);
    if (price <= 0) {
      throw new Error("Prix de vente requis pour un emballage.");
    }
    salePrice = price;
  } else {
    salePrice = salePrice && salePrice > 0 ? salePrice : null;
  }

  const site =
    input.site === "zogbo" || input.site === "gbegamey" ? input.site : null;
  const now = new Date().toISOString();
  const doc: ImmobilisationDoc = {
    _id: new ObjectId(),
    name,
    kind: input.kind,
    cost,
    salePrice,
    date: input.date,
    site,
    notes: String(input.notes ?? "").trim().slice(0, 500),
    active: true,
    createdAt: now,
    updatedAt: now,
  };

  const db = await getDb();
  await db.collection<ImmobilisationDoc>("immobilisations").insertOne(doc);
  return toEntry(doc);
}

export async function updateImmobilisation(input: {
  id: string;
  name?: string;
  cost?: number;
  salePrice?: number | null;
  date?: string;
  site?: VenteSite | null;
  notes?: string;
}): Promise<Immobilisation> {
  if (!ObjectId.isValid(input.id)) throw new Error("Fiche introuvable.");
  const db = await getDb();
  const existing = await db
    .collection<ImmobilisationDoc>("immobilisations")
    .findOne({ _id: new ObjectId(input.id) });
  if (!existing) throw new Error("Fiche introuvable.");

  const patch: Partial<ImmobilisationDoc> = {
    updatedAt: new Date().toISOString(),
  };

  if (input.name !== undefined) {
    const name = normalizeName(input.name);
    if (name.length < 2) throw new Error("Nom trop court (2 caractères min.).");
    if (name.length > 120) throw new Error("Nom trop long (120 caractères max.).");
    patch.name = name;
  }
  if (input.cost !== undefined) {
    patch.cost = Math.max(0, Math.round(Number(input.cost) || 0));
  }
  if (input.date !== undefined) {
    if (!isValidDate(input.date)) throw new Error("Date invalide.");
    patch.date = input.date;
  }
  if (input.site !== undefined) {
    patch.site =
      input.site === "zogbo" || input.site === "gbegamey" ? input.site : null;
  }
  if (input.notes !== undefined) {
    patch.notes = String(input.notes).trim().slice(0, 500);
  }
  if (input.salePrice !== undefined) {
    if (existing.kind === "emballage") {
      const price = Math.round(Number(input.salePrice) || 0);
      if (price <= 0) {
        throw new Error("Prix de vente requis pour un emballage.");
      }
      patch.salePrice = price;
    } else {
      const price =
        input.salePrice === null
          ? null
          : Math.max(0, Math.round(Number(input.salePrice) || 0));
      patch.salePrice = price && price > 0 ? price : null;
    }
  }

  await db.collection<ImmobilisationDoc>("immobilisations").updateOne(
    { _id: existing._id },
    { $set: patch },
  );
  const updated = await db
    .collection<ImmobilisationDoc>("immobilisations")
    .findOne({ _id: existing._id });
  if (!updated) throw new Error("Fiche introuvable.");
  return toEntry(updated);
}

export async function setImmobilisationActive(input: {
  id: string;
  active: boolean;
}): Promise<Immobilisation> {
  if (!ObjectId.isValid(input.id)) throw new Error("Fiche introuvable.");
  const db = await getDb();
  const result = await db
    .collection<ImmobilisationDoc>("immobilisations")
    .findOneAndUpdate(
      { _id: new ObjectId(input.id) },
      {
        $set: {
          active: Boolean(input.active),
          updatedAt: new Date().toISOString(),
        },
      },
      { returnDocument: "after" },
    );
  if (!result) throw new Error("Fiche introuvable.");
  return toEntry(result);
}
