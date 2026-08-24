import {
  canUseSite,
  hasDirectionAccess,
  type UserRole,
  type UserSite,
} from "@/lib/auth-types";
import type { VenteSite } from "@/lib/types";

/** Purge / suppression physique de faits financiers : admin uniquement. */
export function canPurgeFinancialData(role: UserRole): boolean {
  return role === "admin";
}

/**
 * Correction d'une journée ou caisse déjà clôturée.
 * Interdit au gérant et au comptable — pas un simple alias de canManagePastVentes.
 */
export function canCorrectClosedFinancialData(role: UserRole): boolean {
  return hasDirectionAccess(role);
}

export function isValidAuditReason(reason: unknown): reason is string {
  return (
    typeof reason === "string" &&
    reason.trim().length >= 8 &&
    reason.trim().length <= 500
  );
}

export type SiteAuthResult =
  | { ok: true; site: VenteSite }
  | { ok: false; status: 400 | 403; error: string };

/**
 * Autorise un site demandé par le client.
 * Un objet Mongo (`$ne`, …) ou un site hors périmètre est rejeté.
 * Si le site est omis, un compte rattaché à une zone reste sur sa zone.
 */
export function authorizeRequestedSite(
  userSite: UserSite,
  requested: unknown,
): SiteAuthResult {
  if (requested === undefined || requested === null || requested === "") {
    if (userSite === "zogbo" || userSite === "gbegamey") {
      return { ok: true, site: userSite };
    }
    return { ok: true, site: "zogbo" };
  }
  if (typeof requested !== "string") {
    return { ok: false, status: 400, error: "Site invalide." };
  }
  if (requested !== "zogbo" && requested !== "gbegamey") {
    return { ok: false, status: 400, error: "Site invalide." };
  }
  if (!canUseSite(userSite, requested)) {
    return { ok: false, status: 403, error: "Site non autorisé." };
  }
  return { ok: true, site: requested };
}

export type PolicyDecision =
  | { ok: true }
  | { ok: false; status: 400 | 403; error: string };

export function authorizeDestructiveSale(input: {
  role: UserRole;
  action: "delete" | "purge";
  reason: unknown;
  confirm?: unknown;
}): PolicyDecision {
  if (!canPurgeFinancialData(input.role)) {
    return {
      ok: false,
      status: 403,
      error:
        input.action === "purge"
          ? "Purge définitive réservée à l'administrateur."
          : "Suppression définitive réservée à l'administrateur.",
    };
  }
  if (input.action === "purge" && input.confirm !== true) {
    return {
      ok: false,
      status: 400,
      error: "Confirmation explicite requise (confirm: true).",
    };
  }
  if (!isValidAuditReason(input.reason)) {
    return {
      ok: false,
      status: 400,
      error: "Motif d'audit requis (au moins 8 caractères).",
    };
  }
  return { ok: true };
}

export function authorizeClosedDayWrite(input: {
  role: UserRole;
  closedDay: boolean;
}): PolicyDecision {
  if (!input.closedDay) return { ok: true };
  if (!canCorrectClosedFinancialData(input.role)) {
    return {
      ok: false,
      status: 403,
      error:
        "Journée clôturée : correction réservée à la direction (DAF / admin).",
    };
  }
  return { ok: true };
}

export function shouldRevokeSessions(input: {
  roleChanged: boolean;
  siteChanged: boolean;
  shiftChanged: boolean;
  activeChanged: boolean;
  passwordChanged: boolean;
}): boolean {
  return (
    input.roleChanged ||
    input.siteChanged ||
    input.shiftChanged ||
    input.activeChanged ||
    input.passwordChanged
  );
}

export function containsMongoOperator(
  value: unknown,
  depth = 0,
): boolean {
  if (depth > 8 || value === null || value === undefined) return false;
  if (Array.isArray(value)) {
    return value.some((v) => containsMongoOperator(v, depth + 1));
  }
  if (typeof value === "object") {
    for (const [key, nested] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (key.startsWith("$")) return true;
      if (containsMongoOperator(nested, depth + 1)) return true;
    }
  }
  return false;
}

const PROTECTED_VENTE_FIELDS = [
  "costPrice",
  "cancelledAt",
  "caExcluded",
  "cmv",
  "unitCost",
  "acquisitionAmount",
  "actorId",
  "tokenVersion",
] as const;

export function hasProtectedMassAssignment(
  body: Record<string, unknown>,
): boolean {
  return PROTECTED_VENTE_FIELDS.some((field) => field in body);
}

export function parseFiniteAmount(
  value: unknown,
  opts?: { min?: number; max?: number },
): number | null {
  if (typeof value === "boolean" || value === null || value === undefined) {
    return null;
  }
  if (typeof value === "object") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  const min = opts?.min ?? 0;
  const max = opts?.max ?? 1e12;
  if (n < min || n > max) return null;
  return n;
}
