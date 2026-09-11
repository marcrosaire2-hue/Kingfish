import {
  isVenteActionAllowed,
  VENTE_POLICY_ACTION_LABELS,
  type SiteRolesConfig,
  type VentePolicyAction,
} from "@/lib/site-roles-model";
import type { UserRole } from "@/lib/auth-types";
import {
  isValidAuditReason,
  type PolicyDecision,
} from "@/lib/security-policy";
import type { VenteSite } from "@/lib/types";

const ACTION_ERROR: Record<VentePolicyAction, string> = {
  sell: "Enregistrement des ventes désactivé pour votre profil ou ce site.",
  modify:
    "Modification des ventes désactivée pour votre profil ou ce site.",
  delete:
    "Suppression des ventes désactivée pour votre profil ou ce site.",
  cancel:
    "Annulation réservée à l’administrateur.",
};

export function authorizeVenteAction(input: {
  config: SiteRolesConfig;
  role: UserRole;
  site: VenteSite;
  action: VentePolicyAction;
}): PolicyDecision {
  if (isVenteActionAllowed(input.config, input.role, input.site, input.action)) {
    return { ok: true };
  }
  return {
    ok: false,
    status: 403,
    error: ACTION_ERROR[input.action],
  };
}

export function authorizePermanentDelete(input: {
  config: SiteRolesConfig;
  role: UserRole;
  site: VenteSite;
  reason: unknown;
  confirm?: unknown;
  purge?: boolean;
}): PolicyDecision {
  const gate = authorizeVenteAction({
    config: input.config,
    role: input.role,
    site: input.site,
    action: "delete",
  });
  if (!gate.ok) return gate;
  if (input.purge && input.confirm !== true) {
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

export function ventePolicyLabel(action: VentePolicyAction): string {
  return VENTE_POLICY_ACTION_LABELS[action].label;
}
