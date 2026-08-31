import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionTokenWithVersion } from "@/lib/auth-token";
import { clientIpFrom } from "@/lib/login-throttle";
import { endConnexionSession } from "@/lib/connexions-repo";
import { logActivity } from "@/lib/log-activity";
import { SESSION_COOKIE } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  const ip = clientIpFrom(request);

  if (token) {
    const verified = await verifySessionTokenWithVersion(token).catch(() => null);
    if (verified?.user) {
      const u = verified.user;
      await endConnexionSession({
        userId: u.id,
        username: u.username,
        name: u.name,
        role: u.role,
        site: u.site,
        shift: u.shift,
        reason: "logout",
        detail: "Déconnexion volontaire",
        ip,
      }).catch(() => undefined);
      await logActivity({
        user: u,
        kind: "connexion",
        title: "Déconnexion",
        detail: `IP ${ip ?? "inconnue"}`,
        site: u.site === "tous" ? "tous" : u.site,
      }).catch(() => undefined);
    }
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}
