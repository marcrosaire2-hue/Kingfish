"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ExportExcelButton } from "@/components/export-excel-button";
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
import { SiteRolesEditor } from "@/components/reglages/site-roles-editor";

const ALL_ROLES: UserRole[] = [
  "gerant",
  "comptable",
  "daf",
  "admin",
];

type AdminSection = "comptes" | "ventes" | "autorisations";

type ActorInfo = Pick<SessionUser, "id" | "username" | "role" | "site"> & {
  isGlobal: boolean;
};

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
  const [section, setSection] = useState<AdminSection>("comptes");

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
        `« ${body.user.username} » créé · ${roleSiteLabel(body.user.role, body.user.site)} — prêt pour le suivant`,
      );
      window.setTimeout(() => setFlash(null), 3500);
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
  const showAutorisations =
    !!actor &&
    actor.role === "admin" &&
    isExecutiveAdminAccount(actor.username);
  const bulkExample = actorIsGlobal
    ? "paul;Paul D.;Paul123;gerant;zogbo\naya;Aya S.;Aya1234;admin;gbegamey\nsuper;Aide globale;Super123;admin;tous"
    : `marie;Marie K.;Marie123;gerant;${actor?.site ?? "gbegamey"}\nchef;Chef zone;Chef123;admin;${actor?.site ?? "gbegamey"}`;

  return (
    <AppShell
      title="Équipe"
      subtitle={
        actor
          ? actorIsGlobal
            ? "Comptes, politiques ventes et autorisations."
            : `${adminKindLabel(actor.site)} — comptes et accès limités à ${SITE_LABELS[actor.site]}.`
          : "Gestion des comptes et des droits."
      }
      actions={
        section === "comptes" ? (
          <ExportExcelButton
            onExport={() => exportAdminUsersExcel(users)}
            disabled={loading || users.length === 0}
          />
        ) : null
      }
    >
      <div className="admin-page-stack">
        {flash ? <p className="warn-inline">{flash}</p> : null}
        {error ? (
          <p className="error-banner" role="alert">
            {error}
          </p>
        ) : null}

        <nav
          className="admin-section-nav"
          role="tablist"
          aria-label="Sections Équipe"
        >
          <button
            type="button"
            role="tab"
            aria-selected={section === "comptes"}
            className={`admin-section-tab${section === "comptes" ? " is-active" : ""}`}
            onClick={() => setSection("comptes")}
          >
            Comptes
            {!loading ? (
              <span className="admin-section-badge">{users.length}</span>
            ) : null}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={section === "ventes"}
            className={`admin-section-tab${section === "ventes" ? " is-active" : ""}`}
            onClick={() => setSection("ventes")}
          >
            Politiques ventes
          </button>
          {showAutorisations ? (
            <button
              type="button"
              role="tab"
              aria-selected={section === "autorisations"}
              className={`admin-section-tab${section === "autorisations" ? " is-active" : ""}`}
              onClick={() => setSection("autorisations")}
            >
              Autorisations
            </button>
          ) : null}
        </nav>

        {section === "comptes" ? (
          <div className="admin-section-panel" role="tabpanel">
            <details className="admin-site-banner">
              <summary>Niveaux d’administration et périmètres</summary>
              <ul className="admin-admin-levels">
                <li>
                  <strong>Admin de zone</strong> (Zogbo ou Gbégamey) — comptes et
                  activité de sa zone uniquement.
                </li>
                <li>
                  <strong>Admin global</strong> (Les deux sites) — toutes les zones,
                  création des admins de zone.
                </li>
              </ul>
              {!actorIsGlobal && actor ? (
                <p className="admin-zone-note">
                  Connecté comme {adminKindLabel(actor.site)} — les autres zones ne
                  sont pas visibles ici.
                </p>
              ) : null}
            </details>

            <div className="admin-grid">
              <section className="panel admin-create-panel">
                <div className="admin-create-head">
                  <h2 className="panel-title">Créer des comptes</h2>
                  <div
                    className="admin-create-tabs"
                    role="tablist"
                    aria-label="Mode de création"
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={createMode === "single"}
                      className={`admin-create-tab${createMode === "single" ? " is-active" : ""}`}
                      onClick={() => setCreateMode("single")}
                    >
                      Un compte
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={createMode === "bulk"}
                      className={`admin-create-tab${createMode === "bulk" ? " is-active" : ""}`}
                      onClick={() => setCreateMode("bulk")}
                    >
                      Plusieurs
                    </button>
                  </div>
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
                          {form.role === "admin"
                            ? "Périmètre"
                            : form.role === "daf" || form.role === "comptable"
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
                    <p className="muted admin-site-hint">
                      {form.role === "admin"
                        ? form.site === "tous"
                          ? "Admin global : Zogbo + Gbégamey."
                          : `Admin de zone : ${SITE_LABELS[form.site]} uniquement.`
                        : form.role === "daf"
                          ? "DAF : droits opérationnels sur les deux sites, sans gestion des comptes."
                          : form.role === "comptable"
                            ? "Comptable : finance et consultation des stocks — sans vente ni saisie."
                            : form.site === "tous"
                              ? "Accès aux deux zones."
                              : `${SITE_LABELS[form.site]} — ventes créditées à l’équipe choisie.`}
                    </p>
                    <div className="admin-form-actions">
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
                    <p className="muted admin-bulk-help">
                      Une ligne par compte :{" "}
                      <code>identifiant;nom;motdepasse;role;site</code>
                    </p>
                    <label className="admin-field admin-field-full">
                      <span>Liste des comptes</span>
                      <textarea
                        className="admin-bulk-textarea"
                        rows={7}
                        value={bulkText}
                        onChange={(e) => setBulkText(e.target.value)}
                        placeholder={bulkExample}
                      />
                    </label>
                    <div className="admin-form-actions">
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

                <div className="admin-legend">
                  <span className="admin-legend-chip">Gérant → un site</span>
                  <span className="admin-legend-chip">Comptable → finance</span>
                  <span className="admin-legend-chip">DAF → sans Équipe</span>
                  <span className="admin-legend-chip">Admin → zone ou global</span>
                </div>
              </section>

              <section className="panel panel-wide admin-users-panel">
                <h2 className="panel-title">
                  Utilisateurs ({users.length})
                  {actor && !actorIsGlobal
                    ? ` · ${SITE_LABELS[actor.site]}`
                    : ""}
                </h2>
                {loading ? (
                  <BrandLoader variant="ligne" label="Chargement des comptes…" />
                ) : (
                  <div className="admin-table-wrap">
                    <table className="data-table admin-users-table">
                      <thead>
                        <tr>
                          <th>Identifiant</th>
                          <th>Nom</th>
                          <th>Rôle</th>
                          <th>Site</th>
                          <th>Équipe</th>
                          <th>Actif</th>
                          <th>Mot de passe</th>
                          <th aria-label="Actions" />
                        </tr>
                      </thead>
                      <tbody>
                        {users.map((u) => {
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
                          return (
                            <tr
                              key={u.id}
                              className={u.active ? undefined : "row-muted"}
                            >
                              <td className="cell-name">
                                {u.username}
                                {u.role === "admin" ? (
                                  <span className="cell-sub">
                                    {adminKindLabel(u.site)}
                                  </span>
                                ) : u.role === "daf" ? (
                                  <span className="cell-sub">{ROLE_LABELS.daf}</span>
                                ) : u.role === "comptable" ? (
                                  <span className="cell-sub">
                                    {ROLE_LABELS.comptable}
                                  </span>
                                ) : null}
                              </td>
                              <td>{u.name}</td>
                              <td>
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
                              </td>
                              <td>
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
                              </td>
                              <td>
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
                              </td>
                              <td>
                                <input
                                  type="checkbox"
                                  checked={u.active}
                                  disabled={lockedPrincipal}
                                  onChange={(e) =>
                                    void patchUser(u.id, { active: e.target.checked })
                                  }
                                  aria-label={`Activer ${u.username}`}
                                />
                              </td>
                              <td>
                                <button
                                  type="button"
                                  className="btn-link"
                                  disabled={lockedPrincipal}
                                  onClick={() => {
                                    const pwd = window.prompt(
                                      `Nouveau mot de passe pour ${u.username}`,
                                    );
                                    if (pwd) void patchUser(u.id, { password: pwd });
                                  }}
                                >
                                  Réinitialiser
                                </button>
                              </td>
                              <td className="col-actions">
                                {actorCanDeleteAny ||
                                !isPrincipalAdminAccount(u.username) ? (
                                  <button
                                    type="button"
                                    className="btn-icon"
                                    aria-label={`Supprimer ${u.username}`}
                                    onClick={() => void removeUser(u)}
                                  >
                                    ×
                                  </button>
                                ) : null}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          </div>
        ) : null}

        {section === "ventes" ? (
          <div className="admin-section-panel" role="tabpanel">
            <SiteRolesEditor />
          </div>
        ) : null}

        {section === "autorisations" && showAutorisations ? (
          <div className="admin-section-panel" role="tabpanel">
            <AutorisationsEditor embedded />
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
