"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BrandLoader } from "@/components/brand-loader";
import {
  PERMISSION_CATEGORY_LABELS,
  isAdminEquipeResource,
  type PermissionCategoryId,
  type PermissionOverride,
  type PermissionResource,
  type PermissionValue,
} from "@/lib/autorisations-model";
import { ROLE_LABELS, type UserRole } from "@/lib/auth-types";

type TargetMode = "role" | "user";

type MatrixCell = { value: PermissionValue; source: "user" | "role" | "inherit" };

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
  roles: Array<{ id: UserRole; label: string }>;
  users: Array<{
    id: string;
    username: string;
    name: string;
    role: UserRole;
    site: string;
    active: boolean;
  }>;
  matrix: Array<{
    resource: PermissionResource;
    byRole: Record<string, Record<string, MatrixCell>>;
  }>;
  actor: { id: string; username: string; name: string };
};

type Props = {
  embedded?: boolean;
};

export function AutorisationsEditor({ embedded = false }: Props) {
  const [data, setData] = useState<ApiPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const [targetMode, setTargetMode] = useState<TargetMode>("role");
  const [targetId, setTargetId] = useState<string>("gerant");
  const [draft, setDraft] = useState<PermissionOverride[]>([]);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/autorisations", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Chargement impossible");
      setData(body as ApiPayload);
      setDraft(body.config?.overrides ?? []);
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const roleOfTarget: UserRole = useMemo(() => {
    if (targetMode === "role") return targetId as UserRole;
    return data?.users.find((u) => u.id === targetId)?.role ?? "gerant";
  }, [data, targetId, targetMode]);

  function draftAccess(resourceId: string): PermissionValue | undefined {
    return draft.find(
      (o) =>
        o.targetType === targetMode &&
        o.targetId === targetId &&
        o.resourceId === resourceId,
    )?.actions?.access;
  }

  function inheritedAccess(resourceId: string): boolean {
    if (targetMode === "user") {
      const roleDraft = draft.find(
        (o) =>
          o.targetType === "role" &&
          o.targetId === roleOfTarget &&
          o.resourceId === resourceId,
      )?.actions?.access;
      if (roleDraft === "allow") return true;
      if (roleDraft === "deny") return false;
    }
    const cell = data?.matrix
      .find((m) => m.resource.id === resourceId)
      ?.byRole?.[roleOfTarget]?.access;
    return cell?.value === "allow";
  }

  /** Accès effectif (interrupteur allumé / éteint). */
  function isOn(resourceId: string): boolean {
    const d = draftAccess(resourceId);
    if (d === "allow") return true;
    if (d === "deny") return false;
    return inheritedAccess(resourceId);
  }

  function isAdminTarget(): boolean {
    if (targetMode === "role") return targetId === "admin";
    return roleOfTarget === "admin";
  }

  function equipeLock(resourceId: string): "on" | "off" | null {
    if (!isAdminEquipeResource(resourceId)) return null;
    return isAdminTarget() ? "on" : "off";
  }

  function toggleAccess(resource: PermissionResource) {
    if (equipeLock(resource.id)) return;
    const nextOn = !isOn(resource.id);
    setDirty(true);
    setDraft((prev) => {
      const without = prev.filter(
        (o) =>
          !(
            o.targetType === targetMode &&
            o.targetId === targetId &&
            o.resourceId === resource.id
          ),
      );
      // On mémorise seulement un override explicite (allow/deny),
      // pas d’héritage multi-actions : un clic = page on/off.
      return [
        ...without,
        {
          targetType: targetMode,
          targetId,
          resourceId: resource.id,
          actions: { access: nextOn ? "allow" : "deny" },
        },
      ];
    });
  }

  function setAllVisible(on: boolean) {
    if (!data) return;
    setDirty(true);
    setDraft((prev) => {
      const keep = prev.filter(
        (o) => !(o.targetType === targetMode && o.targetId === targetId),
      );
      const additions: PermissionOverride[] = data.resources.map((resource) => {
        const lock = equipeLock(resource.id);
        const access =
          lock === "on"
            ? ("allow" as const)
            : lock === "off"
              ? ("deny" as const)
              : on
                ? ("allow" as const)
                : ("deny" as const);
        return {
          targetType: targetMode,
          targetId,
          resourceId: resource.id,
          actions: { access },
        };
      });
      return [...keep, ...additions];
    });
  }

  async function save(confirmSensitive = false) {
    setSaving(true);
    setError(null);
    setFlash(null);
    try {
      // Ne garder que les overrides « access » (UI simplifiée).
      const overrides: PermissionOverride[] = [];
      for (const o of draft) {
        const access = o.actions.access;
        if (access !== "allow" && access !== "deny") continue;
        overrides.push({
          targetType: o.targetType,
          targetId: o.targetId,
          resourceId: o.resourceId,
          actions: { access },
        });
      }

      const res = await fetch("/api/autorisations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overrides, confirmSensitive }),
      });
      const body = await res.json();
      if (!res.ok) {
        if (body.requiresConfirm) {
          const ok = window.confirm(
            "Certaines pages sensibles seraient désactivées. Confirmer ?",
          );
          if (ok) {
            await save(true);
            return;
          }
          throw new Error("Enregistrement annulé.");
        }
        throw new Error(body.error || "Enregistrement impossible");
      }
      setFlash(
        body.message ||
          "Enregistré. Les comptes concernés doivent se reconnecter.",
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible");
    } finally {
      setSaving(false);
    }
  }

  const grouped = useMemo(() => {
    if (!data) return [] as Array<[PermissionCategoryId, PermissionResource[]]>;
    const map = new Map<PermissionCategoryId, PermissionResource[]>();
    for (const r of data.resources) {
      const list = map.get(r.category) ?? [];
      list.push(r);
      map.set(r.category, list);
    }
    return [...map.entries()];
  }, [data]);

  const targetLabel =
    targetMode === "role"
      ? (ROLE_LABELS[targetId as UserRole] ?? targetId)
      : (() => {
          const u = data?.users.find((x) => x.id === targetId);
          return u ? `${u.name} (@${u.username})` : "Utilisateur";
        })();

  if (loading && !data) {
    return (
      <section className="panel panel-wide">
        <BrandLoader label="Chargement des autorisations…" />
      </section>
    );
  }

  if (error && !data) {
    return (
      <section className="panel panel-wide">
        <p className="error-banner" role="alert">
          {error}
        </p>
      </section>
    );
  }

  if (!data) return null;

  const saveBar = (
    <div className="page-actions">
      <button
        type="button"
        className="btn btn-ghost"
        disabled={loading || saving || !dirty}
        onClick={() => {
          setDraft(data.config.overrides);
          setDirty(false);
        }}
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
    </div>
  );

  return (
    <section className="admin-authz-stack">
      {flash ? (
        <p className="ui-info" role="status">
          {flash}
        </p>
      ) : null}
      {error ? (
        <p className="error-banner" role="alert">
          {error}
        </p>
      ) : null}

      <div className="panel admin-authz-filters">
        <div className="panel-head admin-authz-head">
          <div>
            {!embedded ? <h2 className="panel-title">Autorisations</h2> : null}
            <p className="muted admin-authz-lead">
              Règle un rôle entier, ou une personne précise. Un clic = page
              activée / désactivée.
              {dirty ? " · modifications non enregistrées" : ""}
            </p>
          </div>
          {saveBar}
        </div>

        <div className="authz-target-tabs" role="tablist" aria-label="Cible">
          <button
            type="button"
            role="tab"
            aria-selected={targetMode === "role"}
            className={`authz-target-tab${targetMode === "role" ? " is-active" : ""}`}
            onClick={() => {
              setTargetMode("role");
              setTargetId("gerant");
            }}
          >
            Par rôle
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={targetMode === "user"}
            className={`authz-target-tab${targetMode === "user" ? " is-active" : ""}`}
            onClick={() => {
              setTargetMode("user");
              const first =
                data.users.find((u) => u.active)?.id ?? data.users[0]?.id ?? "";
              setTargetId(first);
            }}
          >
            Par personne
          </button>
        </div>

        {targetMode === "role" ? (
          <div className="authz-picker" role="listbox" aria-label="Rôles">
            {data.roles.map((r) => (
              <button
                key={r.id}
                type="button"
                role="option"
                aria-selected={targetId === r.id}
                className={`authz-picker-item${targetId === r.id ? " is-selected" : ""}`}
                onClick={() => setTargetId(r.id)}
              >
                <strong>{r.label}</strong>
                <span className="muted">Tous les comptes {r.label.toLowerCase()}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="authz-picker authz-picker-users" role="listbox" aria-label="Personnes">
            {data.users
              .filter((u) => u.active)
              .map((u) => (
                <button
                  key={u.id}
                  type="button"
                  role="option"
                  aria-selected={targetId === u.id}
                  className={`authz-picker-item${targetId === u.id ? " is-selected" : ""}`}
                  onClick={() => setTargetId(u.id)}
                >
                  <strong>{u.name}</strong>
                  <span className="muted">
                    @{u.username} · {ROLE_LABELS[u.role]}
                    {u.site && u.site !== "tous" ? ` · ${u.site}` : ""}
                  </span>
                </button>
              ))}
          </div>
        )}

        <div className="authz-bulk">
          <span>
            Pages pour <strong>{targetLabel}</strong>
            {targetMode === "user" ? (
              <span className="muted">
                {" "}
                (personnalisé — prime sur le rôle {ROLE_LABELS[roleOfTarget]})
              </span>
            ) : null}
          </span>
          <div className="authz-bulk-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setAllVisible(true)}
            >
              Tout activer
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setAllVisible(false)}
            >
              Tout désactiver
            </button>
          </div>
        </div>
      </div>

      {grouped.map(([cat, resources]) => (
        <section key={cat} className="panel authz-panel">
          <div className="panel-head">
            <h2 className="panel-title">{PERMISSION_CATEGORY_LABELS[cat]}</h2>
            <p className="muted">{resources.length} page(s)</p>
          </div>
          <ul className="authz-switch-list">
            {resources.map((resource) => {
              const lock = equipeLock(resource.id);
              const on =
                lock === "on" ? true : lock === "off" ? false : isOn(resource.id);
              return (
                <li key={resource.id} className="authz-switch-row">
                  <div className="authz-switch-copy">
                    <strong>{resource.label}</strong>
                    <span className="muted">
                      {lock === "on"
                        ? "Toujours actif pour les administrateurs."
                        : lock === "off"
                          ? "Réservé au rôle Administrateur. Le DAF n’est pas un administrateur."
                          : resource.description}
                    </span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-disabled={lock !== null}
                    disabled={lock !== null}
                    className={`authz-switch${on ? " is-on" : ""}`}
                    onClick={() => toggleAccess(resource)}
                  >
                    <span className="authz-switch-knob" aria-hidden />
                    <span className="authz-switch-label">
                      {on ? "Activé" : "Désactivé"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {data.history.length > 0 ? (
        <section className="panel">
          <div className="panel-head">
            <h2 className="panel-title">Dernières modifications</h2>
            <p className="muted">v{data.config.version}</p>
          </div>
          <ul className="authz-history">
            {data.history.slice(0, 5).map((h) => (
              <li key={h.id}>
                <strong>{new Date(h.at).toLocaleString("fr-FR")}</strong> —{" "}
                {h.summary}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}
