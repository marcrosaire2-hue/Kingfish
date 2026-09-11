/**
 * Créneaux d’équipe + marge de 15 min après la fin officielle
 * avant blocage (connexion / ventes).
 */
import { BUSINESS_TIMEZONE } from "@/lib/zogbo-calc";

/** Minutes accordées après la fin du créneau avant blocage. */
export const EQUIPE_GRACE_MINUTES = 15;

export type EquipePeriode = "nuit" | "matin" | "soir";

/** Minutes depuis minuit (0–1439) dans le fuseau restaurant. */
export function minutesInBusinessTz(now = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

/**
 * Fenêtres officielles (fin exclusive) + marge à la fin.
 * - nuit  00:00 → 08:00 (+15 → 08:15)
 * - matin 08:00 → 16:00 (+15 → 16:15)
 * - soir  16:00 → 24:00 (+15 → 00:15 lendemain)
 */
export function isWithinEquipePeriodeWithGrace(
  periode: EquipePeriode,
  now = new Date(),
): boolean {
  const m = minutesInBusinessTz(now);
  if (periode === "nuit") {
    // 00:00 inclus → 08:15 exclus
    return m >= 0 && m < 8 * 60 + EQUIPE_GRACE_MINUTES;
  }
  if (periode === "matin") {
    // 08:00 inclus → 16:15 exclus
    return m >= 8 * 60 && m < 16 * 60 + EQUIPE_GRACE_MINUTES;
  }
  // Soir : 16:00 → 24:00, puis marge 00:00–00:15
  return m >= 16 * 60 || m < EQUIPE_GRACE_MINUTES;
}

/**
 * Créneau « strict » (sans marge) — pour savoir qui possède la plage
 * (ex. seule la nuit gère 00h–08h, pas la marge matin).
 */
export function isWithinEquipePeriodeStrict(
  periode: EquipePeriode,
  now = new Date(),
): boolean {
  const m = minutesInBusinessTz(now);
  if (periode === "nuit") return m >= 0 && m < 8 * 60;
  if (periode === "matin") return m >= 8 * 60 && m < 16 * 60;
  return m >= 16 * 60;
}

/** Pendant la marge soir après minuit (00:00–00:15). */
export function isSoirGraceAfterMidnight(now = new Date()): boolean {
  return minutesInBusinessTz(now) < EQUIPE_GRACE_MINUTES;
}
