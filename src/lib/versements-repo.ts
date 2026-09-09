import { Binary, ObjectId } from "mongodb";
import type { UserRole, UserShift } from "@/lib/auth-types";
import { effectiveShift } from "@/lib/auth-types";
import {
  cloudinaryConfigured,
  uploadVersementPreuve,
} from "@/lib/cloudinary";
import { assertValidDate } from "@/lib/day-doc";
import { getDb } from "@/lib/mongodb";
import type {
  Versement,
  VersementPreuve,
  VersementStatut,
  VersementTranche,
  VenteSite,
} from "@/lib/types";
import {
  assertPreuveFile,
  assertPreuvesList,
  canCancelVersement,
  canConfirmVersement,
  canDeclareVersement,
  canUpdateVersement,
  defaultTrancheFromShift,
  inferPreuveMime,
  isVersementTranche,
  MAX_PREUVES_LOCAL_TOTAL_BYTES,
  parseVersementHeure,
  parseVersementMembres,
  parseVersementMontant,
  parseVersementNumero,
  parseVersementTranche,
} from "@/lib/versements-model";
import { todayIsoDate } from "@/lib/zogbo-calc";

export {
  assertPreuveFile,
  canCancelPendingVersement,
  canCancelVersement,
  canConfirmVersement,
  canCorrectVersement,
  canDeclareVersement,
  canEditPendingVersement,
  canUpdateVersement,
  defaultTrancheFromShift,
  parseVersementHeure,
  parseVersementMembres,
  parseVersementMontant,
  parseVersementNumero,
  parseVersementTranche,
} from "@/lib/versements-model";

const COLLECTION = "versements";
const LOCAL_PREUVE_PUBLIC_ID = "local";

type StoredPreuve = {
  mime: string;
  url: string;
  publicId: string;
  /** Binaire local si Cloudinary indisponible. */
  data?: Binary;
};

type VersementDoc = Omit<Versement, "id" | "preuves"> & {
  _id: ObjectId;
  trancheHoraire?: VersementTranche;
  membresPresents?: string[];
  preuves?: StoredPreuve[];
  /** Ancienne preuve unique (rétrocompat). */
  preuveData?: Binary;
};

export type VersementActor = {
  id: string;
  name: string;
  username: string;
  role: UserRole;
  shift?: UserShift | null;
};

export type PreuveUpload = {
  mime: string;
  bytes: Buffer;
  filename?: string;
};

function trancheFromLegacyShift(shift: UserShift | undefined): VersementTranche {
  return defaultTrancheFromShift(shift);
}

function localPreuveUrl(id: string, index: number): string {
  return index <= 0
    ? `/api/versements/${id}/preuve`
    : `/api/versements/${id}/preuve?i=${index}`;
}

function normalizeStoredPreuves(doc: VersementDoc): StoredPreuve[] {
  if (Array.isArray(doc.preuves) && doc.preuves.length > 0) {
    return doc.preuves;
  }
  if (doc.preuveUrl || doc.preuveData) {
    return [
      {
        mime: doc.preuveMime || "image/jpeg",
        url: doc.preuveUrl || localPreuveUrl(doc._id.toHexString(), 0),
        publicId: doc.preuvePublicId || LOCAL_PREUVE_PUBLIC_ID,
        ...(doc.preuveData ? { data: doc.preuveData } : {}),
      },
    ];
  }
  return [];
}

function toPublicPreuves(doc: VersementDoc): VersementPreuve[] {
  const id = doc._id.toHexString();
  return normalizeStoredPreuves(doc).map((p, index) => {
    const isLocal =
      p.publicId === LOCAL_PREUVE_PUBLIC_ID ||
      !p.url ||
      p.url.startsWith("/api/");
    return {
      mime: p.mime || "image/jpeg",
      url: isLocal
        ? localPreuveUrl(id, index)
        : p.url.startsWith("http")
          ? p.url
          : localPreuveUrl(id, index),
      publicId: p.publicId || LOCAL_PREUVE_PUBLIC_ID,
    };
  });
}

function toPublic(doc: VersementDoc): Versement {
  const preuves = toPublicPreuves(doc);
  const first = preuves[0];
  return {
    id: doc._id.toHexString(),
    date: doc.date,
    site: doc.site,
    heureTransaction: doc.heureTransaction,
    trancheHoraire: isVersementTranche(doc.trancheHoraire)
      ? doc.trancheHoraire
      : trancheFromLegacyShift(doc.shift),
    membresPresents: Array.isArray(doc.membresPresents)
      ? doc.membresPresents
      : [],
    montant: doc.montant,
    numeroTransaction: doc.numeroTransaction,
    preuveMime: first?.mime || doc.preuveMime || "image/jpeg",
    preuveUrl: first?.url || localPreuveUrl(doc._id.toHexString(), 0),
    preuvePublicId: first?.publicId || doc.preuvePublicId || LOCAL_PREUVE_PUBLIC_ID,
    preuves,
    createdAt: doc.createdAt,
    actorId: doc.actorId,
    actorName: doc.actorName,
    actorUsername: doc.actorUsername,
    shift: doc.shift,
    statut: doc.statut,
    confirmedAt: doc.confirmedAt ?? null,
    confirmedById: doc.confirmedById ?? null,
    confirmedByName: doc.confirmedByName ?? null,
    updatedAt: doc.updatedAt ?? null,
    updatedById: doc.updatedById ?? null,
    updatedByName: doc.updatedByName ?? null,
    cancelledAt: doc.cancelledAt ?? null,
    cancelledById: doc.cancelledById ?? null,
    cancelledByName: doc.cancelledByName ?? null,
  };
}

function binaryFromBuffer(bytes: Buffer): Binary {
  return new Binary(bytes);
}

function bufferFromBinary(data: Binary): Buffer {
  const raw = data.buffer;
  return Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
}

async function storePreuves(input: {
  files: PreuveUpload[];
  versementId: string;
  date: string;
  site: VenteSite;
}): Promise<StoredPreuve[]> {
  assertPreuvesList(input.files.length);

  const prepared = input.files.map((file) => {
    const mime = inferPreuveMime({
      mime: file.mime,
      filename: file.filename,
      bytes: file.bytes,
    });
    assertPreuveFile({
      mime,
      size: file.bytes.length,
      filename: file.filename,
      bytes: file.bytes,
    });
    return { mime, bytes: file.bytes };
  });

  const useCloudinary = cloudinaryConfigured();
  if (!useCloudinary) {
    const total = prepared.reduce((sum, p) => sum + p.bytes.length, 0);
    if (total > MAX_PREUVES_LOCAL_TOTAL_BYTES) {
      throw new Error(
        "Captures trop lourdes au total (max. 12 Mo sans Cloudinary).",
      );
    }
  }

  const out: StoredPreuve[] = [];
  for (let index = 0; index < prepared.length; index += 1) {
    const item = prepared[index]!;
    if (useCloudinary) {
      try {
        const uploaded = await uploadVersementPreuve({
          bytes: item.bytes,
          mime: item.mime,
          versementId: input.versementId,
          date: input.date,
          site: input.site,
          index,
        });
        out.push({
          mime: item.mime,
          url: uploaded.url,
          publicId: uploaded.publicId,
        });
        continue;
      } catch {
        /* secours Mongo ci-dessous */
      }
    }
    out.push({
      mime: item.mime,
      url: localPreuveUrl(input.versementId, index),
      publicId: LOCAL_PREUVE_PUBLIC_ID,
      data: binaryFromBuffer(item.bytes),
    });
  }

  const localTotal = out
    .filter((p) => p.data)
    .reduce((sum, p) => sum + (p.data ? bufferFromBinary(p.data).length : 0), 0);
  if (localTotal > MAX_PREUVES_LOCAL_TOTAL_BYTES) {
    throw new Error(
      "Captures trop lourdes au total (max. 12 Mo sans Cloudinary).",
    );
  }

  return out;
}

export async function listVersements(input: {
  date?: string;
  from?: string;
  to?: string;
  site?: VenteSite | "all";
  statut?: VersementStatut | "all";
}): Promise<Versement[]> {
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
  if (input.statut && input.statut !== "all") {
    filter.statut = input.statut;
  }

  const docs = await db
    .collection<VersementDoc>(COLLECTION)
    .find(filter)
    .sort({ date: -1, createdAt: -1 })
    .limit(1000)
    .toArray();

  return docs.map(toPublic);
}

export async function getVersement(id: string): Promise<Versement | null> {
  if (!ObjectId.isValid(id)) return null;
  const db = await getDb();
  const doc = await db
    .collection<VersementDoc>(COLLECTION)
    .findOne({ _id: new ObjectId(id) });
  return doc ? toPublic(doc) : null;
}

export async function declareVersement(input: {
  date?: string;
  site: VenteSite;
  heureTransaction: string;
  trancheHoraire: unknown;
  membresPresents: unknown;
  montant: unknown;
  numeroTransaction: string;
  /** Une ou plusieurs captures. */
  preuves: PreuveUpload[];
  actor: VersementActor;
}): Promise<Versement> {
  if (!canDeclareVersement(input.actor.role)) {
    throw new Error("Seule l’équipe peut enregistrer un versement.");
  }

  const date = input.date || todayIsoDate();
  assertValidDate(date);
  const heureTransaction = parseVersementHeure(input.heureTransaction);
  const trancheHoraire = parseVersementTranche(input.trancheHoraire);
  const membresPresents = parseVersementMembres(input.membresPresents);
  const montant = parseVersementMontant(input.montant);
  const numeroTransaction = parseVersementNumero(input.numeroTransaction);

  const _id = new ObjectId();
  const createdAt = new Date().toISOString();
  const idHex = _id.toHexString();

  const stored = await storePreuves({
    files: input.preuves,
    versementId: idHex,
    date,
    site: input.site,
  });
  const first = stored[0]!;

  const doc: VersementDoc = {
    _id,
    date,
    site: input.site,
    heureTransaction,
    trancheHoraire,
    membresPresents,
    montant,
    numeroTransaction,
    preuveMime: first.mime,
    preuveUrl: first.url,
    preuvePublicId: first.publicId,
    preuves: stored.map(({ mime, url, publicId, data }) => ({
      mime,
      url,
      publicId,
      ...(data ? { data } : {}),
    })),
    ...(first.data ? { preuveData: first.data } : {}),
    createdAt,
    actorId: input.actor.id,
    actorName: input.actor.name,
    actorUsername: input.actor.username,
    shift: effectiveShift(input.actor.shift),
    statut: "en_attente",
    confirmedAt: null,
    confirmedById: null,
    confirmedByName: null,
  };

  const db = await getDb();
  await db.collection<VersementDoc>(COLLECTION).insertOne(doc);

  return toPublic(doc);
}

export async function confirmVersement(input: {
  id: string;
  actor: VersementActor;
}): Promise<Versement> {
  if (!canConfirmVersement(input.actor.role)) {
    throw new Error("Seul le comptable peut confirmer un versement.");
  }
  if (!ObjectId.isValid(input.id)) {
    throw new Error("Versement introuvable.");
  }

  const db = await getDb();
  const confirmedAt = new Date().toISOString();
  const result = await db.collection<VersementDoc>(COLLECTION).findOneAndUpdate(
    { _id: new ObjectId(input.id), statut: "en_attente" },
    {
      $set: {
        statut: "confirmee" satisfies VersementStatut,
        confirmedAt,
        confirmedById: input.actor.id,
        confirmedByName: input.actor.name,
      },
    },
    { returnDocument: "after" },
  );

  const doc = result;
  if (!doc) {
    const existing = await db
      .collection<VersementDoc>(COLLECTION)
      .findOne({ _id: new ObjectId(input.id) });
    if (!existing) throw new Error("Versement introuvable.");
    if (existing.statut === "confirmee") {
      throw new Error(
        "Ce versement est déjà confirmé et verrouillé : aucune modification possible.",
      );
    }
    throw new Error("Confirmation impossible.");
  }

  return toPublic(doc);
}

export async function updateVersement(input: {
  id: string;
  date?: string;
  site?: VenteSite;
  heureTransaction: string;
  trancheHoraire: unknown;
  membresPresents: unknown;
  montant: unknown;
  numeroTransaction: string;
  /** Si fourni et non vide, remplace les captures existantes. */
  preuves?: PreuveUpload[];
  actor: VersementActor;
}): Promise<Versement> {
  if (!ObjectId.isValid(input.id)) {
    throw new Error("Versement introuvable.");
  }

  const db = await getDb();
  const existing = await db
    .collection<VersementDoc>(COLLECTION)
    .findOne({ _id: new ObjectId(input.id) });
  if (!existing) throw new Error("Versement introuvable.");
  if (existing.statut === "annulee") {
    throw new Error("Ce versement est annulé : aucune modification possible.");
  }
  if (!canUpdateVersement(input.actor.role, existing.statut)) {
    if (existing.statut === "confirmee") {
      throw new Error(
        "Ce versement est confirmé : seule une correction comptable est possible.",
      );
    }
    throw new Error("Vous ne pouvez pas modifier ce versement.");
  }

  const date = input.date || existing.date;
  assertValidDate(date);
  const site = input.site || existing.site;
  const heureTransaction = parseVersementHeure(input.heureTransaction);
  const trancheHoraire = parseVersementTranche(input.trancheHoraire);
  const membresPresents = parseVersementMembres(input.membresPresents);
  const montant = parseVersementMontant(input.montant);
  const numeroTransaction = parseVersementNumero(input.numeroTransaction);
  const updatedAt = new Date().toISOString();

  const setFields: Record<string, unknown> = {
    date,
    site,
    heureTransaction,
    trancheHoraire,
    membresPresents,
    montant,
    numeroTransaction,
    updatedAt,
    updatedById: input.actor.id,
    updatedByName: input.actor.name,
  };

  const unsetFields: Record<string, "" > = {};

  if (input.preuves && input.preuves.length > 0) {
    const stored = await storePreuves({
      files: input.preuves,
      versementId: input.id,
      date,
      site,
    });
    const first = stored[0]!;
    setFields.preuveMime = first.mime;
    setFields.preuveUrl = first.url;
    setFields.preuvePublicId = first.publicId;
    setFields.preuves = stored.map(({ mime, url, publicId, data }) => ({
      mime,
      url,
      publicId,
      ...(data ? { data } : {}),
    }));
    if (first.data) {
      setFields.preuveData = first.data;
    } else {
      unsetFields.preuveData = "";
    }
  }

  // Correction comptable d’un confirmé → remet en attente de re-confirmation.
  if (existing.statut === "confirmee" && input.actor.role === "comptable") {
    setFields.statut = "en_attente" satisfies VersementStatut;
    setFields.confirmedAt = null;
    setFields.confirmedById = null;
    setFields.confirmedByName = null;
  }

  const updateDoc: {
    $set: Record<string, unknown>;
    $unset?: Record<string, "">;
  } = { $set: setFields };
  if (Object.keys(unsetFields).length > 0) {
    updateDoc.$unset = unsetFields;
  }

  const result = await db
    .collection<VersementDoc>(COLLECTION)
    .findOneAndUpdate({ _id: new ObjectId(input.id) }, updateDoc, {
      returnDocument: "after",
    });

  if (!result) throw new Error("Modification impossible.");
  return toPublic(result);
}

export async function cancelVersement(input: {
  id: string;
  actor: VersementActor;
}): Promise<Versement> {
  if (!ObjectId.isValid(input.id)) {
    throw new Error("Versement introuvable.");
  }

  const db = await getDb();
  const existing = await db
    .collection<VersementDoc>(COLLECTION)
    .findOne({ _id: new ObjectId(input.id) });
  if (!existing) throw new Error("Versement introuvable.");
  if (!canCancelVersement(input.actor.role, existing.statut)) {
    if (existing.statut === "annulee") {
      throw new Error("Ce versement est déjà annulé.");
    }
    if (existing.statut === "confirmee") {
      throw new Error(
        "Ce versement est confirmé et verrouillé : annulation impossible.",
      );
    }
    throw new Error("Vous ne pouvez pas annuler ce versement.");
  }

  const cancelledAt = new Date().toISOString();
  const result = await db.collection<VersementDoc>(COLLECTION).findOneAndUpdate(
    { _id: new ObjectId(input.id), statut: "en_attente" },
    {
      $set: {
        statut: "annulee" satisfies VersementStatut,
        cancelledAt,
        cancelledById: input.actor.id,
        cancelledByName: input.actor.name,
        updatedAt: cancelledAt,
        updatedById: input.actor.id,
        updatedByName: input.actor.name,
      },
    },
    { returnDocument: "after" },
  );

  if (!result) throw new Error("Annulation impossible.");
  return toPublic(result);
}

/** URL distante d’une preuve (Cloudinary), ou null si locale / absente. */
export async function getVersementPreuveUrl(
  id: string,
  index = 0,
): Promise<string | null> {
  if (!ObjectId.isValid(id)) return null;
  const db = await getDb();
  const doc = await db
    .collection<VersementDoc>(COLLECTION)
    .findOne(
      { _id: new ObjectId(id) },
      { projection: { preuveUrl: 1, preuvePublicId: 1, preuves: 1 } },
    );
  if (!doc) return null;
  const list = normalizeStoredPreuves(doc);
  const item = list[index];
  if (!item) return null;
  if (item.publicId === LOCAL_PREUVE_PUBLIC_ID) return null;
  if (item.url?.startsWith("http")) return item.url;
  return null;
}

/** Octets d’une preuve stockée en local (Mongo), ou null. */
export async function getVersementPreuveBytes(
  id: string,
  index = 0,
): Promise<{ mime: string; bytes: Buffer } | null> {
  if (!ObjectId.isValid(id)) return null;
  const db = await getDb();
  const doc = await db
    .collection<VersementDoc>(COLLECTION)
    .findOne(
      { _id: new ObjectId(id) },
      {
        projection: {
          preuveMime: 1,
          preuveData: 1,
          preuvePublicId: 1,
          preuves: 1,
        },
      },
    );
  if (!doc) return null;
  const list = normalizeStoredPreuves(doc);
  const item = list[index];
  if (!item?.data) {
    if (index === 0 && doc.preuveData) {
      return {
        mime: doc.preuveMime || "image/jpeg",
        bytes: bufferFromBinary(doc.preuveData),
      };
    }
    return null;
  }
  return {
    mime: item.mime || "image/jpeg",
    bytes: bufferFromBinary(item.data),
  };
}
