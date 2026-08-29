/**
 * Extrait l'identifiant unité (KF-…) depuis une lecture brute : texte direct,
 * URL avec paramètre, ou chaîne mélangée.
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
        url.searchParams.get("id");
      if (fromParam?.trim()) return fromParam.trim();
      const pathMatch = url.pathname.match(/KF-[0-9a-f-]{8,}/i);
      if (pathMatch) return pathMatch[0];
    }
  } catch {
    /* pas une URL */
  }

  const embedded = trimmed.match(/KF-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/i);
  if (embedded) return embedded[0];

  const short = trimmed.match(/KF-[0-9a-f-]{8,}/i);
  if (short) return short[0];

  return trimmed;
}
