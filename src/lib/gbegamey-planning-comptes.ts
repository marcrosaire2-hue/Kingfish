/**
 * Planning des 20 comptes gérant Gbégamey (equipe13 … equipe32).
 * 7 jours × 3 créneaux − 1 (nuit du mardi fermée).
 * Actif à partir du 2026-09-01.
 *
 * Créneaux :
 * - Nuit  00h00–08h00
 * - Matin 08h00–16h00
 * - Soir  16h00–00h00
 */
import type { UserShift } from "@/lib/auth-types";
import { BUSINESS_TIMEZONE, todayIsoDate } from "@/lib/zogbo-calc";

export const GBEGAMEY_PLANNING_START_ISO = "2026-09-01";

const JOUR_SLUGS = [
  "dimanche",
  "lundi",
  "mardi",
  "mercredi",
  "jeudi",
  "vendredi",
  "samedi",
] as const;

export type GbegameyJourSlug = (typeof JOUR_SLUGS)[number];
export type GbegameyPeriode = "nuit" | "matin" | "soir";

export type GbegameyPlanningCompte = {
  username: string;
  name: string;
  numero: number;
  periode: GbegameyPeriode;
  jourSlug: GbegameyJourSlug;
  shift: Exclude<UserShift, "aucune">;
  horaire: string;
};

const TOUS_JOURS: readonly GbegameyJourSlug[] = [
  "lundi",
  "mardi",
  "mercredi",
  "jeudi",
  "vendredi",
  "samedi",
  "dimanche",
];

/** Mardi 00h–08h : fermé — pas de compte nuit ce jour-là. */
const NUITS_OUVERTES = TOUS_JOURS.filter((j) => j !== "mardi");

const PERIODE_META: Record<
  GbegameyPeriode,
  { shift: Exclude<UserShift, "aucune">; horaire: string }
> = {
  nuit: { shift: "nuit", horaire: "00h00–08h00" },
  matin: { shift: "jour", horaire: "08h00–16h00" },
  soir: { shift: "soir", horaire: "16h00–00h00" },
};

function buildComptes(): GbegameyPlanningCompte[] {
  const out: GbegameyPlanningCompte[] = [];
  let n = 13;

  for (const jourSlug of NUITS_OUVERTES) {
    const meta = PERIODE_META.nuit;
    out.push({
      numero: n,
      username: `equipe${n}`,
      name: `Équipe ${n}`,
      periode: "nuit",
      jourSlug,
      shift: meta.shift,
      horaire: meta.horaire,
    });
    n += 1;
  }
  for (const jourSlug of TOUS_JOURS) {
    const meta = PERIODE_META.matin;
    out.push({
      numero: n,
      username: `equipe${n}`,
      name: `Équipe ${n}`,
      periode: "matin",
      jourSlug,
      shift: meta.shift,
      horaire: meta.horaire,
    });
    n += 1;
  }
  for (const jourSlug of TOUS_JOURS) {
    const meta = PERIODE_META.soir;
    out.push({
      numero: n,
      username: `equipe${n}`,
      name: `Équipe ${n}`,
      periode: "soir",
      jourSlug,
      shift: meta.shift,
      horaire: meta.horaire,
    });
    n += 1;
  }
  return out;
}

export const GBEGAMEY_PLANNING_COMPTES: readonly GbegameyPlanningCompte[] =
  buildComptes();

const BY_USERNAME = new Map(
  GBEGAMEY_PLANNING_COMPTES.map((c) => [c.username, c] as const),
);

export function findGbegameyPlanningCompte(
  username: string | null | undefined,
): GbegameyPlanningCompte | null {
  if (!username?.trim()) return null;
  return BY_USERNAME.get(username.trim().toLowerCase()) ?? null;
}

export function jourSlugFromIsoDate(isoDate: string): GbegameyJourSlug {
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

export function isWithinGbegameyPeriode(
  periode: GbegameyPeriode,
  now = new Date(),
): boolean {
  const h = hourInBusinessTz(now);
  if (periode === "nuit") return h >= 0 && h < 8;
  if (periode === "matin") return h >= 8 && h < 16;
  return h >= 16;
}

export function isGbegameyPlanningActive(
  serviceDate: string,
  startIso = GBEGAMEY_PLANNING_START_ISO,
): boolean {
  return serviceDate >= startIso;
}

/** Mardi nuit (00h–08h) : site fermé pour ce créneau. */
export function isGbegameyNuitMardiFerme(serviceDate: string): boolean {
  return jourSlugFromIsoDate(serviceDate) === "mardi";
}

export function assertGbegameyPlanningSale(input: {
  username: string;
  serviceDate: string;
  now?: Date;
}): void {
  const compte = findGbegameyPlanningCompte(input.username);
  if (!compte) return;
  if (!isGbegameyPlanningActive(input.serviceDate)) return;

  const jour = jourSlugFromIsoDate(input.serviceDate);
  if (compte.periode === "nuit" && jour === "mardi") {
    throw new Error(
      "Vente refusée : Gbégamey est fermé le mardi de 00h00 à 08h00.",
    );
  }
  if (jour !== compte.jourSlug) {
    throw new Error(
      `Vente refusée : ${compte.name} est réservée au ${compte.jourSlug}. Aujourd’hui (${input.serviceDate}) c’est ${jour}. Connectez le compte du jour.`,
    );
  }
  if (!isWithinGbegameyPeriode(compte.periode, input.now)) {
    throw new Error(
      `Vente refusée : hors créneau ${compte.periode} (${compte.horaire}). Connectez le compte de la période en cours.`,
    );
  }
}

export function currentServiceDate(now = new Date()): string {
  return todayIsoDate(now);
}
