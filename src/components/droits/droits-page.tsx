"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { BrandLoader } from "@/components/brand-loader";
import {
  ROLE_LABELS,
  SITE_LABELS,
  type AppUser,
  type UserRole,
} from "@/lib/auth-types";
import {
  USER_ROLES,
  VENTE_POLICY_ACTIONS,
  VENTE_POLICY_ACTION_LABELS,
  type SiteRolesConfig,
  type UserSiteOverrides,
  type VentePolicyAction,
} from "@/lib/site-roles-model";
import type { VenteSite } from "@/lib/types";
import "@/components/journal-ventes/journal-ventes-page.css";

type Vue = "role" | "site" | "compte";
type Config = SiteRolesConfig & { users: Record<string, UserSiteOverrides> };

const SITES: VenteSite[] = ["zogbo", "gbegamey"];
const ROLES_REGLABLES = USER_ROLES.filter((r) => r !== "admin");

export function DroitsPage() {
  const [vue, setVue] = useState<Vue>("role");
  const [config, setConfig] = useState<Config | null>(null);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [userId, setUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cfgRes, usersRes] = await Promise.all([
        fetch("/api/site-roles", { cache: "no-store" }),
        fetch("/api/admin/users", { cache: "no-store" }),
      ]);
      const cfg = await cfgRes.json();
      const usr = await usersRes.json();
      if (!cfgRes.ok) throw new Error(cfg.error || "Chargement impossible.");
      if (!usersRes.ok) throw new Error(usr.error || "Chargement impossible.");
      setConfig({ ...(cfg as SiteRolesConfig), users: cfg.users ?? {} });
      const list = (usr.users as AppUser[]).filter((u) => u.role !== "admin");
      setUsers(list);
      setUserId((prev) => prev || list[0]?.id || "");
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Chargement initial.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const user = useMemo(() => users.find((u) => u.id === userId) ?? null, [users, userId]);

  function toggleRole(role: UserRole, action: VentePolicyAction) {
    if (!config) return;
    setConfig({
      ...config,
      roles: {
        ...config.roles,
        [role]: { ...config.roles[role], [action]: !config.roles[role][action] },
      },
    });
    setDirty(true);
  }

  function toggleSite(site: VenteSite, action: VentePolicyAction) {
    if (!config) return;
    setConfig({
      ...config,
      sites: {
        ...config.sites,
        [site]: { ...config.sites[site], [action]: !config.sites[site][action] },
      },
    });
    setDirty(true);
  }

  /** valeur : true / false = droit propre au compte ; undefined = hérité. */
  function setOverride(
    id: string,
    site: VenteSite,
    action: VentePolicyAction,
    value: boolean | undefined,
  ) {
    if (!config) return;
    const mine: UserSiteOverrides = { ...(config.users[id] ?? {}) };
    const perms = { ...(mine[site] ?? {}) };
    if (value === undefined) delete perms[action];
    else perms[action] = value;
    if (Object.keys(perms).length) mine[site] = perms;
    else delete mine[site];
    const nextUsers = { ...config.users };
    if (Object.keys(mine).length) nextUsers[id] = mine;
    else delete nextUsers[id];
    setConfig({ ...config, users: nextUsers });
    setDirty(true);
  }

  async function save() {
    if (!config) return;
    setSaving(true);
    setError(null);
    setFlash(null);
    try {
      const res = await fetch("/api/site-roles", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sites: config.sites,
          roles: config.roles,
          users: config.users,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Enregistrement impossible.");
      setConfig({ ...(body as SiteRolesConfig), users: body.users ?? {} });
      setDirty(false);
      setFlash("Droits enregistrés.");
      window.setTimeout(() => setFlash(null), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  const head = (
    <tr>
      <th>{vue === "role" ? "Rôle" : vue === "site" ? "Site" : "Site"}</th>
      {VENTE_POLICY_ACTIONS.map((a) => (
        <th key={a} className="num">
          {VENTE_POLICY_ACTION_LABELS[a].label}
        </th>
      ))}
    </tr>
  );

  return (
    <AppShell title="Droits" mainClassName="main-droits main-journal-ventes">
      <div className="equipe-mail">
        <div className="section-tabs" role="tablist" aria-label="Droits">
          {(
            [
              ["role", "Par rôle"],
              ["site", "Par site"],
              ["compte", "Par compte"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={vue === id}
              className={`section-tab${vue === id ? " is-active" : ""}`}
              onClick={() => setVue(id)}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            className="btn btn-primary"
            style={{ marginLeft: "auto" }}
            disabled={!dirty || saving}
            onClick={() => void save()}
          >
            {saving ? "…" : "Enregistrer"}
          </button>
        </div>

        {flash ? (
          <p className="equipe-flash" role="status">
            {flash}
          </p>
        ) : null}
        {error ? (
          <p className="error-banner" role="alert">
            {error}
          </p>
        ) : null}

        {loading || !config ? (
          <BrandLoader variant="ligne" label="Chargement des droits…" />
        ) : null}

        {config && vue === "role" ? (
          <section className="equipe-mail-panel">
            <div className="table-scroll">
              <table className="data-table">
                <thead>{head}</thead>
                <tbody>
                  {ROLES_REGLABLES.map((role) => (
                    <tr key={role}>
                      <td>
                        <strong>{ROLE_LABELS[role]}</strong>
                      </td>
                      {VENTE_POLICY_ACTIONS.map((a) => (
                        <td key={a} className="num">
                          <Switch
                            on={config.roles[role][a]}
                            onClick={() => toggleRole(role, a)}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr>
                    <td>
                      <strong>{ROLE_LABELS.admin}</strong>
                    </td>
                    <td colSpan={VENTE_POLICY_ACTIONS.length} className="muted">
                      Tous les droits
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {config && vue === "site" ? (
          <section className="equipe-mail-panel">
            <div className="table-scroll">
              <table className="data-table">
                <thead>{head}</thead>
                <tbody>
                  {SITES.map((site) => (
                    <tr key={site}>
                      <td>
                        <strong>{SITE_LABELS[site]}</strong>
                      </td>
                      {VENTE_POLICY_ACTIONS.map((a) => (
                        <td key={a} className="num">
                          <Switch
                            on={config.sites[site][a]}
                            onClick={() => toggleSite(site, a)}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {config && vue === "compte" ? (
          <section className="equipe-mail-panel">
            <div className="equipe-mail-add">
              <label>
                <span>Compte</span>
                <select value={userId} onChange={(e) => setUserId(e.target.value)}>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} (@{u.username}) · {ROLE_LABELS[u.role]} · {SITE_LABELS[u.site]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {user ? (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>{head}</thead>
                  <tbody>
                    {SITES.map((site) => (
                      <tr key={site}>
                        <td>
                          <strong>{SITE_LABELS[site]}</strong>
                        </td>
                        {VENTE_POLICY_ACTIONS.map((a) => {
                          const own = config.users[user.id]?.[site]?.[a];
                          const inherited =
                            config.sites[site][a] && config.roles[user.role][a];
                          return (
                            <td key={a} className="num">
                              <Tri
                                value={own}
                                inherited={inherited}
                                onChange={(v) => setOverride(user.id, site, a, v)}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">Aucun compte.</p>
            )}
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}

function Switch({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`btn${on ? " btn-primary" : ""}`}
      aria-pressed={on}
      onClick={onClick}
    >
      {on ? "Oui" : "Non"}
    </button>
  );
}

function Tri({
  value,
  inherited,
  onChange,
}: {
  value: boolean | undefined;
  inherited: boolean;
  onChange: (v: boolean | undefined) => void;
}) {
  const opts: [boolean | undefined, string][] = [
    [undefined, `Hérité · ${inherited ? "Oui" : "Non"}`],
    [true, "Oui"],
    [false, "Non"],
  ];
  return (
    <div className="jv-seg" role="group">
      {opts.map(([v, label]) => (
        <button
          key={label}
          type="button"
          className={`jv-seg-btn${value === v ? " is-active" : ""}`}
          aria-pressed={value === v}
          onClick={() => onChange(v)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
