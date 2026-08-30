/**
 * Alphabet sans caractères ambigus (0/O, 1/I/L) — code collé sur l’étiquette.
 */
export const STICKER_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** Compacte une saisie : majuscules, sans tirets ni espaces, sans préfixe KF. */
export function normalizeStickerCode(raw: string): string {
  const compact = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (!compact) return "";
  if (compact.startsWith("KF") && compact.length > 2) return compact.slice(2);
  return compact;
}

/** Affichage étiquette : A7K-3Q2 */
export function formatStickerCode(code: string): string {
  const n = normalizeStickerCode(code);
  if (n.length === 6) return `${n.slice(0, 3)}-${n.slice(3)}`;
  return n || code;
}

/**
 * Extrait l'identifiant unité depuis une lecture brute : QR (KF-…),
 * code collé (A7K3Q2 / A7K-3Q2), URL, ou UUID historique.
 */
export function parseQrIdFromScan(raw: string): string {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return "";

  try {
    if (trimmed.includes("://") || trimmed.startsWith("?")) {
      const url = new URL(
        trimmed.startsWith("?") ? `https://local${trimmed}` : trimmed,
      );
      const fromParam =
        url.searchParams.get("qrId") ??
        url.searchParams.get("scan") ??
        url.searchParams.get("id") ??
        url.searchParams.get("code");
      if (fromParam?.trim()) {
        const param = fromParam.trim();
        if (param !== trimmed) return parseQrIdFromScan(param);
        return param;
      }
      const pathMatch = url.pathname.match(/KF-[0-9A-Z-]{6,}/i);
      if (pathMatch) return pathMatch[0];
    }
  } catch {
    /* pas une URL */
  }

  const embeddedUuid = trimmed.match(
    /KF-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/i,
  );
  if (embeddedUuid) return embeddedUuid[0];

  const shortKf = trimmed.match(/KF-[0-9A-Z]{6,}/i);
  if (shortKf) return shortKf[0].toUpperCase();

  const sticker = normalizeStickerCode(trimmed);
  if (sticker.length >= 6) return sticker;

  return trimmed;
}
