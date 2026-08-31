import { NextResponse } from "next/server";
import { reportError } from "@/lib/report-error";
import {
  createSessionToken,
  sessionCookieOptions,
  SESSION_COOKIE,
} from "@/lib/session";
import {
  authenticateUser,
  ensureDefaultAdmin,
} from "@/lib/users-repo";
import { homeForRole } from "@/lib/auth-types";
import {
  checkLoginAllowed,
  clearLoginAttempts,
  clientIpFrom,
  registerFailedLogin,
} from "@/lib/login-throttle";
import { getPlanningAccountBlockReason } from "@/lib/equipe-planning-access";
import {
  recordLoginFailure,
  recordLoginSuccess,
  recordRefuseHoraire,
} from "@/lib/connexions-repo";
import { logActivity } from "@/lib/log-activity";

function formatDelay(seconds: number): string {
  if (seconds < 60) return `${seconds} seconde${seconds > 1 ? "s" : ""}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes > 1 ? "s" : ""}`;
}

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    await ensureDefaultAdmin();
    const body = (await request.json()) as {
      username?: string;
      password?: string;
    };
    if (!body.username || !body.password) {
      return NextResponse.json(
        { error: "Identifiant et mot de passe requis." },
        { status: 400 },
      );
    }

    const ip = clientIpFrom(request);
    const throttle = await checkLoginAllowed(body.username, ip);
    if (throttle.blocked) {
      return NextResponse.json(
        {
          error: `Trop de tentatives. Réessayez dans ${formatDelay(throttle.retryAfter)}.`,
        },
        { status: 429, headers: { "Retry-After": String(throttle.retryAfter) } },
      );
    }

    const user = await authenticateUser(body.username, body.password);
    if (!user) {
      const failed = await registerFailedLogin(body.username, ip);
      await recordLoginFailure({
        username: body.username,
        detail: failed.blocked
          ? "Trop de tentatives (verrouillage temporaire)"
          : "Identifiant ou mot de passe incorrect",
        ip,
      });
      return NextResponse.json(
        {
          error: failed.blocked
            ? `Trop de tentatives. Réessayez dans ${formatDelay(failed.retryAfter)}.`
            : "Identifiant ou mot de passe incorrect.",
        },
        {
          status: failed.blocked ? 429 : 401,
          headers: failed.blocked
            ? { "Retry-After": String(failed.retryAfter) }
            : undefined,
        },
      );
    }

    const horaireBlock = getPlanningAccountBlockReason(user.username);
    if (horaireBlock) {
      await recordRefuseHoraire({
        user: {
          id: user.id,
          username: user.username,
          name: user.name,
          role: user.role,
          site: user.site,
          shift: user.shift,
        },
        detail: horaireBlock,
        ip,
      });
      await logActivity({
        user: {
          id: user.id,
          username: user.username,
          name: user.name,
          role: user.role,
          site: user.site,
          shift: user.shift,
        },
        kind: "connexion",
        title: "Connexion refusée (hors créneau)",
        detail: horaireBlock,
        site: user.site === "tous" ? "tous" : user.site,
      });
      return NextResponse.json({ error: horaireBlock }, { status: 403 });
    }

    await clearLoginAttempts(body.username, ip);

    const sessionUser = {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      site: user.site,
      shift: user.shift,
    };
    const { resolveEffectiveNav } = await import("@/lib/autorisations-repo");
    const nav = await resolveEffectiveNav(sessionUser);
    const token = await createSessionToken(
      { ...sessionUser, nav },
      user.tokenVersion,
    );

    await recordLoginSuccess({ user: sessionUser, ip });
    await logActivity({
      user: sessionUser,
      kind: "connexion",
      title: "Connexion",
      detail: `IP ${ip ?? "inconnue"}`,
      site: sessionUser.site === "tous" ? "tous" : sessionUser.site,
    });

    const response = NextResponse.json({
      user: sessionUser,
      home: homeForRole(user.role),
      nav,
    });
    response.cookies.set(sessionCookieOptions(token));
    return response;
  } catch (error) {
    reportError("POST /api/auth/login", error);
    return NextResponse.json(
      { error: "Connexion impossible." },
      { status: 500 },
    );
  }
}

/** Bootstrap session / seed admin — sans exposer d’identifiants */
export async function GET() {
  try {
    await ensureDefaultAdmin();
    return NextResponse.json({ ready: true });
  } catch (error) {
    reportError("GET /api/auth/login", error);
    return NextResponse.json({ ready: false }, { status: 500 });
  }
}
