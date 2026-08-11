import { NextResponse } from "next/server";
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
      // Message identique quel que soit le cas : ne pas révéler quels
      // identifiants existent.
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

    await clearLoginAttempts(body.username, ip);

    const sessionUser = {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      site: user.site,
    };
    const token = await createSessionToken(sessionUser);

    const response = NextResponse.json({
      user: sessionUser,
      home: homeForRole(user.role),
    });
    response.cookies.set(sessionCookieOptions(token));
    return response;
  } catch (error) {
    console.error("POST /api/auth/login", error);
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
    console.error("GET /api/auth/login", error);
    return NextResponse.json({ ready: false }, { status: 500 });
  }
}
