/**
 * Modèle / validation Kwater — sans Mongo ni Cloudinary
 * (importable depuis les Client Components).
 */
import type { UserRole, UserShift } from "@/lib/auth-types";
import { effectiveShift } from "@/lib/auth-types";
import type { KwaterPeriode } from "@/lib/types";

const PERIODES: KwaterPeriode[] = ["matin", "soir"];

export const MAX_KWATER_PREUVE_BYTES = 4 * 1024 * 1024;

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/jpg",
]);

/** Gérant : enregistre / met à jour un relevé. Admin et DAF / comptable : lecture. */
export function canDeclareKwater(role: UserRole): boolean {
  return role === "gerant";
}

export function canUpdateKwater(role: UserRole): boolean {
  return role === "gerant";
}

export function parseKwaterPeriode(raw: unknown): KwaterPeriode {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!PERIODES.includes(value as KwaterPeriode)) {
    throw new Error("Période requise : Matin ou Soir.");
  }
  return value as KwaterPeriode;
}

export function parseKwaterQuantite(raw: unknown): number {
  const n =
    typeof raw === "number"
      ? raw
      : Number(String(raw ?? "").replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(n) || n < 0) {
    throw new Error("Quantité invalide (nombre ≥ 0).");
  }
  // Une décimale suffit pour un relevé de stock / compteur.
  return Math.round(n * 10) / 10;
}

/** Propose la période à partir du shift du compte connecté. */
export function defaultPeriodeFromShift(
  shift: UserShift | string | null | undefined,
): KwaterPeriode {
  const s = effectiveShift(shift);
  if (s === "soir" || s === "nuit") return "soir";
  return "matin";
}

export function inferKwaterPreuveMime(input: {
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

export function assertKwaterPreuveFile(input: {
  mime: string;
  size: number;
  filename?: string;
  bytes?: Buffer | Uint8Array;
}): void {
  const mime = inferKwaterPreuveMime(input);
  if (!ALLOWED_MIME.has(mime)) {
    throw new Error("Capture d’écran : JPEG, PNG ou WebP uniquement.");
  }
  if (input.size <= 0) {
    throw new Error("Capture d’écran manquante.");
  }
  if (input.size > MAX_KWATER_PREUVE_BYTES) {
    throw new Error("Capture d’écran trop lourde (max. 4 Mo).");
  }
}

export function isKwaterPeriode(value: unknown): value is KwaterPeriode {
  return PERIODES.includes(value as KwaterPeriode);
}
