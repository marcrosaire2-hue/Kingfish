import { NextResponse, type NextRequest } from "next/server";
import {
  canAccessPath,
  effectiveSite,
  homeForRole,
} from "@/lib/auth-types";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth-token";

const PUBLIC = ["/login"];

/**
 * Ressources de l'installation PWA. Le navigateur les demande sans cookie de
 * session : redirigées vers /login, l'application ne serait ni installable ni
 * capable d'enregistrer son service worker. Aucune donnée métier n'y transite.
 */
const PWA_PUBLIC = ["/manifest.webmanifest", "/sw.js"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/api/auth/login") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    PWA_PUBLIC.includes(pathname)
  ) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const user = token ? await verifySessionToken(token) : null;

  if (pathname.startsWith("/api/")) {
    if (!user) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }
    if (pathname.startsWith("/api/admin") && user.role !== "admin") {
      return NextResponse.json(
        { error: "Accès administrateur requis" },
        { status: 403 },
      );
    }
    return NextResponse.next();
  }

  if (PUBLIC.includes(pathname)) {
    if (user) {
      return NextResponse.redirect(
        new URL(homeForRole(user.role), request.url),
      );
    }
    return NextResponse.next();
  }

  if (!user) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  const site = effectiveSite(user.role, user.site);
  if (!canAccessPath(user.role, pathname, site)) {
    return NextResponse.redirect(new URL(homeForRole(user.role), request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|.*\\.(?:png|jpg|jpeg|gif|svg|ico)$).*)",
  ],
};
