/**
 * Planning des 12 comptes gérant Zogbo (équipe1 … équipe12).
 * Actif à partir du 2026-09-01 (mardi) — fermeture tous les lundis.
 *
 * 1–6  = Matin 08h–16h (mardi → dimanche)
 * 7–12 = Soir  16h–00h (mardi → dimanche)
 */
import { previousIsoDate, todayIsoDate } from "@/lib/zogbo-calc";
import {
  EQUIPE_GRACE_MINUTES,
  isSoirGraceAfterMidnight,
  isWithinEquipePeriodeWithGrace,
} from "@/lib/equipe-horaire-marge";

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
  /** Identifiant de connexion : equipe1 … equipe12 */
  username: string;
  /** Libellé affiché : Équipe 1 … Équipe 12 */
  name: string;
  numero: number;
  periode: ZogboPeriode;
  jourSlug: Exclude<ZogboJourSlug, "lundi">;
  /** Shift stocké en base (matin → jour, soir → soir). */
  shift: "jour" | "soir";
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

function buildComptes(): ZogboPlanningCompte[] {
  const out: ZogboPlanningCompte[] = [];
  let n = 1;
  for (const jourSlug of JOURS_OUVERTS) {
    out.push({
      numero: n,
      username: `equipe${n}`,
      name: `Équipe ${n}`,
      periode: "matin",
      jourSlug,
      shift: "jour",
      horaire: "08h00–16h00",
    });
    n += 1;
  }
  for (const jourSlug of JOURS_OUVERTS) {
    out.push({
      numero: n,
      username: `equipe${n}`,
      name: `Équipe ${n}`,
      periode: "soir",
      jourSlug,
      shift: "soir",
      horaire: "16h00–00h00",
    });
    n += 1;
  }
  return out;
}

export const ZOGBO_PLANNING_COMPTES: readonly ZogboPlanningCompte[] =
  buildComptes();

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

export function isWithinZogboPeriode(
  periode: ZogboPeriode,
  now = new Date(),
): boolean {
  return isWithinEquipePeriodeWithGrace(periode, now);
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
 * Marge : 15 min après la fin du créneau.
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

  const now = input.now ?? new Date();
  // Marge soir après minuit : le jour de service reste la veille.
  let jourDate = input.serviceDate;
  if (compte.periode === "soir" && isSoirGraceAfterMidnight(now)) {
    jourDate = previousIsoDate(input.serviceDate) ?? input.serviceDate;
  }
  const jour = jourSlugFromIsoDate(jourDate);

  if (jour === "lundi") {
    throw new Error(
      "Vente refusée : Zogbo est fermé le lundi. Aucun compte planning n’est prévu ce jour-là.",
    );
  }
  if (jour !== compte.jourSlug) {
    throw new Error(
      `Vente refusée : ${compte.name} est réservée au ${compte.jourSlug}. Aujourd’hui (${input.serviceDate}) c’est ${jourSlugFromIsoDate(input.serviceDate)}. Connectez le compte du jour.`,
    );
  }
  if (!isWithinZogboPeriode(compte.periode, now)) {
    throw new Error(
      `Vente refusée : hors créneau ${compte.periode} (${compte.horaire}, marge +${EQUIPE_GRACE_MINUTES} min). Connectez le compte de la période en cours.`,
    );
  }
}

/** Date de service courante (fuseau restaurant), pour les gardes hors backdate. */
export function currentServiceDate(now = new Date()): string {
  return todayIsoDate(now);
}
