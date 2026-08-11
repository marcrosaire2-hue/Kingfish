import { NextResponse } from "next/server";
import type { SessionUser } from "@/lib/auth-types";
import { effectiveSite } from "@/lib/auth-types";
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

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "admin") {
    throw new AuthError("Accès administrateur requis", 403);
  }
  return user;
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
