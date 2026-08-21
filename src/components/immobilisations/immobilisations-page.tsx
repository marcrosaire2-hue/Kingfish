"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { BrandLoader } from "@/components/brand-loader";
import { formatFcfa } from "@/lib/format";
import type { Immobilisation, ImmobilisationKind, VenteSite } from "@/lib/types";
import { todayIsoDate } from "@/lib/zogbo-calc";

type TabKey = ImmobilisationKind;

type Draft = {
  name: string;
  cost: string;
  salePrice: string;
  date: string;
  site: "" | VenteSite;
  notes: string;
};

function emptyDraft(): Draft {
  return {
    name: "",
    cost: "",
    salePrice: "",
    date: todayIsoDate(),
    site: "",
    notes: "",
  };
}

function siteLabel(site: VenteSite | null): string {
  if (site === "zogbo") return "Zogbo";
  if (site === "gbegamey") return "Gbégamey";
  return "Les deux";
}

export function ImmobilisationsPage() {
  const [tab, setTab] = useState<TabKey>("emballage");
  const [items, setItems] = useState<Immobilisation[]>([]);
  const [draft, setDraft] = useState<Draft>(() => emptyDraft());
  const [editId, setEditId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ kind: tab });
      if (!showInactive) params.set("active", "1");
      const res = await fetch(`/api/immobilisations?${params}`, {
        cache: "no-store",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Erreur de chargement");
      setItems((body.items as Immobilisation[]) || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [tab, showInactive]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(
    () =>
      showInactive ? items : items.filter((i) => i.active),
    [items, showInactive],
  );

  function startEdit(item: Immobilisation) {
    setEditId(item.id);
    setDraft({
      name: item.name,
      cost: item.cost ? String(item.cost) : "",
      salePrice: item.salePrice != null ? String(item.salePrice) : "",
      date: item.date,
      site: item.site ?? "",
      notes: item.notes || "",
    });
    setFlash(null);
    setError(null);
  }

  function resetForm() {
    setEditId(null);
    setDraft(emptyDraft());
  }

  async function save() {
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      const payload = {
        name: draft.name,
        kind: tab,
        cost: Math.round(Number(draft.cost) || 0),
        salePrice:
          tab === "emballage"
            ? Math.round(Number(draft.salePrice) || 0)
            : draft.salePrice
              ? Math.round(Number(draft.salePrice) || 0)
              : null,
        date: draft.date,
        site: draft.site === "" ? null : draft.site,
        notes: draft.notes,
      };

      const res = await fetch("/api/immobilisations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          editId
            ? { action: "update", id: editId, ...payload }
            : { action: "create", ...payload },
        ),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Enregistrement impossible");
      setFlash(editId ? "Fiche mise à jour." : "Fiche créée.");
      resetForm();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(item: Immobilisation) {
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      const res = await fetch("/api/immobilisations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "setActive",
          id: item.id,
          active: !item.active,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Action impossible");
      setFlash(
        item.active
          ? `« ${item.name} » désactivé.`
          : `« ${item.name} » réactivé.`,
      );
      if (editId === item.id) resetForm();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action impossible");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell
      title="Immobilisations"
      subtitle="Équipements durables et emballages facturables à la vente (emporté)."
      actions={
        <Link href="/vente" className="btn btn-ghost">
          ← Vente
        </Link>
      }
    >
      <div className="section-tabs" role="tablist" aria-label="Type">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "emballage"}
          className={`section-tab${tab === "emballage" ? " is-active" : ""}`}
          onClick={() => {
            setTab("emballage");
            resetForm();
          }}
        >
          Emballages
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "actif"}
          className={`section-tab${tab === "actif" ? " is-active" : ""}`}
          onClick={() => {
            setTab("actif");
            resetForm();
          }}
        >
          Actifs / matériel
        </button>
      </div>

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

      {tab === "emballage" ? (
        <p className="ui-info" role="note">
          Les emballages actifs apparaissent sur l’écran <strong>Vente</strong>{" "}
          (surtout en mode Rapido) pour ajout manuel au panier.
        </p>
      ) : (
        <p className="ui-info" role="note">
          Registre des équipements et matériaux durables (frigo, tables,
          etc.) — hors facturation caisse.
        </p>
      )}

      <div className="admin-grid">
        <section className="panel">
          <div className="panel-head">
            <h2 className="panel-title">
              {editId ? "Modifier" : "Nouvelle fiche"}
            </h2>
          </div>
          <div className="admin-form">
            <label className="date-field">
              <span>Nom</span>
              <input
                value={draft.name}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, name: e.target.value }))
                }
                placeholder={
                  tab === "emballage"
                    ? "Ex. Boîte emporté, sachet…"
                    : "Ex. Frigo, table, balance…"
                }
              />
            </label>
            <label className="date-field">
              <span>Date</span>
              <input
                type="date"
                value={draft.date}
                max={todayIsoDate()}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, date: e.target.value }))
                }
              />
            </label>
            <label className="date-field">
              <span>Coût / valeur (FCFA)</span>
              <input
                type="number"
                min={0}
                value={draft.cost}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, cost: e.target.value }))
                }
              />
            </label>
            {tab === "emballage" ? (
              <label className="date-field">
                <span>Prix de vente (FCFA)</span>
                <input
                  type="number"
                  min={0}
                  value={draft.salePrice}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, salePrice: e.target.value }))
                  }
                  placeholder="Facturé en caisse"
                />
              </label>
            ) : null}
            <label className="date-field">
              <span>Site</span>
              <select
                className="select-input"
                value={draft.site}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    site: e.target.value as Draft["site"],
                  }))
                }
              >
                <option value="">Les deux</option>
                <option value="zogbo">Zogbo</option>
                <option value="gbegamey">Gbégamey</option>
              </select>
            </label>
            <label className="date-field">
              <span>Notes</span>
              <input
                value={draft.notes}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, notes: e.target.value }))
                }
                placeholder="Optionnel"
              />
            </label>
            <div className="filters-row">
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void save()}
              >
                {busy
                  ? "Enregistrement…"
                  : editId
                    ? "Enregistrer les modifications"
                    : "Créer"}
              </button>
              {editId ? (
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={busy}
                  onClick={resetForm}
                >
                  Annuler
                </button>
              ) : null}
            </div>
          </div>
        </section>

        <section className="panel panel-wide">
          <div className="panel-head">
            <h2 className="panel-title">
              {tab === "emballage" ? "Emballages" : "Actifs"}
            </h2>
            <label className="muted">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
              />{" "}
              Afficher désactivés
            </label>
          </div>

          {loading ? (
            <BrandLoader variant="ligne" label="Chargement…" />
          ) : filtered.length === 0 ? (
            <p className="muted">Aucune fiche pour l’instant.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Nom</th>
                  <th scope="col">Date</th>
                  <th scope="col">Site</th>
                  <th scope="col" className="col-money">
                    Coût
                  </th>
                  {tab === "emballage" ? (
                    <th scope="col" className="col-money">
                      Vente
                    </th>
                  ) : null}
                  <th scope="col">État</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr
                    key={item.id}
                    className={item.active ? undefined : "row-muted"}
                  >
                    <td>
                      {item.name}
                      {item.notes ? (
                        <span className="muted"> · {item.notes}</span>
                      ) : null}
                    </td>
                    <td className="mono">{item.date}</td>
                    <td>{siteLabel(item.site)}</td>
                    <td className="mono col-money">
                      {formatFcfa(item.cost)}
                    </td>
                    {tab === "emballage" ? (
                      <td className="mono col-money">
                        {formatFcfa(item.salePrice)}
                      </td>
                    ) : null}
                    <td>{item.active ? "Actif" : "Désactivé"}</td>
                    <td>
                      <button
                        type="button"
                        className="btn-link"
                        disabled={busy}
                        onClick={() => startEdit(item)}
                      >
                        Modifier
                      </button>
                      {" · "}
                      <button
                        type="button"
                        className="btn-link"
                        disabled={busy}
                        onClick={() => void toggleActive(item)}
                      >
                        {item.active ? "Désactiver" : "Réactiver"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </AppShell>
  );
}
