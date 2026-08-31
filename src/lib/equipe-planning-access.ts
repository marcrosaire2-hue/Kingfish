/**
 * Accès global des comptes planning (Zogbo + Gbégamey) :
 * hors jour / créneau → compte inutilisable (pas seulement ventes).
 */
import { todayIsoDate } from "@/lib/zogbo-calc";
import {
  findZogboPlanningCompte,
  assertZogboPlanningSale,
} from "@/lib/zogbo-planning-comptes";
import {
  findGbegameyPlanningCompte,
  assertGbegameyPlanningSale,
} from "@/lib/gbegamey-planning-comptes";

export function isPlanningEquipeAccount(
  username: string | null | undefined,
): boolean {
  return Boolean(
    findZogboPlanningCompte(username) || findGbegameyPlanningCompte(username),
  );
}

/**
 * null = autorisé. Sinon message à afficher (connexion / session).
 */
export function getPlanningAccountBlockReason(
  username: string,
  now = new Date(),
): string | null {
  if (!isPlanningEquipeAccount(username)) return null;
  const serviceDate = todayIsoDate(now);
  try {
    assertZogboPlanningSale({ username, serviceDate, now });
    assertGbegameyPlanningSale({ username, serviceDate, now });
    return null;
  } catch (error) {
    if (error instanceof Error) {
      return error.message
        .replace(/^Vente refusée\s*:\s*/i, "Compte hors service : ")
        .trim();
    }
    return "Compte hors service : hors créneau du planning.";
  }
}

export function assertPlanningAccountUsable(
  username: string,
  now = new Date(),
): void {
  const reason = getPlanningAccountBlockReason(username, now);
  if (reason) throw new Error(reason);
}
