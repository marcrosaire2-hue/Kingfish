export const BUSINESS_TIMEZONE = "Africa/Porto-Novo";

export function isoDateInTimeZone(
  instant: Date | string,
  timeZone = BUSINESS_TIMEZONE,
): string {
  const d = typeof instant === "string" ? new Date(instant) : instant;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function formatWhenFr(iso: string): string {
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "short",
      timeStyle: "medium",
      timeZone: BUSINESS_TIMEZONE,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function formatDateFr(iso: string): string {
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "short",
      timeZone: BUSINESS_TIMEZONE,
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

export function formatTimeFr(iso: string): string {
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZone: BUSINESS_TIMEZONE,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/** Vente comptée sur un jour passé mais saisie un autre jour calendaire. */
export function isBackdatedRecord(businessDate: string, recordedAt: string): boolean {
  if (!businessDate || !recordedAt) return false;
  return isoDateInTimeZone(recordedAt) > businessDate;
}
