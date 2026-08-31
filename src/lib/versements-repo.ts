import { ObjectId } from "mongodb";
import type { UserRole, UserShift } from "@/lib/auth-types";
import { effectiveShift } from "@/lib/auth-types";
import { uploadVersementPreuve } from "@/lib/cloudinary";
import { assertValidDate } from "@/lib/day-doc";
import { getDb } from "@/lib/mongodb";
import type { Versement, VersementStatut, VenteSite } from "@/lib/types";
import { todayIsoDate } from "@/lib/zogbo-calc";

const COLLECTION = "versements";

const MAX_PREUVE_BYTES = 4 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/jpg",
]);

type VersementDoc = Omit<Versement, "id"> & { _id: ObjectId };

export type VersementActor = {
  id: string;
  name: string;
  username: string;
  role: UserRole;
  shift?: UserShift | null;
};

/** Seule l’équipe (gérant) enregistre un versement. Admin et DAF sont lecteurs. */
export function canDeclareVersement(role: UserRole): boolean {
  return role === "gerant";
}

/** Seul le comptable confirme. Admin et DAF sont lecteurs. */
export function canConfirmVersement(role: UserRole): boolean {
  return role === "comptable";
}

export function parseVersementHeure(raw: string): string {
  const value = raw.trim();
  if (!/^\d{2}:\d{2}$/.test(value)) {
    throw new Error("Heure invalide (attendu HH:MM).");
  }
  const [h, m] = value.split(":").map(Number) as [number, number];
  if (h > 23 || m > 59) {
    throw new Error("Heure invalide (attendu HH:MM).");
  }
  return value;
}

export function parseVersementMontant(raw: unknown): number {
  const n =
    typeof raw === "number"
      ? raw
      : Number(String(raw ?? "").replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error("Montant invalide (strictement positif).");
  }
  return Math.round(n);
}

export function parseVersementNumero(raw: string): string {
  const value = raw.trim();
  if (value.length < 3) {
    throw new Error("Numéro de transaction trop court.");
  }
  if (value.length > 80) {
    throw new Error("Numéro de transaction trop long.");
  }
  return value;
}

export function assertPreuveFile(input: {
  mime: string;
  size: number;
}): void {
  const mime = input.mime === "image/jpg" ? "image/jpeg" : input.mime;
  if (!ALLOWED_MIME.has(mime)) {
    throw new Error("Capture d’écran : JPEG, PNG ou WebP uniquement.");
  }
  if (input.size <= 0) {
    throw new Error("Capture d’écran manquante.");
  }
  if (input.size > MAX_PREUVE_BYTES) {
    throw new Error("Capture d’écran trop lourde (max. 4 Mo).");
  }
}

function toPublic(doc: VersementDoc): Versement {
  return {
    id: doc._id.toHexString(),
    date: doc.date,
    site: doc.site,
    heureTransaction: doc.heureTransaction,
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
