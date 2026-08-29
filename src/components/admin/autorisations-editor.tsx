"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BrandLoader } from "@/components/brand-loader";
import {
  PERMISSION_CATEGORY_LABELS,
  type PermissionAction,
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

const ACTIONS: PermissionAction[] = [
  "access",
  "view",
  "create",
  "update",
  "delete",
  "admin",
];

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
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<"all" | PermissionCategoryId>("all");
  const [onlyDenied, setOnlyDenied] = useState(false);
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

  function draftValue(
    resourceId: string,
    action: PermissionAction,
  ): PermissionValue | undefined {
    return draft.find(
      (o) =>
        o.targetType === targetMode &&
        o.targetId === targetId &&
        o.resourceId === resourceId,
    )?.actions?.[action];
  }

  function inheritedValue(
    resourceId: string,
    action: PermissionAction,
  ): PermissionValue {
    if (targetMode === "user") {
      const roleDraft = draft.find(
        (o) =>
          o.targetType === "role" &&
          o.targetId === roleOfTarget &&
          o.resourceId === resourceId,
      )?.actions?.[action];
      if (roleDraft === "allow" || roleDraft === "deny") return roleDraft;
    }
    const cell = data?.matrix
      .find((m) => m.resource.id === resourceId)
      ?.byRole?.[roleOfTarget]?.[action];
    if (cell?.value === "allow" || cell?.value === "deny") return cell.value;
    return "deny";
  }

  function selectValue(
    resourceId: string,
    action: PermissionAction,
  ): PermissionValue {
    return draftValue(resourceId, action) ?? "inherit";
  }

  function effectiveValue(
    resourceId: string,
    action: PermissionAction,
  ): PermissionValue {
    const d = draftValue(resourceId, action);
    if (d === "allow" || d === "deny") return d;
    return inheritedValue(resourceId, action);
  }

  function setCell(
    resource: PermissionResource,
    action: PermissionAction,
    value: PermissionValue,
  ) {
    setDirty(true);
    setDraft((prev) => {
      const idx = prev.findIndex(
        (o) =>
          o.targetType === targetMode &&
          o.targetId === targetId &&
          o.resourceId === resource.id,
      );
      if (value === "inherit") {
        if (idx < 0) return prev;
        const next = [...prev];
        const current = { ...next[idx]!, actions: { ...next[idx]!.actions } };
        delete current.actions[action];
        if (Object.keys(current.actions).length === 0) next.splice(idx, 1);
        else next[idx] = current;
        return next;
      }
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = {
          ...next[idx]!,
          actions: { ...next[idx]!.actions, [action]: value },
        };
        return next;
      }
      return [
        ...prev,
        {
          targetType: targetMode,
          targetId,
          resourceId: resource.id,
          actions: { [action]: value },
        },
      ];
    });
  }

  function bulkAccess(value: PermissionValue) {
    if (!data) return;
    setDirty(true);
    setDraft((prev) => {
      const keep = prev.filter(
        (o) => !(o.targetType === targetMode && o.targetId === targetId),
      );
      if (value === "inherit") return keep;
      const additions: PermissionOverride[] = [];
      for (const resource of data.resources) {
        if (category !== "all" && resource.category !== category) continue;
        if (q.trim()) {
          const hay = `${resource.label} ${resource.path}`.toLowerCase();
          if (!hay.includes(q.trim().toLowerCase())) continue;
        }
        additions.push({
          targetType: targetMode,
          targetId,
          resourceId: resource.id,
          actions: { access: value },
        });
      }
      return [...keep, ...additions];
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
            "Certaines permissions sensibles seraient refusées. Confirmer l’enregistrement ?",
          );
          if (ok) {
            await save(true);
            return;
          }
          throw new Error("Enregistrement annulé.");
        }
        throw new Error(body.error || "Enregistrement impossible");
      }
      setFlash(body.message || "Modifications enregistrées.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible");
    } finally {
      setSaving(false);
    }
  }

  const filteredResources = useMemo(() => {
    if (!data) return [];
    return data.resources.filter((r) => {
      if (category !== "all" && r.category !== category) return false;
      if (q.trim()) {
        const hay = `${r.label} ${r.path} ${r.description}`.toLowerCase();
        if (!hay.includes(q.trim().toLowerCase())) return false;
      }
      if (onlyDenied && effectiveValue(r.id, "access") !== "deny") return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, category, q, onlyDenied, draft, targetId, targetMode]);

  const grouped = useMemo(() => {
    const map = new Map<PermissionCategoryId, PermissionResource[]>();
    for (const r of filteredResources) {
      const list = map.get(r.category) ?? [];
      list.push(r);
      map.set(r.category, list);
    }
    return [...map.entries()];
  }, [filteredResources]);

  const targetLabel =
    targetMode === "role"
      ? (ROLE_LABELS[targetId as UserRole] ?? targetId)
      : (data?.users.find((u) => u.id === targetId)?.name ?? "Utilisateur");

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

  const saveActions = (
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

      {!embedded ? (
        <div className="panel panel-wide">
          <div className="panel-head">
            <div>
              <h2 className="panel-title">Autorisations</h2>
              <p className="muted">
                Gestion centralisée des accès aux pages et fonctionnalités.
              </p>
            </div>
            {saveActions}
          </div>
        </div>
      ) : null}

      <div className="panel admin-authz-filters">
        {embedded ? (
          <div className="panel-head admin-authz-head">
            <p className="muted admin-authz-lead">
              Accès aux pages et fonctionnalités par rôle ou par compte.
            </p>
            {saveActions}
          </div>
        ) : null}
        <div className="authz-toolbar hist-filters">
        <label className="date-field">
          <span>Cible</span>
          <select
            className="select-input"
            value={targetMode}
            onChange={(e) => {
              const mode = e.target.value as TargetMode;
              setTargetMode(mode);
              setTargetId(mode === "role" ? "gerant" : (data.users[0]?.id ?? ""));
            }}
          >
            <option value="role">Rôle</option>
            <option value="user">Utilisateur</option>
          </select>
        </label>
        <label className="date-field">
          <span>{targetMode === "role" ? "Rôle" : "Compte"}</span>
          <select
            className="select-input"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
          >
            {targetMode === "role"
              ? data.roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))
              : data.users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} (@{u.username}) · {ROLE_LABELS[u.role]}
                  </option>
                ))}
          </select>
        </label>
        <label className="date-field">
          <span>Recherche</span>
          <input
            type="search"
            className="select-input"
            placeholder="Page, fonctionnalité…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <label className="date-field">
          <span>Catégorie</span>
          <select
            className="select-input"
            value={category}
            onChange={(e) =>
              setCategory(e.target.value as "all" | PermissionCategoryId)
            }
          >
            <option value="all">Toutes</option>
            {(
              Object.keys(PERMISSION_CATEGORY_LABELS) as PermissionCategoryId[]
            ).map((c) => (
              <option key={c} value={c}>
                {PERMISSION_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="date-field authz-check">
          <span>Filtres</span>
          <label className="authz-checkbox">
            <input
              type="checkbox"
              checked={onlyDenied}
              onChange={(e) => setOnlyDenied(e.target.checked)}
            />
            Permissions refusées seulement
          </label>
        </label>
        </div>
      </div>

      <div className="authz-bulk">
        <span>
          Cible : <strong>{targetLabel}</strong>
          {dirty ? " · modifications non enregistrées" : ""}
        </span>
        <div className="authz-bulk-actions">
          <button type="button" className="btn btn-ghost" onClick={() => bulkAccess("allow")}>
            Autoriser (filtrés)
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => bulkAccess("deny")}>
            Refuser (filtrés)
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => bulkAccess("inherit")}>
            Hériter (filtrés)
          </button>
        </div>
      </div>

      {grouped.map(([cat, resources]) => (
        <section key={cat} className="panel authz-panel">
          <div className="panel-head">
            <h2 className="panel-title">{PERMISSION_CATEGORY_LABELS[cat]}</h2>
            <p className="muted">{resources.length} élément(s)</p>
          </div>
          <div className="table-wrap">
            <table className="data-table authz-table">
              <thead>
                <tr>
                  <th>Page / fonctionnalité</th>
                  <th>Accès</th>
                  <th>Voir</th>
                  <th>Créer</th>
                  <th>Modifier</th>
                  <th>Supprimer</th>
                  <th>Administrer</th>
                  <th>Statut</th>
                </tr>
              </thead>
              <tbody>
                {resources.map((resource) => {
                  const access = effectiveValue(resource.id, "access");
                  const drafted = draftValue(resource.id, "access");
                  return (
                    <tr key={resource.id}>
                      <td>
                        <strong>{resource.label}</strong>
                        <div className="muted authz-path">
                          {resource.path} — {resource.description}
                          {resource.sensitive ? " · sensible" : ""}
                        </div>
                      </td>
                      {ACTIONS.map((action) => {
                        if (!resource.actions.includes(action)) {
                          return (
                            <td key={action} className="muted">
                              —
                            </td>
                          );
                        }
                        const eff = effectiveValue(resource.id, action);
                        return (
                          <td key={action}>
                            <select
                              className={`select-input authz-select is-${eff}`}
                              value={selectValue(resource.id, action)}
                              onChange={(e) =>
                                setCell(
                                  resource,
                                  action,
                                  e.target.value as PermissionValue,
                                )
                              }
                            >
                              <option value="inherit">
                                Hériter ({eff === "allow" ? "oui" : "non"})
                              </option>
                              <option value="allow">Autoriser</option>
                              <option value="deny">Refuser</option>
                            </select>
                          </td>
                        );
                      })}
                      <td>
                        <span className={`authz-status is-${access}`}>
                          {access === "allow" ? "Autorisé" : "Refusé"}
                          {drafted ? " · modifié" : " · hérité/code"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Historique des modifications</h2>
          <p className="muted">
            v{data.config.version}
            {data.config.updatedAt
              ? ` · maj ${new Date(data.config.updatedAt).toLocaleString("fr-FR")}`
              : ""}
            {data.config.updatedBy ? ` · ${data.config.updatedBy.name}` : ""}
          </p>
        </div>
        {data.history.length === 0 ? (
          <p className="muted">Aucune modification enregistrée.</p>
        ) : (
          <ul className="authz-history">
            {data.history.map((h) => (
              <li key={h.id}>
                <strong>{new Date(h.at).toLocaleString("fr-FR")}</strong> —{" "}
                {h.summary}
                <span className="muted">
                  {" "}
                  · {h.actorName ?? "—"}
                  {h.actorUsername ? ` (@${h.actorUsername})` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
