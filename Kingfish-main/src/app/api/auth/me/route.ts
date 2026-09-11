import { NextResponse } from "next/server";
import { AuthError, authErrorResponse, requireUser } from "@/lib/api-auth";
import { homeForRole } from "@/lib/auth-types";
import { resolveEffectiveNav } from "@/lib/autorisations-repo";
import { clientIpFrom } from "@/lib/login-throttle";
import { touchConnexionSession } from "@/lib/connexions-repo";
import { SESSION_COOKIE } from "@/lib/session";

export const runtime = "nodejs";

function clearSessionCookie(response: NextResponse) {
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

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const nav = await resolveEffectiveNav(user);
    const ip = clientIpFrom(request);
    await touchConnexionSession({ user, ip }).catch(() => undefined);
    return NextResponse.json({
      user: { ...user, nav },
      nav,
      home: homeForRole(user.role),
      lockedSite: user.site !== "tous",
      allowedSites:
        user.site === "tous"
          ? (["zogbo", "gbegamey"] as const)
          : ([user.site] as const),
    });
  } catch (error) {
    const response = authErrorResponse(error);
    // Session soft OK mais hard KO (version, planning, compte) : effacer le
    // cookie pour couper toute boucle middleware ↔ layout.
    if (error instanceof AuthError && error.status === 401) {
      clearSessionCookie(response);
    }
    return response;
  }
}
