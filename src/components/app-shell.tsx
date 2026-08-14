"use client";

import Link from "next/link";
import { useLinkStatus } from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  roleSiteLabel,
  type NavKey,
  type SessionUser,
} from "@/lib/auth-types";
import { APP_LOGO, APP_NAME, APP_SHORT, APP_TAGLINE } from "@/lib/brand";
import { guideSlugForPath } from "@/lib/guides";

const NAV_ITEMS: {
  href: string;
  label: string;
  key: NavKey;
  mark: string;
  group: "home" | "ops" | "pilot" | "admin";
  groupLabel?: string;
}[] = [
  {
    href: "/",
    label: "Tableau de bord",
    key: "synthese",
    mark: "S",
    group: "home",
    groupLabel: "Accueil",
  },
  {
    href: "/compte-resultat",
    label: "Compte de résultat",
    key: "compte-resultat",
    mark: "€",
    group: "home",
  },
  {
    href: "/vente",
    label: "Vente",
    key: "vente",
    mark: "V",
    group: "ops",
    groupLabel: "Quotidien",
  },
  { href: "/zogbo", label: "Zogbo", key: "zogbo", mark: "Z", group: "ops" },
  {
    href: "/gbegamey",
    label: "Gbégamey",
    key: "gbegamey",
    mark: "G",
    group: "ops",
  },
  {
    href: "/appro",
    label: "Achats",
    key: "appro",
    mark: "A",
    group: "ops",
  },
  {
    href: "/pertes",
    label: "Pertes",
    key: "pertes",
    mark: "P",
    group: "ops",
  },
  {
    href: "/historique-ventes",
    label: "Historique ventes",
    key: "historique-ventes",
    mark: "H",
    group: "pilot",
    groupLabel: "Pilotage",
  },
  {
    href: "/equipes",
    label: "Équipes",
    key: "equipes",
    mark: "E",
    group: "pilot",
  },
  {
    href: "/controle",
    label: "Contrôle",
    key: "controle",
    mark: "K",
    group: "pilot",
  },
  {
    href: "/stock",
    label: "Stock",
    key: "stock",
    mark: "S",
    group: "pilot",
  },
  {
    href: "/historique",
    label: "Registre",
    key: "historique",
    mark: "R",
    group: "pilot",
  },
  {
    href: "/parametres",
    label: "Paramètres",
    key: "parametres",
    mark: "P",
    group: "pilot",
  },
  {
    href: "/reglages",
    label: "Réglages POS",
    key: "reglages",
    mark: "T",
    group: "pilot",
  },
  {
    href: "/reprise",
    label: "Reprise historique",
    key: "reprise",
    mark: "←",
    group: "pilot",
  },
  {
    href: "/pilotage-global",
    label: "Pilotage global",
    key: "pilotage-global",
    mark: "◎",
    group: "pilot",
  },
  { href: "/guide", label: "Guides", key: "guide", mark: "?", group: "pilot" },
  {
    href: "/admin",
    label: "Admin",
    key: "admin",
    mark: "A",
    group: "admin",
    groupLabel: "Compte",
  },
];

/**
 * Repère d'attente sur le lien cliqué. `useLinkStatus` doit vivre dans un
 * descendant du `Link` : l'élément est toujours rendu, à taille fixe, et
 * seule son opacité change — sinon le menu se décalerait à chaque clic.
 */
function NavPending() {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden
      className={`nav-pending${pending ? " is-pending" : ""}`}
    />
  );
}

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({
  children,
  title,
  subtitle,
  actions,
  mainClassName,
}: {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  /** Classe optionnelle sur la zone principale (ex. fond de page) */
  mainClassName?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [nav, setNav] = useState<NavKey[] | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const spaceGuideHref = useMemo(() => {
    const slug = guideSlugForPath(pathname);
    return `/guide/${slug}`;
  }, [pathname]);

  const onGuideArea = pathname.startsWith("/guide");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        if (!res.ok) return;
        const body = await res.json();
        if (!cancelled) {
          setUser(body.user as SessionUser);
          setNav(body.nav as NavKey[]);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const root = document.documentElement;
    root.classList.add("nav-open");
    return () => {
      root.classList.remove("nav-open");
    };
  }, [menuOpen]);

  const links = useMemo(() => {
    if (!nav) return NAV_ITEMS;
    return NAV_ITEMS.filter((item) => nav.includes(item.key));
  }, [nav]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  const initials = user?.name
    ? user.name
        .split(/\s+/)
        .slice(0, 2)
        .map((p) => p[0]?.toUpperCase() ?? "")
        .join("")
    : "·";

  return (
    <div className={`app-shell${menuOpen ? " is-nav-open" : ""}`}>
      <aside className="sidebar" aria-label="Navigation">
        <Link href="/" className="brand brand-link sidebar-brand">
          <img
            src={APP_LOGO}
            alt={APP_NAME}
            className="brand-logo"
            width={76}
            height={76}
          />
          <span className="brand-text">
            <span className="brand-name">{APP_SHORT}</span>
            <span className="brand-tag">{APP_TAGLINE}</span>
          </span>
        </Link>

        <nav id="site-nav" className="side-nav" aria-label="Navigation principale">
          {links.map((item, index) => {
            const prev = links[index - 1];
            const showDivider = prev && prev.group !== item.group;
            const showGroupLabel = !!item.groupLabel && (!prev || prev.group !== item.group);
            return (
              <div key={item.key} className="side-nav-item-wrap">
                {showDivider ? (
                  <div className="side-nav-divider" aria-hidden />
                ) : null}
                {showGroupLabel ? (
                  <p className="side-nav-group">{item.groupLabel}</p>
                ) : null}
                <Link
                  href={item.href}
                  className={`side-nav-link${isActive(pathname, item.href) ? " is-active" : ""}`}
                >
                  <span className="side-nav-mark" aria-hidden>
                    {item.mark}
                  </span>
                  <span className="side-nav-label">{item.label}</span>
                  <NavPending />
                </Link>
              </div>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          {user ? (
            <div className="user-chip user-chip-sidebar">
              <span className="user-avatar" aria-hidden>
                {initials}
              </span>
              <span className="user-meta">
                <span className="user-name">{user.name}</span>
                <span className="user-role">
                  {roleSiteLabel(user.role, user.site)}
                </span>
              </span>
              <button type="button" className="btn-logout" onClick={logout}>
                Sortir
              </button>
            </div>
          ) : null}
        </div>
      </aside>

      <button
        type="button"
        className="sidebar-backdrop"
        aria-label="Fermer le menu"
        tabIndex={menuOpen ? 0 : -1}
        onClick={() => setMenuOpen(false)}
      />

      <div className={`main${mainClassName ? ` ${mainClassName}` : ""}`}>
        <div className="mobile-bar">
          <button
            type="button"
            className="nav-toggle"
            aria-expanded={menuOpen}
            aria-controls="site-nav"
            onClick={() => setMenuOpen((o) => !o)}
          >
            <span className="sr-only">Menu</span>
            <span className={`nav-toggle-bars${menuOpen ? " is-open" : ""}`} />
          </button>
          <Link href="/" className="mobile-bar-brand">
            <img
              src={APP_LOGO}
              alt=""
              className="brand-logo brand-logo-sm"
              width={40}
              height={40}
            />
            <span className="mobile-bar-title">{APP_NAME}</span>
          </Link>
          {user ? (
            <span className="user-avatar mobile-bar-avatar" aria-hidden>
              {initials}
            </span>
          ) : (
            <span className="mobile-bar-spacer" aria-hidden />
          )}
        </div>

        <header className="page-header">
          <div>
            <h1>{title}</h1>
            {subtitle ? <p className="page-subtitle">{subtitle}</p> : null}
          </div>
          <div className="page-actions">
            {!onGuideArea ? (
              <Link
                href={spaceGuideHref}
                className="btn btn-guide"
                title="Ouvrir le guide de cet espace"
              >
                Guide
              </Link>
            ) : null}
            {actions}
          </div>
        </header>
        <main className="page-body">{children}</main>
      </div>
    </div>
  );
}
