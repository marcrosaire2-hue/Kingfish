/**
 * Planning Gbégamey — organisation définitive.
 *
 * - 1 équipe nuit (00h–08h), seule autorisée la nuit ; mardi 00h–08h fermé
 * - 7 équipes matin (08h–16h) avec rotation croisée
 * - 5 équipes soir (16h–00h) : lundi, mardi, jeudi, vendredi, dimanche
 *
 * Identifiants : equipe13 … equipe25 (les anciens equipe26–32 sont supprimés).
 * Actif à partir du 2026-09-01.
 */
import type { UserShift } from "@/lib/auth-types";
import {
  EQUIPE_GRACE_MINUTES,
  isSoirGraceAfterMidnight,
  isWithinEquipePeriodeStrict,
  isWithinEquipePeriodeWithGrace,
  minutesInBusinessTz,
} from "@/lib/equipe-horaire-marge";
import { previousIsoDate, todayIsoDate } from "@/lib/zogbo-calc";

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
  /** Identité d’équipe (ex. « lundi » pour l’équipe du lundi). */
  equipeJour: GbegameyJourSlug | "nuit";
  /** Jours calendaires où ce compte peut encaisser. */
  joursAutorises: readonly GbegameyJourSlug[];
  shift: Exclude<UserShift, "aucune">;
  horaire: string;
};

const PERIODE_META: Record<
  GbegameyPeriode,
  { shift: Exclude<UserShift, "aucune">; horaire: string }
> = {
  nuit: { shift: "nuit", horaire: "00h00–08h00" },
  matin: { shift: "jour", horaire: "08h00–16h00" },
  soir: { shift: "soir", horaire: "16h00–00h00" },
};

/**
 * Matin : jour calendaire → identité d’équipe qui travaille.
 * Lundi → équipe du vendredi, etc.
 */
const MATIN_JOUR_VERS_EQUIPE: Record<GbegameyJourSlug, GbegameyJourSlug> = {
  lundi: "vendredi",
  mardi: "jeudi",
  mercredi: "dimanche",
  jeudi: "mardi",
  vendredi: "lundi",
  samedi: "mercredi",
  dimanche: "samedi",
};

/** Soir : identité d’équipe → jours où elle travaille. */
const SOIR_EQUIPE_JOURS: Partial<
  Record<GbegameyJourSlug, readonly GbegameyJourSlug[]>
> = {
  lundi: ["lundi", "mercredi"],
  mardi: ["mardi", "samedi"],
  jeudi: ["jeudi"],
  vendredi: ["vendredi"],
  dimanche: ["dimanche"],
};

/** Nuit : tous les jours sauf mardi (fermeture 00h–08h). */
const NUITS_OUVERTES: readonly GbegameyJourSlug[] = [
  "lundi",
  "mercredi",
  "jeudi",
  "vendredi",
  "samedi",
  "dimanche",
];

function joursMatinPourEquipe(
  equipeJour: GbegameyJourSlug,
): GbegameyJourSlug[] {
  return (Object.keys(MATIN_JOUR_VERS_EQUIPE) as GbegameyJourSlug[]).filter(
    (jour) => MATIN_JOUR_VERS_EQUIPE[jour] === equipeJour,
  );
}

const MATIN_EQUIPE_ORDER: readonly GbegameyJourSlug[] = [
  "lundi",
  "mardi",
  "mercredi",
  "jeudi",
  "vendredi",
  "samedi",
  "dimanche",
];

const SOIR_EQUIPE_ORDER: readonly GbegameyJourSlug[] = [
  "lundi",
  "mardi",
  "jeudi",
  "vendredi",
  "dimanche",
];

function buildComptes(): GbegameyPlanningCompte[] {
  const out: GbegameyPlanningCompte[] = [];
  let n = 13;

  const nuitMeta = PERIODE_META.nuit;
  out.push({
    numero: n,
    username: `equipe${n}`,
    name: "Équipe Nuit",
    periode: "nuit",
    equipeJour: "nuit",
    joursAutorises: NUITS_OUVERTES,
    shift: nuitMeta.shift,
    horaire: nuitMeta.horaire,
  });
  n += 1;

  for (const equipeJour of MATIN_EQUIPE_ORDER) {
    const meta = PERIODE_META.matin;
    const jours = joursMatinPourEquipe(equipeJour);
    out.push({
      numero: n,
      username: `equipe${n}`,
      name: `Équipe Matin ${capitalize(equipeJour)}`,
      periode: "matin",
      equipeJour,
      joursAutorises: jours,
      shift: meta.shift,
      horaire: meta.horaire,
    });
    n += 1;
  }

  for (const equipeJour of SOIR_EQUIPE_ORDER) {
    const meta = PERIODE_META.soir;
    const jours = SOIR_EQUIPE_JOURS[equipeJour] ?? [];
    out.push({
      numero: n,
      username: `equipe${n}`,
      name: `Équipe Soir ${capitalize(equipeJour)}`,
      periode: "soir",
      equipeJour,
      joursAutorises: jours,
      shift: meta.shift,
      horaire: meta.horaire,
    });
    n += 1;
  }

  return out;
}

function capitalize(slug: string): string {
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

export const GBEGAMEY_PLANNING_COMPTES: readonly GbegameyPlanningCompte[] =
  buildComptes();

/** Usernames Gbégamey encore valides (13 comptes). */
export const GBEGAMEY_PLANNING_USERNAMES: readonly string[] =
  GBEGAMEY_PLANNING_COMPTES.map((c) => c.username);

/** Anciens comptes Gbégamey à supprimer définitivement. */
export const GBEGAMEY_OBSOLETE_USERNAMES: readonly string[] = [
  "equipe26",
  "equipe27",
  "equipe28",
  "equipe29",
  "equipe30",
  "equipe31",
  "equipe32",
];

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

export function isWithinGbegameyPeriode(
  periode: GbegameyPeriode,
  now = new Date(),
): boolean {
  return isWithinEquipePeriodeWithGrace(periode, now);
}

export function isGbegameyPlanningActive(
  serviceDate: string,
  startIso = GBEGAMEY_PLANNING_START_ISO,
): boolean {
  return serviceDate >= startIso;
}

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

  const now = input.now ?? new Date();
  let jourDate = input.serviceDate;
  if (compte.periode === "soir" && isSoirGraceAfterMidnight(now)) {
    jourDate = previousIsoDate(input.serviceDate) ?? input.serviceDate;
  }
  const jour = jourSlugFromIsoDate(jourDate);

  if (compte.periode === "nuit" && jour === "mardi") {
    throw new Error(
      "Vente refusée : Gbégamey est fermé le mardi de 00h00 à 08h00.",
    );
  }

  // 00h–08h strict (hors marge soir 00h–00h15) : seule l’équipe nuit.
  const m = minutesInBusinessTz(now);
  const exclusiveNuit =
    m >= EQUIPE_GRACE_MINUTES && isWithinEquipePeriodeStrict("nuit", now);
  if (exclusiveNuit && compte.periode !== "nuit") {
    throw new Error(
      "Vente refusée : de 00h00 à 08h00, seule l’Équipe Nuit peut enregistrer des ventes.",
    );
  }

  if (!compte.joursAutorises.includes(jour)) {
    const jours = compte.joursAutorises.join(", ");
    throw new Error(
      `Vente refusée : ${compte.name} n’est pas de service le ${jour} (jours : ${jours}).`,
    );
  }

  if (!isWithinGbegameyPeriode(compte.periode, now)) {
    throw new Error(
      `Vente refusée : hors créneau ${compte.periode} (${compte.horaire}, marge +${EQUIPE_GRACE_MINUTES} min). Connectez le compte de la période en cours.`,
    );
  }
}

export function currentServiceDate(now = new Date()): string {
  return todayIsoDate(now);
}
