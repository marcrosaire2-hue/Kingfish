/**
 * Planning des 12 comptes gérant Zogbo (1 compte = 1 jour × 1 créneau).
 * Actif à partir du 2026-09-01 (mardi) — fermeture tous les lundis.
 */
import { BUSINESS_TIMEZONE, todayIsoDate } from "@/lib/zogbo-calc";

/** Premier jour d’application du planning (mardi 1er septembre 2026). */
export const ZOGBO_PLANNING_START_ISO = "2026-09-01";

const JOUR_SLUGS = [
  "dimanche",
  "lundi",
  "mardi",
  "mercredi",
  "jeudi",
  "vendredi",
  "samedi",
] as const;

export type ZogboJourSlug = (typeof JOUR_SLUGS)[number];
export type ZogboPeriode = "matin" | "soir";

export type ZogboPlanningCompte = {
  username: string;
  periode: ZogboPeriode;
  jourSlug: Exclude<ZogboJourSlug, "lundi">;
  /** Shift stocké en base (matin → jour, soir → nuit). */
  shift: "jour" | "nuit";
  horaire: string;
};

const JOURS_OUVERTS = [
  "mardi",
  "mercredi",
  "jeudi",
  "vendredi",
  "samedi",
  "dimanche",
] as const;

export const ZOGBO_PLANNING_COMPTES: readonly ZogboPlanningCompte[] =
  JOURS_OUVERTS.flatMap((jourSlug) => [
    {
      username: `zogbo.matin.${jourSlug}`,
      periode: "matin" as const,
      jourSlug,
      shift: "jour" as const,
      horaire: "08h00–16h00",
    },
    {
      username: `zogbo.soir.${jourSlug}`,
      periode: "soir" as const,
      jourSlug,
      shift: "nuit" as const,
      horaire: "16h00–00h00",
    },
  ]);

const BY_USERNAME = new Map(
  ZOGBO_PLANNING_COMPTES.map((c) => [c.username, c] as const),
);

export function findZogboPlanningCompte(
  username: string | null | undefined,
): ZogboPlanningCompte | null {
  if (!username?.trim()) return null;
  return BY_USERNAME.get(username.trim().toLowerCase()) ?? null;
}

/** Jour de la semaine (slug FR) pour une date ISO calendaire. */
export function jourSlugFromIsoDate(isoDate: string): ZogboJourSlug {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!, 12));
  return JOUR_SLUGS[dt.getUTCDay()]!;
}

function hourInBusinessTz(now: Date): number {
  const formatted = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIMEZONE,
    hour: "2-digit",
    hour12: false,
  }).format(now);
  return Number(formatted) % 24;
}

export function isWithinZogboPeriode(
  periode: ZogboPeriode,
  now = new Date(),
): boolean {
  const h = hourInBusinessTz(now);
  if (periode === "matin") return h >= 8 && h < 16;
  // Soir : 16h00 inclus → 00h00 exclus (fin de journée civile).
  return h >= 16;
}

export function isZogboPlanningActive(
  serviceDate: string,
  startIso = ZOGBO_PLANNING_START_ISO,
): boolean {
  return serviceDate >= startIso;
}

/**
 * Garde d’encaissement pour les 12 comptes planning.
 * Sans effet avant la date d’activation, ni pour les autres comptes.
 */
export function assertZogboPlanningSale(input: {
  username: string;
  /** Date de service (jour de caisse / vente). */
  serviceDate: string;
  now?: Date;
}): void {
  const compte = findZogboPlanningCompte(input.username);
  if (!compte) return;
  if (!isZogboPlanningActive(input.serviceDate)) return;

  const jour = jourSlugFromIsoDate(input.serviceDate);
  if (jour === "lundi") {
    throw new Error(
      "Vente refusée : Zogbo est fermé le lundi. Aucun compte planning n’est prévu ce jour-là.",
    );
  }
  if (jour !== compte.jourSlug) {
    const attendu = compte.jourSlug;
    throw new Error(
      `Vente refusée : le compte ${compte.username} est réservé au ${attendu}. Aujourd’hui (${input.serviceDate}) c’est ${jour}. Connectez le compte du jour.`,
    );
  }
  if (!isWithinZogboPeriode(compte.periode, input.now)) {
    throw new Error(
      `Vente refusée : hors créneau ${compte.periode} (${compte.horaire}). Connectez le compte de la période en cours.`,
    );
  }
}

/** Date de service courante (fuseau restaurant), pour les gardes hors backdate. */
export function currentServiceDate(now = new Date()): string {
  return todayIsoDate(now);
}
