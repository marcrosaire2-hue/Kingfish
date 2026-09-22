import { Binary, ObjectId } from "mongodb";
import type { UserRole } from "@/lib/auth-types";
import {
  cloudinaryConfigured,
  uploadCompteurPreuve,
} from "@/lib/cloudinary";
import { assertValidDate } from "@/lib/day-doc";
import {
  assertCompteurPreuveFile,
  canDeclareCompteur,
  canUpdateCompteur,
  inferCompteurPreuveMime,
  isCompteurPeriode,
  parseCompteurPeriode,
  parseCompteurQuantite,
} from "@/lib/compteur-model";
import { getDb } from "@/lib/mongodb";
import type { CompteurPeriode, CompteurReleve, VenteSite } from "@/lib/types";
import { todayIsoDate } from "@/lib/zogbo-calc";

export {
  canDeclareCompteur,
  canUpdateCompteur,
  defaultPeriodeFromShift,
  parseCompteurPeriode,
  parseCompteurQuantite,
} from "@/lib/compteur-model";

const COLLECTION = "compteur_releves";
const LOCAL_PREUVE_PUBLIC_ID = "local";
const MAX_LOCAL_BYTES = 4 * 1024 * 1024;

type StoredPreuve = {
  mime: string;
  url: string;
  publicId: string;
  data?: Binary;
};

type CompteurDoc = Omit<CompteurReleve, "id"> & {
  _id: ObjectId;
  preuveData?: Binary;
};

export type CompteurActor = {
  id: string;
  name: string;
  username: string;
  role: UserRole;
};

export type PreuveUpload = {
  mime: string;
  bytes: Buffer;
  filename?: string;
};

function localPreuveUrl(id: string): string {
  return `/api/compteur/${id}/preuve`;
}

function binaryFromBuffer(bytes: Buffer): Binary {
  return new Binary(bytes);
}

function bufferFromBinary(data: Binary): Buffer {
  const raw = data.buffer;
  return Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
}

function toPublic(doc: CompteurDoc): CompteurReleve {
  const id = doc._id.toHexString();
  const isLocal =
    doc.preuvePublicId === LOCAL_PREUVE_PUBLIC_ID ||
    !doc.preuveUrl ||
    doc.preuveUrl.startsWith("/api/");
  return {
    id,
    date: doc.date,
    site: doc.site,
    periode: isCompteurPeriode(doc.periode) ? doc.periode : "matin",
    quantite: doc.quantite,
    preuveMime: doc.preuveMime || "image/jpeg",
    preuveUrl: isLocal
      ? localPreuveUrl(id)
      : doc.preuveUrl.startsWith("http")
        ? doc.preuveUrl
        : localPreuveUrl(id),
    preuvePublicId: doc.preuvePublicId || LOCAL_PREUVE_PUBLIC_ID,
    createdAt: doc.createdAt,
    actorId: doc.actorId,
    actorName: doc.actorName,
    actorUsername: doc.actorUsername,
    updatedAt: doc.updatedAt ?? null,
    updatedById: doc.updatedById ?? null,
    updatedByName: doc.updatedByName ?? null,
  };
}

async function storePreuve(input: {
  file: PreuveUpload;
  releveId: string;
  date: string;
  site: VenteSite;
  periode: CompteurPeriode;
}): Promise<StoredPreuve> {
  const mime = inferCompteurPreuveMime({
    mime: input.file.mime,
    filename: input.file.filename,
    bytes: input.file.bytes,
  });
  assertCompteurPreuveFile({
    mime,
    size: input.file.bytes.length,
    filename: input.file.filename,
    bytes: input.file.bytes,
  });

  if (cloudinaryConfigured()) {
    try {
      const uploaded = await uploadCompteurPreuve({
        bytes: input.file.bytes,
        mime,
        releveId: input.releveId,
        date: input.date,
        site: input.site,
        periode: input.periode,
      });
      return {
        mime,
        url: uploaded.url,
        publicId: uploaded.publicId,
      };
    } catch {
      /* secours Mongo */
    }
  }

  if (input.file.bytes.length > MAX_LOCAL_BYTES) {
    throw new Error("Capture trop lourde (max. 4 Mo sans Cloudinary).");
  }

  return {
    mime,
    url: localPreuveUrl(input.releveId),
    publicId: LOCAL_PREUVE_PUBLIC_ID,
    data: binaryFromBuffer(input.file.bytes),
  };
}

export async function listCompteurReleves(input: {
  date?: string;
  from?: string;
  to?: string;
  site?: VenteSite | "all";
}): Promise<CompteurReleve[]> {
  const db = await getDb();
  const filter: Record<string, unknown> = {};

  if (input.from || input.to) {
    const from = input.from || input.to!;
    const to = input.to || input.from!;
    assertValidDate(from);
    assertValidDate(to);
    filter.date = { $gte: from, $lte: to };
  } else if (input.date) {
    assertValidDate(input.date);
    filter.date = input.date;
  }

  if (input.site && input.site !== "all") {
    filter.site = input.site;
  }

  const docs = await db
    .collection<CompteurDoc>(COLLECTION)
    .find(filter)
    .sort({ date: -1, periode: 1, createdAt: -1 })
    .limit(500)
    .toArray();

  return docs.map(toPublic);
}

export async function getCompteurReleve(id: string): Promise<CompteurReleve | null> {
  if (!ObjectId.isValid(id)) return null;
  const db = await getDb();
  const doc = await db
    .collection<CompteurDoc>(COLLECTION)
    .findOne({ _id: new ObjectId(id) });
  return doc ? toPublic(doc) : null;
}

/**
 * Crée ou remplace le relevé unique (date × site × période).
 * Une capture est obligatoire à la création ; optionnelle à la mise à jour
 * (conserve l’existante si absente).
 */
export async function upsertCompteurReleve(input: {
  date?: string;
  site: VenteSite;
  periode: unknown;
  quantite: unknown;
  preuve?: PreuveUpload | null;
  actor: CompteurActor;
}): Promise<CompteurReleve> {
  if (!canDeclareCompteur(input.actor.role) && !canUpdateCompteur(input.actor.role)) {
    throw new Error(
      "Seuls les gérants peuvent enregistrer un relevé de compteur.",
    );
  }

  const date = input.date || todayIsoDate();
  assertValidDate(date);
  const periode = parseCompteurPeriode(input.periode);
  const quantite = parseCompteurQuantite(input.quantite);

  const db = await getDb();
  const col = db.collection<CompteurDoc>(COLLECTION);
  const existing = await col.findOne({ date, site: input.site, periode });

  if (existing) {
    if (!canUpdateCompteur(input.actor.role)) {
      throw new Error("Mise à jour non autorisée.");
    }
    const idHex = existing._id.toHexString();
    let preuve: StoredPreuve | null = null;
    if (input.preuve && input.preuve.bytes.length > 0) {
      preuve = await storePreuve({
        file: input.preuve,
        releveId: idHex,
        date,
        site: input.site,
        periode,
      });
    }

    const updatedAt = new Date().toISOString();
    const $set: Partial<CompteurDoc> = {
      quantite,
      updatedAt,
      updatedById: input.actor.id,
      updatedByName: input.actor.name,
    };
    if (preuve) {
      $set.preuveMime = preuve.mime;
      $set.preuveUrl = preuve.url;
      $set.preuvePublicId = preuve.publicId;
      if (preuve.data) {
        $set.preuveData = preuve.data;
      }
    }

    const $unset: Record<string, ""> = {};
    if (preuve && !preuve.data) {
      $unset.preuveData = "";
    }

    await col.updateOne(
      { _id: existing._id },
      {
        $set,
        ...(Object.keys($unset).length ? { $unset } : {}),
      },
    );

    const refreshed = await col.findOne({ _id: existing._id });
    if (!refreshed) throw new Error("Relevé introuvable après mise à jour.");
    return toPublic(refreshed);
  }

  if (!canDeclareCompteur(input.actor.role)) {
    throw new Error("Seuls les gérants peuvent créer un relevé de compteur.");
  }
  if (!input.preuve || input.preuve.bytes.length <= 0) {
    throw new Error("Joignez la capture d’écran du compteur électrique.");
  }

  const _id = new ObjectId();
  const idHex = _id.toHexString();
  const createdAt = new Date().toISOString();
  const stored = await storePreuve({
    file: input.preuve,
    releveId: idHex,
    date,
    site: input.site,
    periode,
  });

  const doc: CompteurDoc = {
    _id,
    date,
    site: input.site,
    periode,
    quantite,
    preuveMime: stored.mime,
    preuveUrl: stored.url,
    preuvePublicId: stored.publicId,
    ...(stored.data ? { preuveData: stored.data } : {}),
    createdAt,
    actorId: input.actor.id,
    actorName: input.actor.name,
    actorUsername: input.actor.username,
  };

  await col.insertOne(doc);
  return toPublic(doc);
}

export async function getCompteurPreuveUrl(id: string): Promise<string | null> {
  if (!ObjectId.isValid(id)) return null;
  const db = await getDb();
  const doc = await db
    .collection<CompteurDoc>(COLLECTION)
    .findOne(
      { _id: new ObjectId(id) },
      { projection: { preuveUrl: 1, preuvePublicId: 1 } },
    );
  if (!doc) return null;
  if (doc.preuvePublicId === LOCAL_PREUVE_PUBLIC_ID) return null;
  if (doc.preuveUrl?.startsWith("http")) return doc.preuveUrl;
  return null;
}

export async function getCompteurPreuveBytes(
  id: string,
): Promise<{ mime: string; bytes: Buffer } | null> {
  if (!ObjectId.isValid(id)) return null;
  const db = await getDb();
  const doc = await db
    .collection<CompteurDoc>(COLLECTION)
    .findOne(
      { _id: new ObjectId(id) },
      { projection: { preuveMime: 1, preuveData: 1 } },
    );
  if (!doc?.preuveData) return null;
  return {
    mime: doc.preuveMime || "image/jpeg",
    bytes: bufferFromBinary(doc.preuveData),
  };
}
