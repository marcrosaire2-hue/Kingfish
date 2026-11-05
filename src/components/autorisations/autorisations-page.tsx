"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { BrandLoader } from "@/components/brand-loader";
import {
  type PermissionOverride,
  type PermissionResource,
  type PermissionValue,
} from "@/lib/autorisations-model";
import {
  ROLE_LABELS,
  SITE_LABELS,
  filterNavKeysBySite,
  type UserRole,
  type UserSite,
} from "@/lib/auth-types";

type MatrixCell = { value: PermissionValue; source: "user" | "role" | "inherit" };

type ApiUser = {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  site: string;
  active: boolean;
};

type ApiPayload = {
  config: {
    version: number;
    overrides: PermissionOverride[];
    updatedAt: string | null;
    updatedBy: { id: string; name: string; username: string } | null;
  };
  history: Array<{
    id: string;
    at: string;
    actorName: string | null;
    actorUsername: string | null;
    summary: string;
  }>;
  resources: PermissionResource[];
  users: ApiUser[];
  matrix: Array<{
    resource: PermissionResource;
    byRole: Record<string, Record<string, MatrixCell>>;
  }>;
};

/** Pages réservées à l'administrateur : jamais proposées aux autres rôles. */
const ADMIN_ONLY = new Set(["admin", "autorisations", "droits", "alertes", "journal-direction"]);
/** Toujours ouverte pour un administrateur (Équipe). */
const ADMIN_LOCKED = new Set(["admin"]);

export function AutorisationsPage() {
  const [data, setData] = useState<ApiPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [draft, setDraft] = useState<PermissionOverride[]>([]);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/autorisations", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Chargement impossible");
      const payload = body as ApiPayload;
      setData(payload);
      setDraft(payload.config?.overrides ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(data?.config.overrides ?? []),
    [draft, data],
  );

  /** Colonnes : les pages du menu, dans l'ordre du catalogue. */
  const pages = useMemo(
    () => (data?.resources ?? []).filter((r) => !!r.navKey),
    [data],
  );

  const users = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return data.users
      .filter((u) =>
        needle
          ? `${u.name} ${u.username} ${ROLE_LABELS[u.role] ?? ""} ${u.site}`
              .toLowerCase()
              .includes(needle)
          : true,
      )
      .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
  }, [data, q]);

  /** La page existe-t-elle pour ce compte (rôle et site) ? */
  function applicable(user: ApiUser, page: PermissionResource): boolean {
    if (!page.navKey) return false;
    if (user.role !== "admin" && ADMIN_ONLY.has(page.id)) return false;
    return filterNavKeysBySite([page.navKey], user.role, user.site as UserSite).length > 0;
  }

  function userValue(userId: string, pageId: string): PermissionValue | undefined {
    return draft.find(
      (o) => o.targetType === "user" && o.targetId === userId && o.resourceId === pageId,
    )?.actions?.access;
  }

  /** Droit hérité du rôle (sans réglage propre au compte). */
  function roleAllowed(user: ApiUser, pageId: string): boolean {
    if (user.role === "admin" && ADMIN_LOCKED.has(pageId)) return true;
    const rv = draft.find(
      (o) => o.targetType === "role" && o.targetId === user.role && o.resourceId === pageId,
    )?.actions?.access;
    if (rv === "allow" || rv === "deny") return rv === "allow";
    return (
      data?.matrix.find((m) => m.resource.id === pageId)?.byRole?.[user.role]?.access
        ?.value === "allow"
    );
  }

  function allowed(user: ApiUser, pageId: string): boolean {
    if (user.role === "admin" && ADMIN_LOCKED.has(pageId)) return true;
    const v = userValue(user.id, pageId);
    if (v === "allow" || v === "deny") return v === "allow";
    return roleAllowed(user, pageId);
  }

  function toggle(user: ApiUser, pageId: string) {
    const wanted = !allowed(user, pageId);
    const value: PermissionValue =
      wanted === roleAllowed(user, pageId) ? "inherit" : wanted ? "allow" : "deny";
    setFlash(null);
    setDraft((prev) => {
      const idx = prev.findIndex(
        (o) => o.targetType === "user" && o.targetId === user.id && o.resourceId === pageId,
      );
      const next = [...prev];
      if (idx < 0) {
        if (value === "inherit") return prev;
        next.push({
          targetType: "user",
          targetId: user.id,
          resourceId: pageId,
          actions: { access: value },
        });
        return next;
      }
      const actions = { ...next[idx]!.actions };
      if (value === "inherit") delete actions.access;
      else actions.access = value;
      if (Object.keys(actions).length === 0) next.splice(idx, 1);
      else next[idx] = { ...next[idx]!, actions };
      return next;
    });
  }

  async function save(confirmSensitive = false) {
    setSaving(true);
    setError(null);
    setFlash(null);
    try {
      const res = await fetch("/api/autorisations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overrides: draft, confirmSensitive }),
      });
      const body = await res.json();
      if (!res.ok) {
        if (body.requiresConfirm) {
          const ok = window.confirm(
            "Vous retirez l’accès à une page sensible. Confirmer l’enregistrement ?",
          );
          if (ok) {
            await save(true);
            return;
          }
          throw new Error("Enregistrement annulé.");
        }
        throw new Error(body.error || "Enregistrement impossible");
      }
      await load();
      setFlash(body.message || "Modifications enregistrées.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell
      title="Autorisations"
      subtitle="Pour chaque utilisateur, autorisez ou non chaque page."
      actions={
        <>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={loading || saving || !dirty}
            onClick={() => data && setDraft(data.config.overrides)}
          >
            Annuler
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={loading || saving || !dirty}
            onClick={() => void save(false)}
          >
            {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
        </>
      }
    >
      {loading && !data ? <BrandLoader label="Chargement des autorisations…" /> : null}
      {error ? (
        <p className="error-banner" role="alert">
          {error}
        </p>
      ) : null}
      {flash ? (
        <p className="ui-info" role="status">
          {flash}
        </p>
      ) : null}

      {data ? (
        <section className="panel authz-grid-panel">
          <div className="authz-grid-toolbar">
            <input
              type="search"
              className="select-input"
              placeholder="Rechercher un utilisateur…"
              aria-label="Rechercher un utilisateur"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <span className="muted">
              {users.length} utilisateur(s) · {pages.length} page(s)
              {dirty ? " · modifications non enregistrées" : ""}
            </span>
          </div>

          <div className="authz-grid-scroll">
            <table className="authz-grid">
              <thead>
                <tr>
                  <th scope="col" className="authz-grid-user">
                    Utilisateur
                  </th>
                  {pages.map((p) => (
                    <th key={p.id} scope="col" title={p.description}>
                      {p.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className={u.active ? undefined : "is-inactive"}>
                    <th scope="row" className="authz-grid-user">
                      <strong>{u.name}</strong>
                      <span className="muted">
                        {ROLE_LABELS[u.role] ?? u.role} ·{" "}
                        {SITE_LABELS[u.site as UserSite] ?? u.site}
                        {u.active ? "" : " · inactif"}
                      </span>
                    </th>
                    {pages.map((p) => {
                      if (!applicable(u, p)) {
                        return (
                          <td key={p.id} className="authz-grid-na">
                            —
                          </td>
                        );
                      }
                      const ok = allowed(u, p.id);
                      const locked = u.role === "admin" && ADMIN_LOCKED.has(p.id);
                      return (
                        <td key={p.id}>
                          <button
                            type="button"
                            className={`authz-cell${ok ? " is-on" : " is-off"}`}
                            aria-pressed={ok}
                            aria-label={`${p.label} pour ${u.name} : ${ok ? "autorisé" : "non autorisé"}`}
                            disabled={locked}
                            onClick={() => toggle(u, p.id)}
                          >
                            {ok ? "Autorisé" : "Non autorisé"}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </AppShell>
  );
}
