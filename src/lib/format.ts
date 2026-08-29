/** Instance réutilisée : créée une seule fois, pas par appel. */
const CURRENCY_FORMAT = new Intl.NumberFormat("fr-FR");

export function formatFcfa(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return `${CURRENCY_FORMAT.format(value)} FCFA`;
}

/** Version courte pour les graphiques (centre de donut, petits blocs). */
export function formatFcfaCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    const m = value / 1_000_000;
    return `${m.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} M`;
  }
  if (abs >= 10_000) {
    const k = value / 1_000;
    return `${k.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} k`;
  }
  return CURRENCY_FORMAT.format(value);
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
