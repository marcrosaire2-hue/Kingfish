/** Instance réutilisée : créée une seule fois, pas par appel. */
const CURRENCY_FORMAT = new Intl.NumberFormat("fr-FR");

export function formatFcfa(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return `${CURRENCY_FORMAT.format(value)} FCFA`;
}

export function parseMoneyInput(raw: string): number | null {
  const cleaned = raw
    .replace(/\s/g, "")
    .replace(/FCFA$/i, "")
    .replace(",", ".")
    .replace(/F$/i, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

export function formatUpdatedAt(iso: string | null): string {
  if (!iso) return "Jamais enregistré";
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}
