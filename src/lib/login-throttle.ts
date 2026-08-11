import { getDb } from "@/lib/mongodb";

/**
 * Limitation des tentatives de connexion.
 *
 * Compteur stocké en base plutôt qu’en mémoire : le plan gratuit Render met le
 * service en veille et le redémarre, ce qui remettrait un compteur mémoire à
 * zéro — donc n’arrêterait rien.
 *
 * La clé combine l’identifiant visé et l’IP appelante : bloquer sur le seul
 * identifiant permettrait à un attaquant de verrouiller un employé à distance
 * (déni de service), bloquer sur la seule IP pénaliserait tout un restaurant
 * derrière la même connexion.
 */

/** Verrouillage déclenché dès le 5e échec (4 essais passent librement). */
const FAILURES_BEFORE_LOCK = 5;
const BASE_LOCK_SECONDS = 60;
const MAX_LOCK_SECONDS = 15 * 60;
/** Fenêtre au-delà de laquelle un échec isolé est oublié. */
const WINDOW_SECONDS = 15 * 60;

type AttemptDoc = {
  _id: string;
  failures: number;
  firstFailureAt: Date;
  lastFailureAt: Date;
  lockedUntil: Date | null;
  /** Champ TTL : MongoDB purge le document tout seul. */
  expiresAt: Date;
};

function keyFor(username: string, ip: string): string {
  return `${username.trim().toLowerCase()}|${ip}`;
}

/** IP de l’appelant derrière le proxy Render (x-forwarded-for : client, proxy…). */
export function clientIpFrom(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "inconnue";
}

async function collection() {
  const db = await getDb();
  const col = db.collection<AttemptDoc>("login_attempts");
  // Idempotent : Mongo ignore la création si l’index existe déjà.
  await col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  return col;
}

function lockSecondsFor(failures: number): number {
  const over = failures - FAILURES_BEFORE_LOCK;
  if (over < 0) return 0;
  return Math.min(MAX_LOCK_SECONDS, BASE_LOCK_SECONDS * 2 ** over);
}

export type ThrottleState = {
  blocked: boolean;
  /** Secondes restantes avant réouverture. */
  retryAfter: number;
};

/** À appeler avant de vérifier le mot de passe. */
export async function checkLoginAllowed(
  username: string,
  ip: string,
): Promise<ThrottleState> {
  const col = await collection();
  const doc = await col.findOne({ _id: keyFor(username, ip) });
  if (!doc?.lockedUntil) return { blocked: false, retryAfter: 0 };

  const remaining = Math.ceil((doc.lockedUntil.getTime() - Date.now()) / 1000);
  if (remaining <= 0) return { blocked: false, retryAfter: 0 };
  return { blocked: true, retryAfter: remaining };
}

/** À appeler après un échec d’authentification. */
export async function registerFailedLogin(
  username: string,
  ip: string,
): Promise<ThrottleState> {
  const col = await collection();
  const _id = keyFor(username, ip);
  const now = new Date();

  const existing = await col.findOne({ _id });
  const withinWindow =
    existing &&
    now.getTime() - existing.firstFailureAt.getTime() < WINDOW_SECONDS * 1000;

  const failures = withinWindow ? existing.failures + 1 : 1;
  const lockSeconds = lockSecondsFor(failures);
  const lockedUntil =
    lockSeconds > 0 ? new Date(now.getTime() + lockSeconds * 1000) : null;

  await col.updateOne(
    { _id },
    {
      $set: {
        failures,
        firstFailureAt: withinWindow ? existing.firstFailureAt : now,
        lastFailureAt: now,
        lockedUntil,
        expiresAt: new Date(
          now.getTime() + Math.max(WINDOW_SECONDS, lockSeconds) * 1000,
        ),
      },
    },
    { upsert: true },
  );

  return { blocked: lockSeconds > 0, retryAfter: lockSeconds };
}

/** À appeler après une connexion réussie : le compteur repart de zéro. */
export async function clearLoginAttempts(
  username: string,
  ip: string,
): Promise<void> {
  const col = await collection();
  await col.deleteOne({ _id: keyFor(username, ip) });
}
