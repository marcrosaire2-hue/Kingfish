/**
 * Planning réel Gbégamey (comptes nominatifs) — d'après le planning
 * hebdomadaire du restaurant : 2 services, matin (8h–16h) et soir
 * (16h–minuit), binôme obligatoire (renfort à 3 le vendredi et samedi
 * soir). Chaque compte ne peut encaisser que sur son créneau planifié,
 * avec une marge de GRACE_MINUTES après la fin officielle.
 *
 * Remplace, pour les ventes, l'ancien système à comptes numérotés
 * (equipe13…equipe25 dans gbegamey-planning-comptes.ts) qui ne
 * correspond plus aux comptes réellement utilisés.
 */
import { jourSlugFromIsoDate, type GbegameyJourSlug } from "@/lib/gbegamey-planning-comptes";
import { minutesInBusinessTz } from "@/lib/equipe-horaire-marge";
import { todayIsoDate } from "@/lib/zogbo-calc";

export type GbegameyServicePeriode = "matin" | "soir";

/** Minutes accordées après la fin officielle du service avant blocage. */
export const GBEGAMEY_EMPLOYEE_GRACE_MINUTES = 30;

const PERIODE_HORAIRE: Record<GbegameyServicePeriode, string> = {
  matin: "08h00–16h00",
  soir: "16h00–00h00",
};

/** Planning hebdomadaire — un tableau { jour, service } par employé. */
const SCHEDULE: Record<GbegameyJourSlug, Record<GbegameyServicePeriode, readonly string[]>> = {
  lundi: { matin: ["gloria", "bijou"], soir: ["inès", "précilia"] },
  mardi: { matin: ["gloria", "rita"], soir: ["inès", "précilia"] },
  mercredi: { matin: ["gloria", "bijou"], soir: ["précilia", "rita"] },
  jeudi: { matin: ["gloria", "rita"], soir: ["inès", "bijou"] },
  vendredi: { matin: ["précilia", "bijou"], soir: ["gloria", "inès", "rita"] },
  samedi: { matin: ["précilia", "rita"], soir: ["gloria", "inès", "bijou"] },
  dimanche: { matin: ["précilia", "bijou"], soir: ["inès", "rita"] },
};

const EMPLOYEE_USERNAMES: readonly string[] = [
  "gloria",
  "inès",
  "précilia",
  "bijou",
  "rita",
];

export function isGbegameyPlanningEmployee(
  username: string | null | undefined,
): boolean {
  if (!username?.trim()) return false;
  return EMPLOYEE_USERNAMES.includes(username.trim().toLowerCase());
}

function previousJourSlug(jour: GbegameyJourSlug): GbegameyJourSlug {
  const order: GbegameyJourSlug[] = [
    "dimanche",
    "lundi",
    "mardi",
    "mercredi",
    "jeudi",
    "vendredi",
    "samedi",
  ];
  const i = order.indexOf(jour);
  return order[(i + order.length - 1) % order.length]!;
}

/**
 * Créneaux ouverts à l'instant `now` (avec marge), rattachés au jour de
 * planning correspondant. La marge du soir déborde sur le lendemain
 * calendaire (00h00–00h30) mais reste rattachée au jour d'hier.
 */
function openWindows(
  now: Date,
): { jour: GbegameyJourSlug; periode: GbegameyServicePeriode }[] {
  const m = minutesInBusinessTz(now);
  const today = jourSlugFromIsoDate(todayIsoDate(now));
  const windows: { jour: GbegameyJourSlug; periode: GbegameyServicePeriode }[] =
    [];

  if (m < GBEGAMEY_EMPLOYEE_GRACE_MINUTES) {
    windows.push({ jour: previousJourSlug(today), periode: "soir" });
  }
  if (m >= 8 * 60 && m < 16 * 60 + GBEGAMEY_EMPLOYEE_GRACE_MINUTES) {
    windows.push({ jour: today, periode: "matin" });
  }
  if (m >= 16 * 60) {
    windows.push({ jour: today, periode: "soir" });
  }
  return windows;
}

/**
 * Refuse la vente si le compte (nominatif Gbégamey) n'est pas planifié sur
 * le créneau en cours (marge de GBEGAMEY_EMPLOYEE_GRACE_MINUTES incluse).
 * Ne s'applique qu'aux comptes gérant du planning — les autres rôles
 * (admin, DAF, comptable) ne sont jamais concernés.
 */
export function assertGbegameyEmployeeVentePlanning(input: {
  username: string;
  now?: Date;
}): void {
  const uname = input.username.trim().toLowerCase();
  if (!isGbegameyPlanningEmployee(uname)) return;

  const now = input.now ?? new Date();
  const windows = openWindows(now);
  const scheduled = windows.some((w) =>
    SCHEDULE[w.jour][w.periode].includes(uname),
  );
  if (scheduled) return;

  const today = jourSlugFromIsoDate(todayIsoDate(now));
  const todaysSlots = (
    ["matin", "soir"] as GbegameyServicePeriode[]
  ).filter((p) => SCHEDULE[today][p].includes(uname));
  const detail = todaysSlots.length
    ? `service prévu aujourd'hui : ${todaysSlots
        .map((p) => `${p} (${PERIODE_HORAIRE[p]})`)
        .join(", ")}`
    : "pas de service prévu aujourd'hui";
  throw new Error(
    `Vente refusée : hors créneau planifié (marge +${GBEGAMEY_EMPLOYEE_GRACE_MINUTES} min après la fin du service) — ${detail}.`,
  );
}
