import { ObjectId } from "mongodb";
import type { UserRole, UserShift } from "@/lib/auth-types";
import { effectiveShift } from "@/lib/auth-types";
import { uploadVersementPreuve } from "@/lib/cloudinary";
import { assertValidDate } from "@/lib/day-doc";
import { getDb } from "@/lib/mongodb";
import type {
  Versement,
  VersementStatut,
  VersementTranche,
  VenteSite,
} from "@/lib/types";
import {
  assertPreuveFile,
  canConfirmVersement,
  canDeclareVersement,
  defaultTrancheFromShift,
  isVersementTranche,
  parseVersementHeure,
  parseVersementMembres,
  parseVersementMontant,
  parseVersementNumero,
  parseVersementTranche,
} from "@/lib/versements-model";
import { todayIsoDate } from "@/lib/zogbo-calc";

export {
  assertPreuveFile,
  canConfirmVersement,
  canDeclareVersement,
  defaultTrancheFromShift,
  parseVersementHeure,
  parseVersementMembres,
  parseVersementMontant,
  parseVersementNumero,
  parseVersementTranche,
} from "@/lib/versements-model";

const COLLECTION = "versements";

type VersementDoc = Omit<Versement, "id"> & {
  _id: ObjectId;
  /** Anciens documents sans ces champs. */
  trancheHoraire?: VersementTranche;
  membresPresents?: string[];
};

export type VersementActor = {
  id: string;
  name: string;
  username: string;
  role: UserRole;
  shift?: UserShift | null;
};

function trancheFromLegacyShift(shift: UserShift | undefined): VersementTranche {
  return defaultTrancheFromShift(shift);
}

function toPublic(doc: VersementDoc): Versement {
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
    preuveMime: doc.preuveMime,
    preuveUrl: doc.preuveUrl,
    preuvePublicId: doc.preuvePublicId,
    createdAt: doc.createdAt,
    actorId: doc.actorId,
    actorName: doc.actorName,
    actorUsername: doc.actorUsername,
    shift: doc.shift,
    statut: doc.statut,
    confirmedAt: doc.confirmedAt ?? null,
    confirmedById: doc.confirmedById ?? null,
    confirmedByName: doc.confirmedByName ?? null,
  };
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

export async function declareVersement(input: {
  date?: string;
  site: VenteSite;
  heureTransaction: string;
  trancheHoraire: unknown;
  membresPresents: unknown;
  montant: unknown;
  numeroTransaction: string;
  preuve: { mime: string; bytes: Buffer };
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
  const mime =
    input.preuve.mime === "image/jpg" ? "image/jpeg" : input.preuve.mime;
  assertPreuveFile({ mime, size: input.preuve.bytes.length });

  const _id = new ObjectId();
  const createdAt = new Date().toISOString();

  const uploaded = await uploadVersementPreuve({
    bytes: input.preuve.bytes,
    mime,
    versementId: _id.toHexString(),
    date,
    site: input.site,
  });

  const doc: VersementDoc = {
    _id,
    date,
    site: input.site,
    heureTransaction,
    trancheHoraire,
    membresPresents,
    montant,
    numeroTransaction,
    preuveMime: mime,
    preuveUrl: uploaded.url,
    preuvePublicId: uploaded.publicId,
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

/** URL Cloudinary de la preuve, ou null si absente. */
export async function getVersementPreuveUrl(id: string): Promise<string | null> {
  if (!ObjectId.isValid(id)) return null;
  const db = await getDb();
  const doc = await db
    .collection<VersementDoc>(COLLECTION)
    .findOne(
      { _id: new ObjectId(id) },
      { projection: { preuveUrl: 1 } },
    );
  return doc?.preuveUrl ?? null;
}
