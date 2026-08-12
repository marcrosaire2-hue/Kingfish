"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ExportExcelButton } from "@/components/export-excel-button";
import {
  ROLE_LABELS,
  SITE_LABELS,
  adminKindLabel,
  isGlobalAdmin,
  isPrincipalAdminAccount,
  roleSiteLabel,
  rolesCreatableBy,
  sitesCreatableBy,
  type AppUser,
  type SessionUser,
  type UserRole,
  type UserSite,
} from "@/lib/auth-types";
import { exportAdminUsersExcel } from "@/lib/page-exports";

const ALL_ROLES: UserRole[] = [
  "equipier",
  "vendeur",
  "cuisine",
  "gerant",
  "admin",
];

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

  const [form, setForm] = useState({
    username: "",
    name: "",
    password: "",
    role: "equipier" as UserRole,
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
          const role = roles.includes(f.role) ? f.role : (roles[0] ?? "equipier");
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
  const bulkExample = actorIsGlobal
    ? "paul;Paul D.;Paul123;vendeur;zogbo\naya;Aya S.;Aya1234;admin;gbegamey\nsuper;Aide globale;Super123;admin;tous"
    : `marie;Marie K.;Marie123;vendeur;${actor?.site ?? "gbegamey"}\nchef;Chef zone;Chef123;admin;${actor?.site ?? "gbegamey"}`;

  return (
    <AppShell
      title="Administration"
      subtitle={
        actor
          ? actorIsGlobal
            ? "Administrateur global — vous aidez toutes les zones et créez les admins de zone."
            : `${adminKindLabel(actor.site)} — comptes et accès limités à ${SITE_LABELS[actor.site]}.`
          : "Gestion des comptes et des zones."
      }
      actions={
        <ExportExcelButton
          onExport={() => exportAdminUsersExcel(users)}
          disabled={loading || users.length === 0}
        />
      }
    >
      {flash ? <p className="warn-inline">{flash}</p> : null}
      {error ? (
        <p className="error-banner" role="alert">
          {error}
        </p>
      ) : null}

      <div className="admin-site-banner">
        <strong>Deux niveaux d’administration.</strong>
        <ul className="admin-admin-levels">
          <li>
            <strong>Admin de zone</strong> (site Zogbo ou Gbégamey) — gère les
            comptes et l’activité de sa zone uniquement.
          </li>
          <li>
            <strong>Administrateur global</strong> (Les deux sites) — aide
            toutes les zones et peut créer les admins de chaque zone.
          </li>
        </ul>
        {!actorIsGlobal && actor ? (
          <p className="admin-zone-note">
            Vous êtes connecté comme {adminKindLabel(actor.site)}. Les comptes
            des autres zones et l’admin global ne sont pas visibles ici.
          </p>
        ) : null}
      </div>

      <div className="admin-grid">
        <section className="panel">
          <h2 className="panel-title">Nouvel utilisateur</h2>
          <form className="admin-form" onSubmit={createUser}>
            <label className="login-field">
              <span>Identifiant</span>
              <input
                value={form.username}
                onChange={(e) =>
                  setForm((f) => ({ ...f, username: e.target.value }))
                }
                required
                minLength={3}
                autoComplete="off"
              />
            </label>
            <label className="login-field">
              <span>Nom affiché</span>
              <input
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
                required
              />
            </label>
            <label className="login-field">
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
            <label className="login-field">
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
            <label className="login-field">
              <span>
                {form.role === "admin"
                  ? "Périmètre admin"
                  : "Site de rattachement"}
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
            <p className="muted admin-site-hint">
              {form.role === "admin"
                ? form.site === "tous"
                  ? "Admin global : voit et aide Zogbo + Gbégamey."
                  : `Admin de zone : uniquement ${SITE_LABELS[form.site]}.`
                : form.site === "tous"
                  ? "Accès aux deux zones."
                  : `Accès limité à ${SITE_LABELS[form.site]}.`}
            </p>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={saving}
            >
              {saving ? "Création…" : "Créer et préparer le suivant"}
            </button>
          </form>

          <div className="admin-legend">
            <p>
              <strong>Vendeur / Cuisine / Gérant</strong> — liés à leur site
            </p>
            <p>
              <strong>Admin de zone</strong> — admin limité à Zogbo ou Gbégamey
            </p>
            <p>
              <strong>Admin global</strong> — aide toutes les zones
            </p>
          </div>
        </section>

        <section className="panel panel-wide">
          <h2 className="panel-title">Création groupée</h2>
          <p className="muted admin-bulk-help">
            Une ligne par compte :{" "}
            <code>identifiant;nom;motdepasse;role;site</code>
            {!actorIsGlobal
              ? ` — site forcé côté serveur à ${SITE_LABELS[actor?.site ?? "gbegamey"]} si hors zone.`
              : null}
          </p>
          <form className="admin-form" onSubmit={createBulk}>
            <label className="login-field">
              <span>Liste des comptes</span>
              <textarea
                className="admin-bulk-textarea"
                rows={10}
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                placeholder={bulkExample}
              />
            </label>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={bulkBusy || !bulkText.trim()}
            >
              {bulkBusy ? "Création…" : "Créer tous les comptes"}
            </button>
          </form>
        </section>
      </div>

      <section className="panel panel-wide">
        <h2 className="panel-title">
          Utilisateurs ({users.length})
          {actor && !actorIsGlobal
            ? ` · ${SITE_LABELS[actor.site]}`
            : ""}
        </h2>
        {loading ? (
          <p className="muted" style={{ padding: "0.75rem 0.85rem" }}>
            Chargement…
          </p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Identifiant</th>
                <th>Nom</th>
                <th>Rôle / périmètre</th>
                <th>Site</th>
                <th>Actif</th>
                <th>Mot de passe</th>
                <th />
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
                  isPrincipalAdminAccount(u.username) && !actorIsGlobal;
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
                      {!isPrincipalAdminAccount(u.username) ? (
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
        )}
      </section>

      <section className="panel admin-hub">
        <h2 className="panel-title">Accès rapide</h2>
        <div className="admin-links">
          <a className="admin-link" href="/vente">
            Vente
          </a>
          <a className="admin-link" href="/parametres">
            Paramètres
          </a>
          {actorIsGlobal || actor?.site === "zogbo" ? (
            <a className="admin-link" href="/zogbo">
              Zogbo
            </a>
          ) : null}
          {actorIsGlobal || actor?.site === "gbegamey" ? (
            <a className="admin-link" href="/gbegamey">
              Gbégamey
            </a>
          ) : null}
          <a className="admin-link" href="/">
            Tableau de bord
          </a>
        </div>
      </section>
    </AppShell>
  );
}
