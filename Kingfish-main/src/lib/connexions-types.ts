import type { UserRole, UserSite, UserShift } from "@/lib/auth-types";

export type ConnexionEventType =
  | "login"
  | "logout"
  | "refuse_horaire"
  | "session_coupee"
  | "echec_login";

export type ConnexionEvent = {
  id: string;
  at: string;
  type: ConnexionEventType;
  userId: string | null;
  username: string;
  name: string | null;
  role: UserRole | null;
  site: UserSite | null;
  shift: UserShift | null;
  detail: string;
  ip: string | null;
};

export type ConnexionSession = {
  id: string;
  userId: string;
  username: string;
  name: string;
  role: UserRole;
  site: UserSite;
  shift: UserShift | null;
  connectedAt: string;
  lastSeenAt: string;
  ip: string | null;
};

const EVENT_LABELS: Record<ConnexionEventType, string> = {
  login: "Connexion",
  logout: "Déconnexion",
  refuse_horaire: "Refus hors créneau",
  session_coupee: "Session coupée (hors créneau)",
  echec_login: "Échec de connexion",
};

export function connexionEventLabel(type: ConnexionEventType): string {
  return EVENT_LABELS[type];
}

/** Au-delà de ce délai sans heartbeat, la session n’est plus « en ligne ». */
export const CONNEXION_STALE_MS = 90_000;
