"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { roleSiteLabel, type NavKey } from "@/lib/auth-types";
import { APP_LOGO, APP_NAME, APP_SHORT } from "@/lib/brand";
import { usePageChrome } from "@/components/page-chrome-context";
import { clearSessionCache, useSession } from "@/components/session-provider";
import { setOfflineQueueUser } from "@/lib/offline-queue";
import "./app-shell-frame.css";

const NAV_ITEMS: {
  href: string;
  label: string;
  key: NavKey;
  group: "home" | "ops" | "cash" | "supply" | "pilot" | "admin";
  groupLabel?: string;
}[] = [
  {
    href: "/",
    label: "Tableau de bord",
    key: "synthese",
    group: "home",
    groupLabel: "Accueil",
  },
  {
    href: "/analyse",
    label: "Analyse",
    key: "analyse",
    group: "home",
  },
  {
    href: "/compte-resultat",
    label: "Compte de résultat",
    key: "compte-resultat",
    group: "home",
  },
  {
    href: "/comptabilite",
    label: "Comptabilité",
    key: "comptabilite",
    group: "home",
  },
  {
    href: "/vente",
    label: "Vente",
    key: "vente",
    group: "ops",
    groupLabel: "Quotidien",
  },
  {
    href: "/stock-zogbo",
    label: "Stock Zogbo",
    key: "zogbo",
    group: "ops",
  },
  {
    href: "/stock-gbegamey",
    label: "Stock Gbégamey",
    key: "gbegamey",
    group: "ops",
  },
  {
    href: "/caisse",
    label: "Caisse",
    key: "caisse",
    group: "cash",
    groupLabel: "Trésorerie",
  },
  {
    href: "/fonds-caisse",
    label: "Fonds de Caisse",
    key: "fonds-caisse",
    group: "cash",
  },
  {
    href: "/depenses",
    label: "Dépenses",
    key: "depenses",
    group: "cash",
  },
  {
    href: "/versements",
    label: "Versements",
    key: "versements",
    group: "cash",
  },
  {
    href: "/mouvements-caisse",
    label: "Mouvements de fonds",
    key: "mouvements-caisse",
    group: "cash",
  },
  {
    href: "/achats",
    label: "Achats",
    key: "appro",
    group: "supply",
    groupLabel: "Approvisionnement",
  },
  {
    href: "/pertes",
    label: "Pertes",
    key: "pertes",
    group: "supply",
  },
  {
    href: "/compteur",
    label: "Compteur",
    key: "compteur",
    group: "supply",
  },
  {
    href: "/immobilisations",
    label: "Immobilisations",
    key: "immobilisations",
    group: "supply",
  },
  {
    href: "/journal-ventes",
    label: "Journal ventes",
    key: "journal-ventes",
    group: "pilot",
    groupLabel: "Pilotage",
  },
  {
    href: "/historique",
    label: "Registre",
    key: "historique",
    group: "pilot",
  },
  {
    href: "/reglages",
    label: "Réglages POS",
    key: "reglages",
    group: "pilot",
  },
  {
    href: "/admin",
    label: "Équipe",
    key: "admin",
    group: "admin",
    groupLabel: "Compte",
  },
];

/** Pictos de navigation (trait 1.7, hérite de currentColor). */
const NAV_ICON_PATHS: Partial<Record<NavKey, string>> = {
  synthese: "M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6v-9h-6v9Zm0-16v5h6V4h-6Z",
  analyse: "M4 19V5M4 19h16M8 15l3-4 3 2 5-6",
  "compte-resultat": "M6 3h9l4 4v14H6V3Zm8 0v5h5M9 13h7M9 17h5",
  comptabilite: "M5 4h14v16H5V4Zm3 4h8M8 12h3m2 0h3M8 16h3m2 0h3",
  vente: "M4 5h2l2 10h9l2-7H7M10 19.5h.01M16 19.5h.01",
  zogbo: "M12 21s7-5.4 7-11a7 7 0 1 0-14 0c0 5.6 7 11 7 11Zm0-8.5a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8Z",
  gbegamey: "M4 19V7l8-3 8 3v12M4 19h16M9 19v-5h6v5",
  caisse: "M4 9h16v10H4V9Zm2-4h12l2 4H4l2-4Zm6 7v3",
  "fonds-caisse": "M4 7h16v12H4V7Zm0 3h16M15 15h2",
  depenses: "M12 3v18M16.5 7.5c-.8-1.2-2.4-2-4.5-2-2.7 0-4 1.3-4 3s1.3 2.4 4 3 4 1.4 4 3.2-1.5 3.3-4.5 3.3c-2.2 0-3.9-.8-4.8-2.2",
  versements: "M7 20V8m0 0L3.5 11.5M7 8l3.5 3.5M17 4v12m0 0 3.5-3.5M17 16l-3.5-3.5",
  "mouvements-caisse": "M4 8h13l-3-3M20 16H7l3 3",
  appro: "M3 7l9-4 9 4-9 4-9-4Zm0 5 9 4 9-4M3 17l9 4 9-4",
  pertes: "M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6",
  compteur: "M12 21a9 9 0 1 1 9-9M12 12l4-4M12 3v2",
  immobilisations: "M4 20h16M6 20V9l6-5 6 5v11M10 20v-6h4v6",
  stock: "M4 7l8-4 8 4v10l-8 4-8-4V7Zm8 4v10M4 7l8 4 8-4",
  "journal-ventes": "M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6M9 12h6",
  historique: "M12 7v5l3 2M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4",
  reglages: "M5 6h14M5 12h14M5 18h14M9 4v4M15 10v4M8 16v4",
  parametres: "M5 6h14M5 12h14M5 18h14M9 4v4M15 10v4M8 16v4",
  admin: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6 9c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M17 11a3 3 0 1 0 0-6m1 9.5c2 .5 3.5 2.1 3.5 4.5",
  "rapport-quotidien": "M7 3h10v18H7V3Zm3 5h4M10 12h4M10 16h2",
  controle: "M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3Zm-3 9 2 2 4-4",
};

function NavIcon({ name }: { name: NavKey }) {
  const d = NAV_ICON_PATHS[name];
  if (!d) return null;
  return (
    <svg
      className="side-nav-ico"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
    >
      <path d={d} />
    </svg>
  );
}

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShellFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, nav, ready } = useSession();
  const { meta, setActionsSlot } = usePageChrome();
  const [menuOpen, setMenuOpen] = useState(false);
  const [navBusy, setNavBusy] = useState(false);

  useEffect(() => {
    // Session révoquée (tokenVersion, désactivation, hors créneau) :
    // /api/auth/me renvoie 401 → cache vidé. On déconnecte le cookie puis
    // login (sinon middleware pouvait renvoyer vers l’accueil en boucle).
    if (ready && !user) {
      clearSessionCache();
      void fetch("/api/auth/logout", { method: "POST", cache: "no-store" })
        .catch(() => undefined)
        .finally(() => {
          router.replace("/login");
        });
    }
  }, [ready, user, router]);

  useEffect(() => {
    setMenuOpen(false);
    setNavBusy(true);
    const t = window.setTimeout(() => setNavBusy(false), 450);
    return () => window.clearTimeout(t);
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
    if (!nav?.length) return [];
    return NAV_ITEMS.filter((item) => nav.includes(item.key));
  }, [nav]);

  async function logout() {
    setOfflineQueueUser(null);
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

  const mainClass = meta.mainClassName ? ` ${meta.mainClassName}` : "";

  return (
    <div className={`app-shell${menuOpen ? " is-nav-open" : ""}`}>
      <div className="topbar">
        <Link href="/" className="topbar-brand" prefetch>
          <span className="topbar-logo">
            <img src={APP_LOGO} alt="" width={44} height={44} />
          </span>
          <span className="topbar-name">
            <strong>KINGFISH</strong>
            <span>Manager</span>
          </span>
        </Link>
        <p className="topbar-slogan">
          La mer nous unit,
          <br />
          la qualité nous distingue
        </p>
        <svg
          className="topbar-wave"
          viewBox="0 0 520 80"
          preserveAspectRatio="none"
          aria-hidden
          focusable="false"
        >
          <path d="M0 80C120 70 160 10 300 28s140 36 220-28v80Z" fill="#0b5fa8" opacity="0.55" />
          <path d="M120 80C230 62 300 20 400 22s90 16 120-6" fill="none" stroke="#f5b400" strokeWidth="5" strokeLinecap="round" />
        </svg>
        {user ? (
          <div className="topbar-user">
            <span className="user-avatar" aria-hidden>
              {initials}
            </span>
            <span className="topbar-user-meta">
              <strong>{user.name}</strong>
              <span>{roleSiteLabel(user.role, user.site)}</span>
            </span>
          </div>
        ) : null}
      </div>

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
            <span className="brand-tag">
              <span>Production · Vente</span>
              <span>Stock</span>
            </span>
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
                  <NavIcon name={item.key} />
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
          <div className="page-header-copy">
            {pathname === "/" && user ? (
              <p className="page-greeting">
                Bonjour, {user.name.split(/\s+/)[0]}{" "}
                <span aria-hidden>👋</span>
              </p>
            ) : null}
            <h1>{meta.title}</h1>
            {meta.subtitle ? (
              <p className="page-subtitle">{meta.subtitle}</p>
            ) : null}
          </div>
          <div className="page-actions" ref={setActionsSlot} />
        </header>

        <main className={`page-body page-body-route${navBusy ? " is-busy" : ""}`}>
          {children}
        </main>
      </div>
    </div>
  );
}
