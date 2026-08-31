/**
 * Traçabilité des connexions : présence live + journal d’événements.
 * Destiné à l’admin (suivi temps réel).
 */
import { ObjectId } from "mongodb";
import type { SessionUser, UserRole, UserSite, UserShift } from "@/lib/auth-types";
import { getDb } from "@/lib/mongodb";
import {
  CONNEXION_STALE_MS,
  type ConnexionEvent,
  type ConnexionEventType,
  type ConnexionSession,
} from "@/lib/connexions-types";

export type {
  ConnexionEvent,
  ConnexionEventType,
  ConnexionSession,
} from "@/lib/connexions-types";
export {
  CONNEXION_STALE_MS,
  connexionEventLabel,
} from "@/lib/connexions-types";

type EventDoc = Omit<ConnexionEvent, "id"> & { _id: ObjectId };
type SessionDoc = Omit<ConnexionSession, "id"> & { _id: ObjectId };

function toEvent(doc: EventDoc): ConnexionEvent {
  return {
    id: doc._id.toHexString(),
    at: doc.at,
    type: doc.type,
    userId: doc.userId,
    username: doc.username,
    name: doc.name,
    role: doc.role,
    site: doc.site,
    shift: doc.shift,
    detail: doc.detail,
    ip: doc.ip,
  };
}

function toSession(doc: SessionDoc): ConnexionSession {
  return {
    id: doc._id.toHexString(),
    userId: doc.userId,
    username: doc.username,
    name: doc.name,
    role: doc.role,
    site: doc.site,
    shift: doc.shift,
    connectedAt: doc.connectedAt,
    lastSeenAt: doc.lastSeenAt,
    ip: doc.ip,
  };
}

async function appendEvent(input: {
  type: ConnexionEventType;
  username: string;
  userId?: string | null;
  name?: string | null;
  role?: UserRole | null;
  site?: UserSite | null;
  shift?: UserShift | null;
  detail: string;
  ip?: string | null;
}): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.collection<EventDoc>("connexion_events").insertOne({
    _id: new ObjectId(),
    at: now,
    type: input.type,
    userId: input.userId ?? null,
    username: input.username.trim().toLowerCase(),
    name: input.name ?? null,
    role: input.role ?? null,
    site: input.site ?? null,
    shift: input.shift ?? null,
    detail: input.detail,
    ip: input.ip ?? null,
  });
}

export async function recordLoginSuccess(input: {
  user: SessionUser & { shift?: UserShift };
  ip?: string | null;
}): Promise<void> {
  const now = new Date().toISOString();
  const db = await getDb();
  await db.collection<SessionDoc>("connexion_sessions").updateOne(
    { userId: input.user.id },
    {
      $set: {
        userId: input.user.id,
        username: input.user.username,
        name: input.user.name,
        role: input.user.role,
        site: input.user.site,
        shift: input.user.shift ?? null,
        lastSeenAt: now,
        ip: input.ip ?? null,
      },
      $setOnInsert: {
        _id: new ObjectId(),
        connectedAt: now,
      },
    },
    { upsert: true },
  );
  await appendEvent({
    type: "login",
    userId: input.user.id,
    username: input.user.username,
    name: input.user.name,
    role: input.user.role,
    site: input.user.site,
    shift: input.user.shift,
    detail: "Connexion réussie",
    ip: input.ip,
  });
}

export async function recordLoginFailure(input: {
  username: string;
  detail: string;
  ip?: string | null;
}): Promise<void> {
  await appendEvent({
    type: "echec_login",
    username: input.username,
    detail: input.detail,
    ip: input.ip,
  });
}

export async function recordRefuseHoraire(input: {
  user: Pick<SessionUser, "id" | "username" | "name" | "role" | "site" | "shift">;
  detail: string;
  ip?: string | null;
}): Promise<void> {
  await appendEvent({
    type: "refuse_horaire",
    userId: input.user.id,
    username: input.user.username,
    name: input.user.name,
    role: input.user.role,
    site: input.user.site,
    shift: input.user.shift,
    detail: input.detail,
    ip: input.ip,
  });
}

export async function touchConnexionSession(input: {
  user: SessionUser;
  ip?: string | null;
}): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.collection("connexion_sessions").updateOne(
    { userId: input.user.id },
    {
      $set: {
        username: input.user.username,
        name: input.user.name,
        role: input.user.role,
        site: input.user.site,
        shift: input.user.shift ?? null,
        lastSeenAt: now,
        ...(input.ip ? { ip: input.ip } : {}),
      },
      $setOnInsert: {
        _id: new ObjectId(),
        userId: input.user.id,
        connectedAt: now,
        ip: input.ip ?? null,
      },
    },
    { upsert: true },
  );
}

export async function endConnexionSession(input: {
  userId: string;
  username: string;
  name?: string | null;
  role?: UserRole | null;
  site?: UserSite | null;
  shift?: UserShift | null;
  reason: "logout" | "session_coupee";
  detail: string;
  ip?: string | null;
}): Promise<void> {
  const db = await getDb();
  const removed = await db
    .collection("connexion_sessions")
    .deleteOne({ userId: input.userId });
  // Hors créneau : un seul événement (quand la présence disparaît), pas à
  // chaque requête API tant que le cookie JWT est encore là.
  if (input.reason === "session_coupee" && removed.deletedCount === 0) {
    return;
  }
  await appendEvent({
    type: input.reason === "logout" ? "logout" : "session_coupee",
    userId: input.userId,
    username: input.username,
    name: input.name,
    role: input.role,
    site: input.site,
    shift: input.shift,
    detail: input.detail,
    ip: input.ip,
  });
}

export async function listActiveConnexions(
  now = new Date(),
): Promise<ConnexionSession[]> {
  const db = await getDb();
  const since = new Date(now.getTime() - CONNEXION_STALE_MS).toISOString();
  const docs = await db
    .collection<SessionDoc>("connexion_sessions")
    .find({ lastSeenAt: { $gte: since } })
    .sort({ lastSeenAt: -1 })
    .limit(200)
    .toArray();
  return docs.map(toSession);
}

export async function listConnexionEvents(limit = 80): Promise<ConnexionEvent[]> {
  const db = await getDb();
  const docs = await db
    .collection<EventDoc>("connexion_events")
    .find({})
    .sort({ at: -1 })
    .limit(limit)
    .toArray();
  return docs.map(toEvent);
}

export async function getConnexionsBoard(): Promise<{
  active: ConnexionSession[];
  events: ConnexionEvent[];
  serverTime: string;
  staleAfterSeconds: number;
}> {
  const [active, events] = await Promise.all([
    listActiveConnexions(),
    listConnexionEvents(100),
  ]);
  return {
    active,
    events,
    serverTime: new Date().toISOString(),
    staleAfterSeconds: Math.round(CONNEXION_STALE_MS / 1000),
  };
}
