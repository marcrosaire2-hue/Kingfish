import { NextResponse } from "next/server";
import { AuthError, authErrorResponse, requireUser } from "@/lib/api-auth";
import { logActivity } from "@/lib/log-activity";
import {
  checkLoginAllowed,
  clientIpFrom,
  registerFailedLogin,
} from "@/lib/login-throttle";
import { changeOwnPassword } from "@/lib/users-repo";

export const runtime = "nodejs";

/** Changement de mot de passe par l’utilisateur connecté, pour son seul compte. */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = (await request.json()) as {
      currentPassword?: string;
      newPassword?: string;
    };

    if (!body.currentPassword || !body.newPassword) {
      return NextResponse.json(
        { error: "Mot de passe actuel et nouveau mot de passe requis." },
        { status: 400 },
      );
    }

    // Même compteur que la connexion : un mot de passe actuel essayé en
    // boucle (session volée) finit verrouillé, sans compter sur la seule
    // lenteur de bcrypt.
    const ip = clientIpFrom(request);
    const throttle = await checkLoginAllowed(user.username, ip);
    if (throttle.blocked) {
      return NextResponse.json(
        {
          error: "Trop de tentatives. Réessayez dans quelques minutes.",
        },
        { status: 429 },
      );
    }

    try {
      await changeOwnPassword({
        id: user.id,
        currentPassword: body.currentPassword,
        newPassword: body.newPassword,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Changement impossible.";
      if (message.includes("actuel")) {
        await registerFailedLogin(user.username, ip);
      }
      throw error;
    }

    await logActivity({
      user,
      kind: "user",
      title: "Mot de passe modifié",
      detail: user.username,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthError) return authErrorResponse(error);
    const message =
      error instanceof Error ? error.message : "Changement impossible.";
    // Erreurs de saisie (mot de passe actuel faux, trop court) : 400, pas 500.
    return NextResponse.json({ error: message }, { status: 400 });
  }
}