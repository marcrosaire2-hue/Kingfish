/**
 * Modèle / validation versements — sans Mongo ni Cloudinary
 * (importable depuis les Client Components).
 */
import type { UserRole, UserShift } from "@/lib/auth-types";
import { effectiveShift } from "@/lib/auth-types";
import type { VersementTranche } from "@/lib/types";

const TRANCHES: VersementTranche[] = ["nuit", "matin", "soir"];

export const MAX_PREUVE_BYTES = 4 * 1024 * 1024;
export const MAX_PREUVES = 6;
/** Plafond total pour stockage Mongo local (limite BSON ~16 Mo). */
export const MAX_PREUVES_LOCAL_TOTAL_BYTES = 12 * 1024 * 1024;

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/jpg",
]);

/** Seule l’équipe (gérant) enregistre un versement. Admin et DAF sont lecteurs. */
export function canDeclareVersement(role: UserRole): boolean {
  return role === "gerant";
}

/** Gérant : corriger ou retirer un versement encore en attente. */
export function canEditVersement(role: UserRole): boolean {
  return role === "gerant";
}

/** Alias explicite — mêmes droits que la modification. */
export function canDeleteVersement(role: UserRole): boolean {
  return canEditVersement(role);
}

/** Seul le comptable confirme. Admin et DAF sont lecteurs. */
export function canConfirmVersement(role: UserRole): boolean {
  return role === "comptable";
}

export function parseVersementHeure(raw: string): string {
  const value = raw
    .trim()
    .replace(/\./g, ":")
    .replace(/\s*[hH]\s*/g, ":")
    .replace(/\s+/g, "");
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value);
  if (!match) {
    throw new Error("Heure invalide (attendu HH:MM).");
  }
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h > 23 || m > 59) {
    throw new Error("Heure invalide (attendu HH:MM).");
  }
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
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

export function parseVersementTranche(raw: unknown): VersementTranche {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!TRANCHES.includes(value as VersementTranche)) {
    throw new Error(
      "Tranche d’horaire requise : Nuit (00h–08h), Matin (08h–16h) ou Soir (16h–00h).",
    );
  }
  return value as VersementTranche;
}

/** Noms des membres présents — au moins un, nettoyés et sans doublon. */
export function parseVersementMembres(raw: unknown): string[] {
  const parts = Array.isArray(raw)
    ? raw.map((x) => String(x ?? ""))
    : String(raw ?? "")
        .split(/[\n,;]+/)
        .map((s) => s.trim());

  const names: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const name = part.trim().replace(/\s+/g, " ");
    if (!name) continue;
    if (name.length < 2) {
      throw new Error("Nom de membre trop court.");
    }
    if (name.length > 80) {
      throw new Error("Nom de membre trop long.");
    }
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  if (names.length === 0) {
    throw new Error(
      "Indiquez le nom de chaque membre de l’équipe présent (au moins un).",
    );
  }
  if (names.length > 12) {
    throw new Error("Trop de membres déclarés (max. 12).");
  }
  return names;
}

/** Propose la tranche à partir du shift du compte connecté. */
export function defaultTrancheFromShift(
  shift: UserShift | string | null | undefined,
): VersementTranche {
  const s = effectiveShift(shift);
  if (s === "nuit") return "nuit";
  if (s === "soir") return "soir";
  return "matin";
}

/** Déduit le MIME (type navigateur vide, extension, ou en-têtes magiques). */
export function inferPreuveMime(input: {
  mime?: string;
  filename?: string;
  bytes?: Buffer | Uint8Array;
}): string {
  let mime = (input.mime || "").trim().toLowerCase();
  if (mime === "image/jpg") mime = "image/jpeg";
  if (ALLOWED_MIME.has(mime)) return mime === "image/jpg" ? "image/jpeg" : mime;

  const name = (input.filename || "").trim().toLowerCase();
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";

  const bytes = input.bytes;
  if (bytes && bytes.length >= 12) {
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return "image/jpeg";
    }
    if (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    ) {
      return "image/png";
    }
    const head = Buffer.from(bytes.subarray(0, 12)).toString("ascii");
    if (head.startsWith("RIFF") && head.slice(8, 12) === "WEBP") {
      return "image/webp";
    }
  }
  return mime;
}

export function assertPreuveFile(input: {
  mime: string;
  size: number;
  filename?: string;
  bytes?: Buffer | Uint8Array;
}): void {
  const mime = inferPreuveMime(input);
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

export function assertPreuvesList(count: number): void {
  if (count <= 0) {
    throw new Error("Joignez au moins une capture d’écran.");
  }
  if (count > MAX_PREUVES) {
    throw new Error(`Trop de captures (max. ${MAX_PREUVES}).`);
  }
}

export function isVersementTranche(
  value: unknown,
): value is VersementTranche {
  return TRANCHES.includes(value as VersementTranche);
}
