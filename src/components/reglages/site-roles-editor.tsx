"use client";

import { useEffect, useState } from "react";
import { BrandLoader } from "@/components/brand-loader";
import { formatUpdatedAt } from "@/lib/format";
import { ROLE_LABELS, SITE_LABELS, type UserRole } from "@/lib/auth-types";
import {
  USER_ROLES,
  VENTE_POLICY_ACTIONS,
  VENTE_POLICY_ACTION_LABELS,
  type SiteRolesConfig,
  type VentePolicyAction,
  type VentePolicyPermissions,
} from "@/lib/site-roles-model";
import type { VenteSite } from "@/lib/types";

const SITES: VenteSite[] = ["zogbo", "gbegamey"];

type ApiPayload = SiteRolesConfig & {
  roleLabels?: Record<UserRole, string>;
  error?: string;
};

type Props = {
  onSaved?: () => void;
};

export function SiteRolesEditor({ onSaved }: Props) {
  const [data, setData] = useState<ApiPayload | null>(null);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/site-roles", { cache: "no-store" });
      const body = (await res.json()) as ApiPayload;
      if (!res.ok) throw new Error(body.error || "Erreur");
      setData(body);
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function toggleRole(role: UserRole, action: VentePolicyAction) {
    if (!data) return;
    setData({
      ...data,
      roles: {
        ...data.roles,
        [role]: {
          ...data.roles[role],
          [action]: !data.roles[role][action],
        },
      },
    });
    setDirty(true);
  }

  function toggleSite(site: VenteSite, action: VentePolicyAction) {
    if (!data) return;
    setData({
      ...data,
      sites: {
        ...data.sites,
        [site]: {
          ...data.sites[site],
          [action]: !data.sites[site][action],
        },
      },
    });
    setDirty(true);
  }

  async function save() {
    if (!data) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/site-roles", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sites: data.sites,
          roles: data.roles,
        }),
      });
      const body = (await res.json()) as ApiPayload;
      if (!res.ok) throw new Error(body.error || "Erreur");
      setData(body);
      setDirty(false);
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1800);
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSaving(false);
    }
  }

  if (loading || !data) {
    return <BrandLoader variant="ligne" label="Chargement des politiques…" />;
  }

  const roleLabels = data.roleLabels ?? ROLE_LABELS;

  return (
    <section className="stack-form">
      <div className="panel">
        <div className="panel-head">
          <div>
            <h2 className="panel-title">Droits par rôle</h2>
            <p className="muted">
              Pour chaque rôle, activez ou désactivez l’enregistrement des
              ventes, la modification, l’annulation et la suppression
              définitive. Ces réglages s’appliquent sur tous les sites
              accessibles au compte.
            </p>
          </div>
          <button
            type="button"
            className={`btn btn-primary${savedFlash ? " btn-saved" : ""}`}
            disabled={!dirty || saving}
            onClick={() => void save()}
          >
            {saving ? "…" : savedFlash ? "Enregistré" : "Enregistrer"}
          </button>
        </div>

        {data.updatedAt ? (
          <p className="param-meta muted">
            Dernière maj. {formatUpdatedAt(data.updatedAt)}
          </p>
        ) : null}
        {error ? <p className="error-banner">{error}</p> : null}

        <div className="site-roles-grid">
          {USER_ROLES.map((role) => (
            <PermissionsCard
              key={role}
              title={roleLabels[role]}
              permissions={data.roles[role]}
              onToggle={(action) => toggleRole(role, action)}
            />
          ))}
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <h2 className="panel-title">Restrictions par site</h2>
            <p className="muted">
              Coupure globale par point de vente : même un rôle autorisé ne
              pourra pas agir si l’action est désactivée ici pour ce site.
            </p>
          </div>
        </div>

        <div className="site-roles-grid">
          {SITES.map((site) => (
            <PermissionsCard
              key={site}
              title={SITE_LABELS[site]}
              permissions={data.sites[site]}
              onToggle={(action) => toggleSite(site, action)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function PermissionsCard({
  title,
  permissions,
  onToggle,
}: {
  title: string;
  permissions: VentePolicyPermissions;
  onToggle: (action: VentePolicyAction) => void;
}) {
  return (
    <article className="panel site-roles-card">
      <h3 className="panel-title">{title}</h3>
      <ul className="vente-log">
        {VENTE_POLICY_ACTIONS.map((action) => {
          const meta = VENTE_POLICY_ACTION_LABELS[action];
          const enabled = permissions[action];
          return (
            <li key={action}>
              <div>
                <strong>{meta.label}</strong>
                <div className="muted">{meta.hint}</div>
              </div>
              <button
                type="button"
                className={`btn${enabled ? " btn-primary" : ""}`}
                aria-pressed={enabled}
                onClick={() => onToggle(action)}
              >
                {enabled ? "Activé" : "Désactivé"}
              </button>
            </li>
          );
        })}
      </ul>
    </article>
  );
}
