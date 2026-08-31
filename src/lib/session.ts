import { cookies } from "next/headers";
import {
  SESSION_COOKIE,
  verifySessionTokenWithVersion,
} from "@/lib/auth-token";
import type { SessionUser } from "@/lib/auth-types";
import { getPlanningAccountBlockReason } from "@/lib/equipe-planning-access";
import { endConnexionSession } from "@/lib/connexions-repo";
import { getSessionAuthState } from "@/lib/users-repo";

export {
  SESSION_COOKIE,
  createSessionToken,
  sessionCookieOptions,
} from "@/lib/auth-token";

/**
 * Valide la session contre la base, pas seulement contre la signature JWT :
 * le compte doit exister et rester actif, et la version de token du cookie
 * (`tv`) doit correspondre à celle de l'utilisateur. Un changement de mot de
 * passe ou une désactivation révoque donc toutes les sessions ouvertes.
 *
 * Comptes planning (equipe1…32) : hors créneau → session invalide.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const verified = await verifySessionTokenWithVersion(token);
  if (!verified) return null;
  const state = await getSessionAuthState(verified.user.id);
  if (!state) return null;
  if (state.tokenVersion !== verified.tv) return null;
  const u = state.user;

  const block = getPlanningAccountBlockReason(u.username);
  if (block) {
    await endConnexionSession({
      userId: u.id,
      username: u.username,
      name: u.name,
      role: u.role,
      site: u.site,
      shift: u.shift,
      reason: "session_coupee",
      detail: block,
    }).catch(() => undefined);
    return null;
  }

  return {
    id: u.id,
    username: u.username,
    name: u.name,
    role: u.role,
    site: u.site,
    shift: u.shift,
    ...(verified.user.nav && verified.user.nav.length
      ? { nav: verified.user.nav }
      : {}),
  };
}
