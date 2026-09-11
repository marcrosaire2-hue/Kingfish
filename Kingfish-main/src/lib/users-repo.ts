import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import {
  assertValidRoleSite,
  effectiveShift,
  isExecutiveAdminAccount,
  isShift,
  type AppUser,
  type UserRole,
  type UserShift,
  type UserSite,
} from "@/lib/auth-types";
import { shouldRevokeSessions } from "@/lib/security-policy";

type UserDoc = {
  _id: ObjectId;
  username: string;
  name: string;
  passwordHash: string;
  role: UserRole;
  site: UserSite;
  shift?: UserShift;
  active: boolean;
  /**
   * Incrémentée à chaque changement de mot de passe ou désactivation :
   * les sessions JWT émises avant portent l'ancienne version et sont
   * refusées par getSessionUser (voir auth-token.ts).
   */
  tokenVersion?: number;
  createdAt: string;
  updatedAt: string;
};

/**
 * Coût bcrypt : 10 était le plancher historique ; 12 multiplie par ~4 le
 * coût d'une attaque hors ligne si la base fuit. ~250 ms par hachage sur le
 * matériel du site — invisible pour un login humain.
 */
const BCRYPT_COST = 12;

/** Longueur minimale d'un mot de passe, création comme modification. */
export const MIN_PASSWORD_LENGTH = 8;

const DEFAULT_ADMIN = {
  username: "admin",
  name: "Administrateur",
  role: "admin" as const,
  site: "tous" as const,
};

/**
 * Génère un mot de passe lisible mais imprévisible (pas de mot de passe fixe
 * en clair dans le code source — ce dépôt est public sur GitHub). Affiché une
 * seule fois dans les logs serveur au premier démarrage ; à changer aussitôt
 * via Réglages, comme n'importe quel autre compte.
 */
function generateBootstrapPassword(): string {
  return randomBytes(12).toString("base64url");
}

function toAppUser(doc: UserDoc): AppUser {
  return {
    id: doc._id.toHexString(),
    username: doc.username,
    name: doc.name,
    role: doc.role,
    site: doc.site,
    shift: effectiveShift(doc.shift),
    active: doc.active,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export async function ensureDefaultAdmin(): Promise<void> {
  const db = await getDb();
  const col = db.collection<UserDoc>("users");
  const count = await col.countDocuments();
  if (count > 0) return;

  const password = generateBootstrapPassword();
  const now = new Date().toISOString();
  await col.insertOne({
    _id: new ObjectId(),
    username: DEFAULT_ADMIN.username,
    name: DEFAULT_ADMIN.name,
    passwordHash: await bcrypt.hash(password, BCRYPT_COST),
    role: DEFAULT_ADMIN.role,
    site: DEFAULT_ADMIN.site,
    shift: "aucune",
    active: true,
    tokenVersion: 1,
    createdAt: now,
    updatedAt: now,
  });
  const dir = path.join(process.cwd(), "data");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, "bootstrap-admin-once.txt");
  await writeFile(
    file,
    `username=${DEFAULT_ADMIN.username}\npassword=${password}\ncreatedAt=${now}\n`,
    { mode: 0o600 },
  );
  console.log(
    `[bootstrap] Compte admin créé (identifiant "${DEFAULT_ADMIN.username}"). Mot de passe initial écrit dans ${file} — à changer immédiatement via Réglages.`,
  );
}

export async function authenticateUser(
  username: string,
  password: string,
): Promise<(AppUser & { tokenVersion: number }) | null> {
  await ensureDefaultAdmin();
  const db = await getDb();
  const doc = await db.collection<UserDoc>("users").findOne({
    username: normalizeUsername(username),
  });
  if (!doc || !doc.active) return null;
  const ok = await bcrypt.compare(password, doc.passwordHash);
  if (!ok) return null;
  return { ...toAppUser(doc), tokenVersion: doc.tokenVersion ?? 1 };
}

export async function listUsers(): Promise<AppUser[]> {
  await ensureDefaultAdmin();
  const db = await getDb();
  const docs = await db
    .collection<UserDoc>("users")
    .find({})
    .sort({ createdAt: 1 })
    .toArray();
  return docs.map(toAppUser);
}

export async function getUserById(id: string): Promise<AppUser | null> {
  if (!ObjectId.isValid(id)) return null;
  const db = await getDb();
  const doc = await db.collection<UserDoc>("users").findOne({
    _id: new ObjectId(id),
  });
  return doc ? toAppUser(doc) : null;
}

/**
 * Recharge l'utilisateur depuis la base pour valider une session : compte
 * toujours actif et version de token à jour. C'est ce qui permet la
 * révocation immédiate (changement de mot de passe, désactivation) et fait
 * prendre en compte un changement de rôle/site sans attendre l'expiration
 * du JWT.
 */
export async function getSessionAuthState(
  id: string,
): Promise<{ user: AppUser; tokenVersion: number } | null> {
  if (!ObjectId.isValid(id)) return null;
  const db = await getDb();
  const doc = await db.collection<UserDoc>("users").findOne({
    _id: new ObjectId(id),
  });
  if (!doc || !doc.active) return null;
  return { user: toAppUser(doc), tokenVersion: doc.tokenVersion ?? 1 };
}

export async function createUser(input: {
  username: string;
  name: string;
  password: string;
  role: UserRole;
  site: UserSite;
  shift?: UserShift;
}): Promise<AppUser> {
  const username = normalizeUsername(input.username);
  if (!username || username.length < 3) {
    throw new Error("Identifiant trop court (min. 3 caractères).");
  }
  if (!input.password || input.password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `Mot de passe trop court (min. ${MIN_PASSWORD_LENGTH} caractères).`,
    );
  }
  if (!input.name.trim()) throw new Error("Le nom est requis.");
  assertValidRoleSite(input.role, input.site);

  const db = await getDb();
  const col = db.collection<UserDoc>("users");
  const existing = await col.findOne({ username });
  if (existing) throw new Error("Cet identifiant existe déjà.");

  const now = new Date().toISOString();
  const doc: UserDoc = {
    _id: new ObjectId(),
    username,
    name: input.name.trim(),
    passwordHash: await bcrypt.hash(input.password, BCRYPT_COST),
    role: input.role,
    site: input.site,
    shift: effectiveShift(input.shift),
    active: true,
    tokenVersion: 1,
    createdAt: now,
    updatedAt: now,
  };
  await col.insertOne(doc);
  return toAppUser(doc);
}

export type BulkUserInput = {
  username: string;
  name: string;
  password: string;
  role: UserRole;
  site: UserSite;
  shift?: UserShift;
};

export async function createUsersBulk(inputs: BulkUserInput[]): Promise<{
  created: AppUser[];
  errors: { index: number; username: string; error: string }[];
}> {
  const created: AppUser[] = [];
  const errors: { index: number; username: string; error: string }[] = [];

  for (let i = 0; i < inputs.length; i++) {
    const row = inputs[i]!;
    try {
      const user = await createUser(row);
      created.push(user);
    } catch (e) {
      errors.push({
        index: i,
        username: row.username || `ligne ${i + 1}`,
        error: e instanceof Error ? e.message : "Création impossible",
      });
    }
  }

  return { created, errors };
}

export async function updateUser(
  id: string,
  input: {
    name?: string;
    role?: UserRole;
    site?: UserSite;
    shift?: UserShift;
    active?: boolean;
    password?: string;
  },
): Promise<AppUser> {
  const db = await getDb();
  const col = db.collection<UserDoc>("users");
  const _id = new ObjectId(id);
  const existing = await col.findOne({ _id });
  if (!existing) throw new Error("Utilisateur introuvable.");

  const nextRole = input.role ?? existing.role;
  const nextSite = input.site ?? existing.site;
  if (input.role !== undefined || input.site !== undefined) {
    assertValidRoleSite(nextRole, nextSite);
  }

  // Révocation : mot de passe, rôle, site, équipe ou activation.
  const revokeSessions = shouldRevokeSessions({
    roleChanged:
      input.role !== undefined && input.role !== existing.role,
    siteChanged:
      input.site !== undefined && input.site !== existing.site,
    shiftChanged:
      input.shift !== undefined && input.shift !== existing.shift,
    activeChanged:
      input.active !== undefined && input.active !== existing.active,
    passwordChanged: Boolean(input.password),
  });
  const updatedAt = new Date().toISOString();
  const $set: Partial<UserDoc> = { updatedAt };

  if (input.name !== undefined) {
    if (!input.name.trim()) throw new Error("Le nom est requis.");
    $set.name = input.name.trim();
  }
  if (input.role !== undefined) $set.role = input.role;
  if (input.site !== undefined) $set.site = input.site;
  if (input.shift !== undefined) {
    if (!isShift(input.shift)) throw new Error("Équipe invalide.");
    $set.shift = input.shift;
  }
  if (input.active !== undefined) {
    if (
      existing.role === "admin" &&
      input.active === false &&
      existing.username === "admin"
    ) {
      throw new Error("Impossible de désactiver le compte admin principal.");
    }
    $set.active = input.active;
  }
  if (input.password) {
    if (input.password.length < MIN_PASSWORD_LENGTH) {
      throw new Error(
        `Mot de passe trop court (min. ${MIN_PASSWORD_LENGTH} caractères).`,
      );
    }
    $set.passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);
  }

  await col.updateOne(
    { _id },
    revokeSessions
      ? { $set, $inc: { tokenVersion: 1 } }
      : { $set },
  );
  const doc = await col.findOne({ _id });
  if (!doc) throw new Error("Utilisateur introuvable.");
  return toAppUser(doc);
}

/**
 * Changement de mot de passe par l’utilisateur lui-même : l’ancien mot de
 * passe est exigé, pour qu’une session laissée ouverte sur un téléphone posé
 * en salle ne suffise pas à confisquer un compte.
 */
export async function changeOwnPassword(input: {
  id: string;
  currentPassword: string;
  newPassword: string;
}): Promise<void> {
  if (!ObjectId.isValid(input.id)) {
    throw new Error("Utilisateur introuvable.");
  }
  if (input.newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `Le nouveau mot de passe doit faire au moins ${MIN_PASSWORD_LENGTH} caractères.`,
    );
  }
  if (input.newPassword === input.currentPassword) {
    throw new Error("Le nouveau mot de passe doit être différent de l’ancien.");
  }

  const db = await getDb();
  const col = db.collection<UserDoc>("users");
  const _id = new ObjectId(input.id);
  const doc = await col.findOne({ _id });
  if (!doc || !doc.active) throw new Error("Utilisateur introuvable.");

  const ok = await bcrypt.compare(input.currentPassword, doc.passwordHash);
  if (!ok) throw new Error("Mot de passe actuel incorrect.");

  await col.updateOne(
    { _id },
    {
      $set: {
        passwordHash: await bcrypt.hash(input.newPassword, BCRYPT_COST),
        updatedAt: new Date().toISOString(),
      },
      // Toutes les autres sessions de cet utilisateur (autre téléphone,
      // autre poste) deviennent invalides immédiatement.
      $inc: { tokenVersion: 1 },
    },
  );
}

export async function deleteUser(
  id: string,
  options?: { actorUsername?: string },
): Promise<void> {
  const db = await getDb();
  const col = db.collection<UserDoc>("users");
  const _id = new ObjectId(id);
  const existing = await col.findOne({ _id });
  if (!existing) throw new Error("Utilisateur introuvable.");
  if (
    existing.username === "admin" &&
    !isExecutiveAdminAccount(options?.actorUsername)
  ) {
    throw new Error("Impossible de supprimer le compte admin principal.");
  }
  await col.deleteOne({ _id });
}
