"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ExportExcelButton } from "@/components/export-excel-button";
import { RegistreDrawer } from "@/components/registre-drawer";
import {
  ROLE_LABELS,
  SHIFT_LABELS,
  SHIFTS,
  SITE_LABELS,
  adminKindLabel,
  isExecutiveAdminAccount,
  isGlobalAdmin,
  isPrincipalAdminAccount,
  roleSiteLabel,
  rolesCreatableBy,
  sitesCreatableBy,
  type AppUser,
  type SessionUser,
  type UserRole,
  type UserShift,
  type UserSite,
} from "@/lib/auth-types";
import { exportAdminUsersExcel } from "@/lib/page-exports";
import { BrandLoader } from "@/components/brand-loader";
import { AutorisationsEditor } from "@/components/admin/autorisations-editor";
import { ConnexionsPanel } from "@/components/admin/connexions-panel";
import { MailAlertsPanel } from "@/components/admin/mail-alerts-panel";
import { StockEnforcementPanel } from "@/components/admin/stock-enforcement-panel";
import { VentesLiveNotifier } from "@/components/admin/ventes-live-notifier";
import { SiteRolesEditor } from "@/components/reglages/site-roles-editor";

const ALL_ROLES: UserRole[] = ["gerant", "comptable", "daf", "admin"];
const SITE_ORDER: UserSite[] = ["gbegamey", "zogbo", "tous"];

const ROLE_SHORT: Record<UserRole, string> = {
  gerant: "Gérant",
  comptable: "Comptable",
  daf: "DAF",
  admin: "Admin",
};

type AdminSection =
  | "comptes"
  | "connexions"
  | "ventes"
  | "autorisations"
  | "mails";

type ActorInfo = Pick<SessionUser, "id" | "username" | "role" | "site"> & {
  isGlobal: boolean;
};

type FilterActive = "all" | "active" | "inactive";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
  return letters || "·";
}

function parseBulkLines(
  text: string,
  allowedRoles: UserRole[],
): {
  rows: {
    username: string;
    name: string;
    password: string;
    role: UserRole;
    site: UserSite;
  }[];
  parseErrors: string[];
} {
  const parseErrors: string[] = [];
  const rows: {
    username: string;
    name: string;
    password: string;
    role: UserRole;
    site: UserSite;
  }[] = [];

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

  for (let i = 0; i < lines.length; i++) {
    const parts = lines[i]!.split(/[;\t|,]/).map((p) => p.trim());
    if (parts.length < 5) {
      parseErrors.push(
        `Ligne ${i + 1} : format attendu identifiant;nom;motdepasse;role;site`,
      );
      continue;
    }
    const [username, name, password, roleRaw, siteRaw] = parts;
    const role = roleRaw!.toLowerCase() as UserRole;
    const site = siteRaw!.toLowerCase() as UserSite;
    if (!allowedRoles.includes(role)) {
      parseErrors.push(
        `Ligne ${i + 1} : rôle invalide « ${roleRaw} » (${allowedRoles.join("|")})`,
      );
      continue;
    }
    if (!(["zogbo", "gbegamey", "tous"] as string[]).includes(site)) {
      parseErrors.push(
        `Ligne ${i + 1} : site invalide « ${siteRaw} » (zogbo|gbegamey|tous)`,
      );
      continue;
    }
    rows.push({
      username: username!,
      name: name!,
      password: password!,
      role,
      site,
    });
  }

  return { rows, parseErrors };
}

function RailIcon({ id }: { id: AdminSection }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (id === "comptes") {
    return (
      <svg {...common}>
        <path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
        <circle cx="9.5" cy="7" r="3.2" />
        <path d="M20 8v6M17 11h6" />
      </svg>
    );
  }
  if (id === "connexions") {
    return (
      <svg {...common}>
        <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
        <circle cx="12" cy="12" r="3.2" />
      </svg>
    );
  }
  if (id === "ventes") {
    return (
      <svg {...common}>
        <path d="M4 7h16l-1.4 9.2a2 2 0 0 1-2 1.8H7.4a2 2 0 0 1-2-1.8L4 7Z" />
        <path d="M8 7V5.5A2.5 2.5 0 0 1 10.5 3h3A2.5 2.5 0 0 1 16 5.5V7" />
      </svg>
    );
  }
  if (id === "autorisations") {
    return (
      <svg {...common}>
        <path d="M12 3 5 6.2v5.3c0 4 3 6.8 7 8.5 4-1.7 7-4.5 7-8.5V6.2L12 3Z" />
        <path d="M9.2 12.1 11.1 14l3.7-3.8" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M4 7.5 12 3l8 4.5v6.2c0 4.2-3.4 7.2-8 8.8-4.6-1.6-8-4.6-8-8.8V7.5Z" />
      <path d="M8.5 12h7M8.5 15h4.5" />
    </svg>
  );
}

export function AdminPage() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [actor, setActor] = useState<ActorInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [bulkText, setBulkText] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [createMode, setCreateMode] = useState<"single" | "bulk">("single");
  const [createOpen, setCreateOpen] = useState(false);
  const [section, setSection] = useState<AdminSection>("comptes");
  const [query, setQuery] = useState("");
  const [filterRole, setFilterRole] = useState<UserRole | "all">("all");
  const [filterSite, setFilterSite] = useState<UserSite | "all">("all");
  const [filterActive, setFilterActive] = useState<FilterActive>("all");

  const [form, setForm] = useState({
    username: "",
    name: "",
    password: "",
    role: "gerant" as UserRole,
    shift: "jour" as UserShift,
    site: "gbegamey" as UserSite,
  });

  const creatableRoles = useMemo(
    () => (actor ? rolesCreatableBy(actor) : ALL_ROLES),
    [actor],
  );

  const siteOptions = useMemo(() => {
    if (!actor) return sitesCreatableBy({ role: "admin", site: "tous" }, form.role);
    return sitesCreatableBy(actor, form.role);
  }, [actor, form.role]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Erreur de chargement");
      setUsers(body.users as AppUser[]);
      if (body.actor) {
        const nextActor = body.actor as ActorInfo;
        setActor(nextActor);
        setForm((f) => {
          const roles = rolesCreatableBy(nextActor);
          const role = roles.includes(f.role) ? f.role : (roles[0] ?? "gerant");
          const sites = sitesCreatableBy(nextActor, role);
          const site = sites.includes(f.site)
            ? f.site
            : (sites[0] ?? "gbegamey");
          return { ...f, role, site };
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (section !== "comptes") setCreateOpen(false);
  }, [section]);

  function setRole(role: UserRole) {
    if (!actor) {
      setForm((f) => ({ ...f, role }));
      return;
    }
    const allowed = sitesCreatableBy(actor, role);
    setForm((f) => ({
      ...f,
      role,
      site: allowed.includes(f.site) ? f.site : (allowed[0] ?? f.site),
    }));
  }

  async function createUser(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Création impossible");
      setForm((f) => ({
        ...f,
        username: "",
        name: "",
        password: "",
      }));
      setFlash(
        `« ${body.user.username} » créé · ${roleSiteLabel(body.user.role, body.user.site)}`,
      );
      window.setTimeout(() => setFlash(null), 3500);
      setCreateOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Création impossible");
    } finally {
      setSaving(false);
    }
  }

  async function createBulk(e: FormEvent) {
    e.preventDefault();
    const { rows, parseErrors } = parseBulkLines(bulkText, creatableRoles);
    if (parseErrors.length) {
      setError(parseErrors.slice(0, 5).join(" · "));
      return;
    }
    if (!rows.length) {
      setError("Collez au moins une ligne de compte.");
      return;
    }
    setBulkBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ users: rows }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Création groupée impossible");
      const n = (body.created as AppUser[] | undefined)?.length ?? 0;
      const errs = (body.errors as { username: string; error: string }[]) ?? [];
      setFlash(
        `${n} compte(s) créé(s)${errs.length ? ` · ${errs.length} erreur(s)` : ""}`,
      );
      if (errs.length) {
        setError(
          errs
            .slice(0, 8)
            .map((x) => `${x.username}: ${x.error}`)
            .join(" · "),
        );
      } else {
        setCreateOpen(false);
      }
      window.setTimeout(() => setFlash(null), 3500);
      if (n > 0) setBulkText("");
      await load();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Création groupée impossible",
      );
    } finally {
      setBulkBusy(false);
    }
  }

  async function patchUser(
    id: string,
    patch: Partial<{
      role: UserRole;
      site: UserSite;
      shift: UserShift;
      active: boolean;
      password: string;
      name: string;
    }>,
  ) {
    setError(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...patch }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Mise à jour impossible");
      setUsers((prev) =>
        prev.map((u) => (u.id === id ? (body.user as AppUser) : u)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Mise à jour impossible");
    }
  }

  async function removeUser(user: AppUser) {
    if (!window.confirm(`Supprimer l’utilisateur « ${user.username} » ?`)) {
      return;
    }
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/users?id=${encodeURIComponent(user.id)}`,
        { method: "DELETE" },
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Suppression impossible");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Suppression impossible");
    }
  }

  const actorIsGlobal = actor ? isGlobalAdmin(actor) : true;
  const actorCanDeleteAny =
    !!actor && isExecutiveAdminAccount(actor.username);
  const showAutorisations = !!actor && actor.role === "admin";
  const bulkExample = actorIsGlobal
    ? "paul;Paul D.;Paul123;gerant;zogbo\naya;Aya S.;Aya1234;admin;gbegamey\nsuper;Aide globale;Super123;admin;tous"
    : `marie;Marie K.;Marie123;gerant;${actor?.site ?? "gbegamey"}\nchef;Chef zone;Chef123;admin;${actor?.site ?? "gbegamey"}`;

  const navItems = useMemo(() => {
    const items: {
      id: AdminSection;
      label: string;
      hint: string;
      badge?: number;
    }[] = [
      {
        id: "comptes",
        label: "Comptes",
        hint: "Annuaire et accès",
        badge: loading ? undefined : users.length,
      },
      {
        id: "connexions",
        label: "Connexions",
        hint: "Présence en direct",
      },
      {
        id: "ventes",
        label: "Politiques",
        hint: "Stock et droits POS",
      },
    ];
    if (showAutorisations) {
      items.push({
        id: "autorisations",
        label: "Autorisations",
        hint: "Pages par rôle",
      });
      items.push({
        id: "mails",
        label: "Alertes mail",
        hint: "Destinataires ventes",
      });
    }
    return items;
  }, [loading, showAutorisations, users.length]);

  const stats = useMemo(() => {
    const active = users.filter((u) => u.active).length;
    return {
      total: users.length,
      active,
      inactive: users.length - active,
      gbegamey: users.filter((u) => u.site === "gbegamey").length,
      zogbo: users.filter((u) => u.site === "zogbo").length,
      tous: users.filter((u) => u.site === "tous").length,
    };
  }, [users]);

  const filteredUsers = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((u) => {
      if (filterRole !== "all" && u.role !== filterRole) return false;
      if (filterSite !== "all" && u.site !== filterSite) return false;
      if (filterActive === "active" && !u.active) return false;
      if (filterActive === "inactive" && u.active) return false;
      if (!q) return true;
      return (
        u.name.toLowerCase().includes(q) ||
        u.username.toLowerCase().includes(q)
      );
    });
  }, [users, query, filterRole, filterSite, filterActive]);

  const groups = useMemo(
    () =>
      SITE_ORDER.map((site) => ({
        site,
        users: filteredUsers.filter((u) => u.site === site),
      })).filter((g) => g.users.length > 0),
    [filteredUsers],
  );

  const filtersOn =
    query.trim() !== "" ||
    filterRole !== "all" ||
    filterSite !== "all" ||
    filterActive !== "all";

  return (
    <AppShell
      title="Équipe"
      subtitle={
        actor
          ? actorIsGlobal
            ? "Comptes, présence, politiques de vente et autorisations."
            : `${adminKindLabel(actor.site)} — périmètre ${SITE_LABELS[actor.site]}.`
          : "Gestion des comptes et des droits."
      }
      mainClassName="equipe-page"
      actions={
        section === "comptes" ? (
          <ExportExcelButton
            onExport={() => exportAdminUsersExcel(users)}
            disabled={loading || users.length === 0}
          />
        ) : null
      }
    >
      <div className="equipe-workspace">
        <nav className="equipe-rail" aria-label="Sections Équipe">
          <p className="equipe-rail-kicker">Espace admin</p>
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`equipe-rail-item${section === item.id ? " is-active" : ""}`}
              aria-current={section === item.id ? "page" : undefined}
              onClick={() => setSection(item.id)}
            >
              <span className="equipe-rail-icon">
                <RailIcon id={item.id} />
              </span>
              <span className="equipe-rail-copy">
                <strong>{item.label}</strong>
                <span>{item.hint}</span>
              </span>
              {item.badge != null ? (
                <span className="equipe-rail-badge">{item.badge}</span>
              ) : null}
            </button>
          ))}
        </nav>

        <div className="equipe-canvas">
          <div className="equipe-status-row">
            <VentesLiveNotifier />
            {flash ? (
              <p className="equipe-flash" role="status">
                {flash}
              </p>
            ) : null}
          </div>
          {error ? (
            <p className="error-banner" role="alert">
              {error}
            </p>
          ) : null}

          {section === "comptes" ? (
            <div className="equipe-section">
              <div className="equipe-kpis" aria-label="Synthèse des comptes">
                <article className="equipe-kpi">
                  <span>Comptes</span>
                  <strong>{loading ? "—" : stats.total}</strong>
                </article>
                <article className="equipe-kpi is-ok">
                  <span>Actifs</span>
                  <strong>{loading ? "—" : stats.active}</strong>
                </article>
                <article className="equipe-kpi">
                  <span>Inactifs</span>
                  <strong>{loading ? "—" : stats.inactive}</strong>
                </article>
                {actorIsGlobal ? (
                  <>
                    <article className="equipe-kpi">
                      <span>Gbégamey</span>
                      <strong>{loading ? "—" : stats.gbegamey}</strong>
                    </article>
                    <article className="equipe-kpi">
                      <span>Zogbo</span>
                      <strong>{loading ? "—" : stats.zogbo}</strong>
                    </article>
                    <article className="equipe-kpi">
                      <span>Global</span>
                      <strong>{loading ? "—" : stats.tous}</strong>
                    </article>
                  </>
                ) : (
                  <article className="equipe-kpi is-accent">
                    <span>Périmètre</span>
                    <strong>
                      {actor ? SITE_LABELS[actor.site] : "—"}
                    </strong>
                  </article>
                )}
              </div>

              <div className="equipe-toolbar">
                <label className="equipe-search">
                  <span className="sr-only">Rechercher un compte</span>
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Nom ou identifiant…"
                    autoComplete="off"
                  />
                </label>
                <div className="equipe-filters">
                  <select
                    className="select-input"
                    value={filterRole}
                    onChange={(e) =>
                      setFilterRole(e.target.value as UserRole | "all")
                    }
                    aria-label="Filtrer par rôle"
                  >
                    <option value="all">Tous les rôles</option>
                    {ALL_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_SHORT[r]}
                      </option>
                    ))}
                  </select>
                  <select
                    className="select-input"
                    value={filterSite}
                    onChange={(e) =>
                      setFilterSite(e.target.value as UserSite | "all")
                    }
                    aria-label="Filtrer par site"
                  >
                    <option value="all">Tous les sites</option>
                    {SITE_ORDER.map((s) => (
                      <option key={s} value={s}>
                        {SITE_LABELS[s]}
                      </option>
                    ))}
                  </select>
                  <select
                    className="select-input"
                    value={filterActive}
                    onChange={(e) =>
                      setFilterActive(e.target.value as FilterActive)
                    }
                    aria-label="Filtrer par statut"
                  >
                    <option value="all">Tous les statuts</option>
                    <option value="active">Actifs</option>
                    <option value="inactive">Inactifs</option>
                  </select>
                </div>
                <button
                  type="button"
                  className="btn btn-primary equipe-create-btn"
                  onClick={() => {
                    setError(null);
                    setCreateOpen(true);
                  }}
                >
                  Nouveau compte
                </button>
              </div>

              {loading ? (
                <BrandLoader variant="ligne" label="Chargement des comptes…" />
              ) : filteredUsers.length === 0 ? (
                <div className="equipe-empty">
                  <strong>
                    {filtersOn
                      ? "Aucun compte ne correspond aux filtres."
                      : "Aucun compte pour le moment."}
                  </strong>
                  <p className="muted">
                    {filtersOn
                      ? "Effacez la recherche ou élargissez les filtres."
                      : "Créez le premier compte pour ouvrir l’annuaire."}
                  </p>
                  {filtersOn ? (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => {
                        setQuery("");
                        setFilterRole("all");
                        setFilterSite("all");
                        setFilterActive("all");
                      }}
                    >
                      Réinitialiser les filtres
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => setCreateOpen(true)}
                    >
                      Nouveau compte
                    </button>
                  )}
                </div>
              ) : (
                <div className="equipe-directory">
                  {groups.map((group) => (
                    <section key={group.site} className="equipe-group">
                      <header className="equipe-group-head">
                        <h2>
                          {group.site === "tous"
                            ? "Les deux sites"
                            : SITE_LABELS[group.site]}
                        </h2>
                        <span>
                          {group.users.length} compte
                          {group.users.length > 1 ? "s" : ""}
                        </span>
                      </header>
                      <div className="equipe-card-grid">
                        {group.users.map((u) => {
                          const rowRoles = actor
                            ? rolesCreatableBy(actor)
                            : ALL_ROLES;
                          const rowSites = actor
                            ? sitesCreatableBy(actor, u.role)
                            : (["zogbo", "gbegamey", "tous"] as UserSite[]);
                          const lockedPrincipal =
                            isPrincipalAdminAccount(u.username) &&
                            !actorIsGlobal &&
                            !actorCanDeleteAny;
                          const canDelete =
                            actorCanDeleteAny ||
                            !isPrincipalAdminAccount(u.username);
                          return (
                            <article
                              key={u.id}
                              className={`equipe-card${u.active ? "" : " is-inactive"}`}
                            >
                              <header className="equipe-card-head">
                                <span
                                  className="equipe-avatar"
                                  data-role={u.role}
                                >
                                  {initials(u.name)}
                                </span>
                                <div className="equipe-card-id">
                                  <strong>{u.name}</strong>
                                  <span className="mono">@{u.username}</span>
                                </div>
                                <div className="equipe-card-flags">
                                  {lockedPrincipal ? (
                                    <span className="equipe-chip is-lock">
                                      Protégé
                                    </span>
                                  ) : null}
                                  <button
                                    type="button"
                                    role="switch"
                                    aria-checked={u.active}
                                    className={`equipe-switch${u.active ? " is-on" : ""}`}
                                    disabled={lockedPrincipal}
                                    onClick={() =>
                                      void patchUser(u.id, {
                                        active: !u.active,
                                      })
                                    }
                                  >
                                    <span
                                      className="equipe-switch-knob"
                                      aria-hidden
                                    />
                                    <span>
                                      {u.active ? "Actif" : "Inactif"}
                                    </span>
                                  </button>
                                </div>
                              </header>

                              <div className="equipe-card-badges">
                                <span
                                  className="equipe-chip"
                                  data-role={u.role}
                                >
                                  {u.role === "admin"
                                    ? adminKindLabel(u.site)
                                    : ROLE_SHORT[u.role]}
                                </span>
                                <span className="equipe-chip">
                                  {SHIFT_LABELS[u.shift ?? "aucune"]}
                                </span>
                              </div>

                              <div className="equipe-card-controls">
                                <label>
                                  <span>Rôle</span>
                                  <select
                                    className="select-input"
                                    value={u.role}
                                    disabled={lockedPrincipal}
                                    onChange={(e) => {
                                      const role = e.target.value as UserRole;
                                      const allowed = actor
                                        ? sitesCreatableBy(actor, role)
                                        : rowSites;
                                      const site = allowed.includes(u.site)
                                        ? u.site
                                        : (allowed[0] ?? u.site);
                                      void patchUser(u.id, { role, site });
                                    }}
                                  >
                                    {rowRoles.map((r) => (
                                      <option key={r} value={r}>
                                        {ROLE_LABELS[r]}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <label>
                                  <span>
                                    {u.role === "admin" ||
                                    u.role === "daf" ||
                                    u.role === "comptable"
                                      ? "Périmètre"
                                      : "Site"}
                                  </span>
                                  <select
                                    className="select-input"
                                    value={u.site}
                                    disabled={lockedPrincipal}
                                    onChange={(e) =>
                                      void patchUser(u.id, {
                                        site: e.target.value as UserSite,
                                      })
                                    }
                                  >
                                    {rowSites.map((s) => (
                                      <option key={s} value={s}>
                                        {u.role === "admin"
                                          ? adminKindLabel(s)
                                          : SITE_LABELS[s]}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <label>
                                  <span>Équipe</span>
                                  <select
                                    className="select-input"
                                    value={u.shift ?? "aucune"}
                                    disabled={lockedPrincipal}
                                    onChange={(e) =>
                                      void patchUser(u.id, {
                                        shift: e.target.value as UserShift,
                                      })
                                    }
                                    aria-label={`Équipe de ${u.username}`}
                                  >
                                    {SHIFTS.map((eq) => (
                                      <option key={eq} value={eq}>
                                        {SHIFT_LABELS[eq]}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              </div>

                              <footer className="equipe-card-actions">
                                <button
                                  type="button"
                                  className="btn btn-ghost"
                                  disabled={lockedPrincipal}
                                  onClick={() => {
                                    const pwd = window.prompt(
                                      `Nouveau mot de passe pour ${u.username}`,
                                    );
                                    if (pwd)
                                      void patchUser(u.id, { password: pwd });
                                  }}
                                >
                                  Réinitialiser le mot de passe
                                </button>
                                {canDelete ? (
                                  <button
                                    type="button"
                                    className="btn equipe-btn-danger"
                                    aria-label={`Supprimer ${u.username}`}
                                    onClick={() => void removeUser(u)}
                                  >
                                    Supprimer
                                  </button>
                                ) : null}
                              </footer>
                            </article>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {section === "connexions" ? (
            <div className="equipe-section">
              <ConnexionsPanel />
            </div>
          ) : null}

          {section === "ventes" ? (
            <div className="equipe-section">
              <div className="equipe-ventes-stack">
                <StockEnforcementPanel />
                <SiteRolesEditor />
              </div>
            </div>
          ) : null}

          {section === "autorisations" && showAutorisations ? (
            <div className="equipe-section">
              <AutorisationsEditor embedded />
            </div>
          ) : null}

          {section === "mails" && showAutorisations ? (
            <div className="equipe-section">
              <MailAlertsPanel />
            </div>
          ) : null}
        </div>
      </div>

      <RegistreDrawer
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Nouveau compte"
        subtitle="Un compte à la fois, ou une liste collée en une passe."
        closeLabel="Fermer la création de compte"
      >
        <div className="equipe-create">
          {error ? (
            <p className="error-banner" role="alert">
              {error}
            </p>
          ) : null}
          <div
            className="equipe-create-tabs"
            role="tablist"
            aria-label="Mode de création"
          >
            <button
              type="button"
              role="tab"
              aria-selected={createMode === "single"}
              className={`equipe-create-tab${createMode === "single" ? " is-active" : ""}`}
              onClick={() => setCreateMode("single")}
            >
              Un compte
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={createMode === "bulk"}
              className={`equipe-create-tab${createMode === "bulk" ? " is-active" : ""}`}
              onClick={() => setCreateMode("bulk")}
            >
              Plusieurs
            </button>
          </div>

          {createMode === "single" ? (
            <form className="admin-form" onSubmit={createUser}>
              <div className="admin-form-grid admin-form-grid-compact">
                <label className="admin-field admin-field-full">
                  <span>Identifiant</span>
                  <input
                    value={form.username}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, username: e.target.value }))
                    }
                    required
                    minLength={3}
                    autoComplete="off"
                    placeholder="ex. paul"
                  />
                </label>
                <label className="admin-field admin-field-full">
                  <span>Nom affiché</span>
                  <input
                    value={form.name}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, name: e.target.value }))
                    }
                    required
                    placeholder="ex. Paul D."
                  />
                </label>
                <label className="admin-field admin-field-full">
                  <span>Mot de passe</span>
                  <input
                    type="password"
                    value={form.password}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, password: e.target.value }))
                    }
                    required
                    minLength={6}
                    autoComplete="new-password"
                  />
                </label>
                <label className="admin-field">
                  <span>Rôle</span>
                  <select
                    className="select-input"
                    value={form.role}
                    onChange={(e) => setRole(e.target.value as UserRole)}
                  >
                    {creatableRoles.map((r) => (
                      <option key={r} value={r}>
                        {r === "admin"
                          ? actorIsGlobal
                            ? "Administrateur (zone ou global)"
                            : "Administrateur de zone"
                          : ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="admin-field">
                  <span>
                    {form.role === "admin" ||
                    form.role === "daf" ||
                    form.role === "comptable"
                      ? "Périmètre"
                      : "Site"}
                  </span>
                  <select
                    className="select-input"
                    value={form.site}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        site: e.target.value as UserSite,
                      }))
                    }
                    required
                  >
                    {siteOptions.map((s) => (
                      <option key={s} value={s}>
                        {form.role === "admin"
                          ? adminKindLabel(s)
                          : SITE_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="admin-field admin-field-full">
                  <span>Équipe de service</span>
                  <select
                    className="select-input"
                    value={form.shift}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        shift: e.target.value as UserShift,
                      }))
                    }
                  >
                    {SHIFTS.map((eq) => (
                      <option key={eq} value={eq}>
                        {SHIFT_LABELS[eq]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="muted equipe-create-hint">
                {form.role === "admin"
                  ? form.site === "tous"
                    ? "Admin global : Zogbo + Gbégamey."
                    : `Admin de zone : ${SITE_LABELS[form.site]} uniquement.`
                  : form.role === "daf"
                    ? "DAF : direction financière sur les deux sites. Ce n’est pas un administrateur — pas de page Équipe ni de gestion des comptes."
                    : form.role === "comptable"
                      ? "Comptable : finance et consultation des stocks — sans vente ni saisie."
                      : form.site === "tous"
                        ? "Accès aux deux zones."
                        : `${SITE_LABELS[form.site]} — ventes créditées à l’équipe choisie.`}
              </p>
              <div className="equipe-create-actions">
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={saving}
                >
                  {saving ? "Création…" : "Créer le compte"}
                </button>
              </div>
            </form>
          ) : (
            <form className="admin-form" onSubmit={createBulk}>
              <p className="muted equipe-create-hint">
                Une ligne par compte :{" "}
                <code>identifiant;nom;motdepasse;role;site</code>
              </p>
              <label className="admin-field admin-field-full">
                <span>Liste des comptes</span>
                <textarea
                  className="admin-bulk-textarea"
                  rows={8}
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  placeholder={bulkExample}
                />
              </label>
              <div className="equipe-create-actions">
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={bulkBusy || !bulkText.trim()}
                >
                  {bulkBusy ? "Création…" : "Créer tous les comptes"}
                </button>
              </div>
            </form>
          )}

          <ul className="equipe-legend">
            <li>Gérant → un site</li>
            <li>Comptable → finance</li>
            <li>DAF → finance, pas administrateur</li>
            <li>Admin → zone ou global</li>
          </ul>
        </div>
      </RegistreDrawer>
    </AppShell>
  );
}
