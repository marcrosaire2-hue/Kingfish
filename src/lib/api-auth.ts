import { NextResponse } from "next/server";
import type { SessionUser } from "@/lib/auth-types";
import {
  canManageUsers,
  canWriteStock,
  effectiveSite,
  hasFinanceAccess,
} from "@/lib/auth-types";
import { reportError } from "@/lib/report-error";
import { getSessionUser } from "@/lib/session";

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) {
    throw new AuthError("Non authentifié", 401);
  }
  return {
    ...user,
    site: effectiveSite(user.role, user.site),
  };
}

/** Admin, DAF ou comptable — écrans / API financiers et de direction. */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!hasFinanceAccess(user.role)) {
    throw new AuthError("Accès administrateur requis", 403);
  }
  return user;
}

export async function requireUserManagementAdmin(): Promise<SessionUser> {
  const user = await requireAdmin();
  if (!canManageUsers(user)) {
    throw new AuthError("Gestion des comptes non autorisée pour ce profil.", 403);
  }
  return user;
}

/** Bloque toute écriture de stock pour un rôle lecteur (DAF, comptable). */
export function requireStockWrite(user: SessionUser): void {
  if (!canWriteStock(user.role)) {
    throw new AuthError(
      "Consultation uniquement : saisie de stock non autorisée.",
      403,
    );
  }
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function authErrorResponse(error: unknown) {
  if (error instanceof AuthError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.status },
    );
  }
  reportError("api", error);
  return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
}
