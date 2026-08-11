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

    const user = await authenticateUser(body.username, body.password);
    if (!user) {
      return NextResponse.json(
        { error: "Identifiant ou mot de passe incorrect." },
        { status: 401 },
      );
    }

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
