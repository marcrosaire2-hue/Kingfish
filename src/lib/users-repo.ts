import bcrypt from "bcryptjs";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import {
  assertValidRoleSite,
  effectiveShift,
  isShift,
  type AppUser,
  type UserRole,
  type UserShift,
  type UserSite,
} from "@/lib/auth-types";

type UserDoc = {
  _id: ObjectId;
  username: string;
  name: string;
  passwordHash: string;
  role: UserRole;
  site: UserSite;
  shift?: UserShift;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

const DEFAULT_ADMIN = {
  username: "admin",
  name: "Administrateur",
  password: "Admin123!",
  role: "admin" as const,
  site: "tous" as const,
};

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

  const now = new Date().toISOString();
  await col.insertOne({
    _id: new ObjectId(),
    username: DEFAULT_ADMIN.username,
    name: DEFAULT_ADMIN.name,
    passwordHash: await bcrypt.hash(DEFAULT_ADMIN.password, 10),
    role: DEFAULT_ADMIN.role,
    site: DEFAULT_ADMIN.site,
    shift: "aucune",
    active: true,
    createdAt: now,
    updatedAt: now,
  });
}

export function getDefaultAdminCredentials() {
  return {
    username: DEFAULT_ADMIN.username,
    password: DEFAULT_ADMIN.password,
  };
}

export async function authenticateUser(
  username: string,
  password: string,
): Promise<AppUser | null> {
  await ensureDefaultAdmin();
  const db = await getDb();
  const doc = await db.collection<UserDoc>("users").findOne({
    username: normalizeUsername(username),
  });
  if (!doc || !doc.active) return null;
  const ok = await bcrypt.compare(password, doc.passwordHash);
  if (!ok) return null;
  return toAppUser(doc);
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
  if (!input.password || input.password.length < 6) {
    throw new Error("Mot de passe trop court (min. 6 caractères).");
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
    passwordHash: await bcrypt.hash(input.password, 10),
    role: input.role,
    site: input.site,
    shift: effectiveShift(input.shift),
    active: true,
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
    if (input.password.length < 6) {
      throw new Error("Mot de passe trop court (min. 6 caractères).");
    }
    $set.passwordHash = await bcrypt.hash(input.password, 10);
  }

  await col.updateOne({ _id }, { $set });
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
  if (input.newPassword.length < 8) {
    throw new Error("Le nouveau mot de passe doit faire au moins 8 caractères.");
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
        passwordHash: await bcrypt.hash(input.newPassword, 10),
        updatedAt: new Date().toISOString(),
      },
    },
  );
}

export async function deleteUser(id: string): Promise<void> {
  const db = await getDb();
  const col = db.collection<UserDoc>("users");
  const _id = new ObjectId(id);
  const existing = await col.findOne({ _id });
  if (!existing) throw new Error("Utilisateur introuvable.");
  if (existing.username === "admin") {
    throw new Error("Impossible de supprimer le compte admin principal.");
  }
  await col.deleteOne({ _id });
}
