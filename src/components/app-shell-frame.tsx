"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { roleSiteLabel, type NavKey } from "@/lib/auth-types";
import { APP_LOGO, APP_NAME, APP_SHORT, APP_TAGLINE } from "@/lib/brand";
import { usePageChrome } from "@/components/page-chrome-context";
import { clearSessionCache, useSession } from "@/components/session-provider";

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
    mark: "FCFA",
    group: "home",
  },
  {
    href: "/comptabilite",
    label: "Comptabilité",
    key: "comptabilite",
    mark: "J",
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
    label: "Approvisionnement",
    key: "appro",
    mark: "M",
    group: "ops",
  },
  {
    href: "/achats",
    label: "Achats",
    key: "appro",
    mark: "L",
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
    href: "/stock",
    label: "Stock",
    key: "stock",
    mark: "S",
    group: "ops",
  },
  {
    href: "/immobilisations",
    label: "Immobilisations",
    key: "immobilisations",
    mark: "I",
    group: "ops",
  },
  {
    href: "/journal-ventes",
    label: "Journal ventes",
    key: "journal-ventes",
    mark: "J",
    group: "pilot",
    groupLabel: "Pilotage",
  },
  {
    href: "/regularisation",
    label: "Régularisation",
    key: "regularisation",
    mark: "±",
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
    href: "/journal-stock",
    label: "Journal stock",
    key: "journal-stock",
    mark: "J",
    group: "pilot",
  },
  {
    href: "/admin",
    label: "Équipe",
    key: "admin",
    mark: "E",
    group: "admin",
    groupLabel: "Compte",
  },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShellFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, nav } = useSession();
  const { chrome, setChrome } = usePageChrome();
  const [menuOpen, setMenuOpen] = useState(false);
  const [navBusy, setNavBusy] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
    setNavBusy(true);
    setChrome({ title: "King Fish" });
    const t = window.setTimeout(() => setNavBusy(false), 450);
    return () => window.clearTimeout(t);
  }, [pathname, setChrome]);

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
    if (!nav?.length) return [];
    return NAV_ITEMS.filter((item) => nav.includes(item.key));
  }, [nav]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    clearSessionCache();
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

  const mainClass = chrome.mainClassName ? ` ${chrome.mainClassName}` : "";

  return (
    <div className={`app-shell${menuOpen ? " is-nav-open" : ""}`}>
      <aside className="sidebar" aria-label="Navigation">
        <Link href="/" className="brand brand-link sidebar-brand" prefetch>
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
            const showGroupLabel =
              !!item.groupLabel && (!prev || prev.group !== item.group);
            return (
              <div key={item.href} className="side-nav-item-wrap">
                {showDivider ? (
                  <div className="side-nav-divider" aria-hidden />
                ) : null}
                {showGroupLabel ? (
                  <p className="side-nav-group">{item.groupLabel}</p>
                ) : null}
                <Link
                  href={item.href}
                  prefetch
                  className={`side-nav-link${isActive(pathname, item.href) ? " is-active" : ""}`}
                >
                  <span className="side-nav-mark" aria-hidden>
                    {item.mark}
                  </span>
                  <span className="side-nav-label">{item.label}</span>
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

      <div className={`main${mainClass}`}>
        <div
          className={`page-nav-progress${navBusy ? " is-active" : ""}`}
          aria-hidden
        />

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
          <Link href="/" className="mobile-bar-brand" prefetch>
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
            <h1>{chrome.title}</h1>
            {chrome.subtitle ? (
              <p className="page-subtitle">{chrome.subtitle}</p>
            ) : null}
          </div>
          <div className="page-actions">{chrome.actions}</div>
        </header>

        <main className={`page-body page-body-route${navBusy ? " is-busy" : ""}`}>
          {children}
        </main>
      </div>
    </div>
  );
}
