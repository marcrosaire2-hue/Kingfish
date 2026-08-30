import { NextResponse, type NextRequest } from "next/server";
import {
  canAccessPath,
  canWriteStock,
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

/**
 * Écran auquel une route d'API correspond, pour lui appliquer exactement les
 * mêmes droits. Sans cela, le contrôle des rôles ne portait que sur les pages :
 * un compte pouvait appeler directement une API que son menu ne montrait pas.
 *
 * La plupart des routes portent le nom de leur écran ; seules celles-ci en
 * diffèrent.
 */
const API_VERS_ECRAN: Record<string, string> = {
  "/api/pos": "/vente",
  "/api/pos-config": "/reglages",
};

/**
 * Données de référence lisibles par tout compte connecté : la page Appro a
 * besoin de la liste des fournisseurs, et la caisse des moyens de paiement,
 * sans pour autant donner accès aux Réglages. La vente et les pertes lisent
 * les emballages via GET /api/immobilisations, sans ouvrir l’écran registre.
 * L'écriture, elle, reste soumise aux droits de l'écran correspondant.
 */
function estLectureDeReference(pathname: string, method: string): boolean {
  return (
    method === "GET" &&
    (pathname === "/api/pos-config" || pathname === "/api/immobilisations")
  );
}

function pageEquivalent(pathname: string): string {
  for (const [prefixe, ecran] of Object.entries(API_VERS_ECRAN)) {
    if (pathname === prefixe || pathname.startsWith(`${prefixe}/`)) {
      return ecran;
    }
  }
  return pathname.replace(/^\/api/, "");
}

/** Écritures de stock (plats, QR, boissons) — DAF et comptable en lecture. */
function estEcritureDeStock(pathname: string): boolean {
  return (
    pathname === "/api/zogbo" ||
    pathname.startsWith("/api/zogbo/") ||
    pathname === "/api/gbegamey" ||
    pathname.startsWith("/api/gbegamey/") ||
    pathname === "/api/stock-zogbo" ||
    pathname.startsWith("/api/stock-zogbo/") ||
    pathname === "/api/stock-gbegamey" ||
    pathname.startsWith("/api/stock-gbegamey/") ||
    pathname.startsWith("/api/stock-units") ||
    pathname === "/api/boissons" ||
    pathname.startsWith("/api/boissons/")
  );
}

/** Politiques ventes : Équipe (/admin) ou Réglages POS. */
function peutAccederSiteRoles(
  role: Parameters<typeof canAccessPath>[0],
  site: ReturnType<typeof effectiveSite>,
  username: string,
  nav: Parameters<typeof canAccessPath>[4],
): boolean {
  return (
    canAccessPath(role, "/admin", site, username, nav) ||
    canAccessPath(role, "/reglages", site, username, nav)
  );
}

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

    // Routes disponibles à tout compte connecté : sa propre session et son
    // propre mot de passe.
    if (
      pathname.startsWith("/api/auth/") ||
      estLectureDeReference(pathname, request.method)
    ) {
      return NextResponse.next();
    }

    const site = effectiveSite(user.role, user.site);
    if (
      pathname === "/api/site-roles" ||
      pathname.startsWith("/api/site-roles/")
    ) {
      if (
        !peutAccederSiteRoles(user.role, site, user.username, user.nav)
      ) {
        return NextResponse.json(
          { error: "Accès non autorisé pour ce rôle." },
          { status: 403 },
        );
      }
      return NextResponse.next();
    }
    if (
      request.method !== "GET" &&
      request.method !== "HEAD" &&
      estEcritureDeStock(pathname) &&
      !canWriteStock(user.role)
    ) {
      return NextResponse.json(
        { error: "Consultation uniquement : saisie de stock non autorisée." },
        { status: 403 },
      );
    }
    if (
      !canAccessPath(
        user.role,
        pageEquivalent(pathname),
        site,
        user.username,
        user.nav,
      )
    ) {
      return NextResponse.json(
        { error: "Accès non autorisé pour ce rôle." },
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

  if (pathname === "/autorisations" || pathname.startsWith("/autorisations/")) {
    return NextResponse.redirect(new URL("/admin", request.url));
  }

  if (pathname === "/journal-stock" || pathname.startsWith("/journal-stock/")) {
    return NextResponse.redirect(new URL("/historique", request.url));
  }

  const site = effectiveSite(user.role, user.site);
  if (
    !canAccessPath(user.role, pathname, site, user.username, user.nav)
  ) {
    return NextResponse.redirect(new URL(homeForRole(user.role), request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|.*\\.(?:png|jpg|jpeg|gif|svg|ico)$).*)",
  ],
};
