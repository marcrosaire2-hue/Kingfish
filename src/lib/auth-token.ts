import { SignJWT, jwtVerify } from "jose";
import {
  effectiveShift,
  type NavKey,
  type SessionUser,
} from "@/lib/auth-types";

export const SESSION_COOKIE = "zg_session";

/**
 * Durée de session. 14 jours était long pour un téléphone partagé en salle :
 * un appareil égaré reste connecté deux semaines. Deux jours couvrent un
 * service sans reconnexion permanente ; ajustable par SESSION_DAYS sans
 * redéploiement.
 */
export const SESSION_DAYS = (() => {
  const raw = Number(process.env.SESSION_DAYS);
  if (!Number.isFinite(raw) || raw <= 0 || raw > 30) return 2;
  return raw;
})();

function getSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET manquant dans .env.local");
  }
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(
  user: SessionUser,
  tokenVersion = 1,
): Promise<string> {
  return new SignJWT({
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    site: user.site,
    shift: user.shift ?? "aucune",
    // Version de token : incrémentée en base à chaque changement de mot de
    // passe ou désactivation. Une session déjà émise devient invalide sans
    // attendre son expiration (voir verifySessionTokenWithVersion).
    tv: tokenVersion,
    // Menu effectif (autorisations) — lu par le middleware edge sans Mongo.
    ...(user.nav && user.nav.length ? { nav: user.nav } : {}),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(getSecret());
}

function extractPayload(payload: Record<string, unknown>): SessionUser | null {
  if (
    typeof payload.id !== "string" ||
    typeof payload.username !== "string" ||
    typeof payload.name !== "string" ||
    typeof payload.role !== "string" ||
    typeof payload.site !== "string"
  ) {
    return null;
  }
  const nav = Array.isArray(payload.nav)
    ? (payload.nav.filter((k) => typeof k === "string") as NavKey[])
    : undefined;
  return {
    id: payload.id,
    username: payload.username,
    name: payload.name,
    role: payload.role as SessionUser["role"],
    site: payload.site as SessionUser["site"],
    // Absent des sessions ouvertes avant l'introduction des équipes : la
    // vente sera simplement rattachée à « hors équipe ».
    shift: effectiveShift(payload.shift as SessionUser["shift"]),
    ...(nav && nav.length ? { nav } : {}),
  };
}

export async function verifySessionToken(
  token: string,
): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return extractPayload(payload as Record<string, unknown>);
  } catch {
    return null;
  }
}

/**
 * Vérifie la signature et renvoie aussi la version de token (`tv`). Le
 * middleware tourne sur l'edge runtime sans accès MongoDB et n'utilise que
 * la signature ; les routes API, elles, comparent cette version à celle de
 * l'utilisateur en base pour révoquer immédiatement une session.
 */
export async function verifySessionTokenWithVersion(
  token: string,
): Promise<{ user: SessionUser; tv: number } | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    const user = extractPayload(payload as Record<string, unknown>);
    if (!user) return null;
    const tv =
      typeof payload.tv === "number" && Number.isFinite(payload.tv)
        ? payload.tv
        : 1;
    return { user, tv };
  } catch {
    return null;
  }
}

export function sessionCookieOptions(token: string) {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  };
}
