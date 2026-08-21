"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { BrandLoader } from "@/components/brand-loader";
import { formatFcfa } from "@/lib/format";
import type { Immobilisation, ImmobilisationKind } from "@/lib/types";
import { todayIsoDate } from "@/lib/zogbo-calc";

type TabKey = ImmobilisationKind;

type Draft = {
  name: string;
  qty: string;
  unit: string;
  cost: string;
  salePrice: string;
  date: string;
};

function emptyDraft(): Draft {
  return {
    name: "",
    qty: "1",
    unit: "pièce",
    cost: "",
    salePrice: "",
    date: todayIsoDate(),
  };
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
    () => (showInactive ? items : items.filter((i) => i.active)),
    [items, showInactive],
  );

  const totals = useMemo(() => {
    const inventaire = filtered.reduce(
      (s, i) => s + i.qty * i.cost,
      0,
    );
    const vente = filtered.reduce(
      (s, i) => s + i.qty * (i.salePrice ?? 0),
      0,
    );
    return { inventaire, vente };
  }, [filtered]);

  function startEdit(item: Immobilisation) {
    setEditId(item.id);
    setDraft({
      name: item.name,
      qty: String(item.qty),
      unit: item.unit || "pièce",
      cost: item.cost ? String(item.cost) : "",
      salePrice: item.salePrice != null ? String(item.salePrice) : "",
      date: item.date,
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
        qty: Math.round(Number(draft.qty) || 0),
        unit: draft.unit.trim() || "pièce",
        cost: Math.round(Number(draft.cost) || 0),
        salePrice: draft.salePrice
          ? Math.round(Number(draft.salePrice) || 0)
          : null,
        date: draft.date,
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
      const body = (await res.json()) as { item?: Immobilisation; error?: string };
      if (!res.ok) throw new Error(body.error || "Enregistrement impossible");
      const montant = payload.qty * payload.cost;
      const base = editId ? "Fiche mise à jour" : "Fiche créée";
      setFlash(
        montant > 0
          ? body.item?.depenseId
            ? `${base} — dépense de ${formatFcfa(montant)} créée à la caisse.`
            : `${base} — caisse fermée : aucune dépense liée.`
          : base,
      );
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
      setFlash(item.active ? "Désactivé" : "Réactivé");
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
      subtitle="Inventaire simple : date, produit, quantité, prix unitaire, valeur vente."
      actions={
        <Link href="/vente" className="btn btn-ghost">
          ← Vente
        </Link>
      }
    >
      <div className="immo-page">
        <div className="filters-row">
          <button
            type="button"
            className={`btn ${tab === "emballage" ? "btn-primary" : "btn-ghost"}`}
            onClick={() => {
              setTab("emballage");
              resetForm();
            }}
          >
            Emballages
          </button>
          <button
            type="button"
            className={`btn ${tab === "actif" ? "btn-primary" : "btn-ghost"}`}
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
            Les emballages actifs avec une valeur vente apparaissent sur{" "}
            <strong>Vente</strong> (Rapido) pour ajout au panier. Pour un
            emballage consommé en cuisine (non revendu), utilisez plutôt{" "}
            <Link href="/achats">Achats</Link>.
          </p>
        ) : (
          <p className="ui-info" role="note">
            Équipements et matériel durables (frigo, tables, balance…) — hors
            facturation caisse. Pour des ingrédients ou fournitures
            consommées au quotidien, utilisez <Link href="/achats">Achats</Link>.
          </p>
        )}

        <div className="immo-layout">
          <section className="panel immo-form-panel">
            <div className="panel-head">
              <h2 className="panel-title">
                {editId ? "Modifier" : "Nouvelle fiche"}
              </h2>
            </div>
            <div className="immo-form">
              <label className="date-field immo-field-full">
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
              <label className="date-field immo-field-full">
                <span>Nom du produit</span>
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
                <span>Quantité</span>
                <input
                  type="number"
                  min={1}
                  value={draft.qty}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, qty: e.target.value }))
                  }
                />
              </label>
              <label className="date-field">
                <span>Unité</span>
                <input
                  value={draft.unit}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, unit: e.target.value }))
                  }
                  placeholder="pièce, carton, kg…"
                  list="immo-unit-suggestions"
                  autoComplete="off"
                />
                <datalist id="immo-unit-suggestions">
                  <option value="pièce" />
                  <option value="carton" />
                  <option value="paquet" />
                  <option value="kg" />
                  <option value="litre" />
                  <option value="lot" />
                </datalist>
              </label>
              <label className="date-field">
                <span>Prix unitaire (FCFA)</span>
                <input
                  type="number"
                  min={0}
                  value={draft.cost}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, cost: e.target.value }))
                  }
                  placeholder="Coût inventaire"
                />
              </label>
              <label className="date-field">
                <span>Valeur (FCFA)</span>
                <input
                  type="number"
                  min={0}
                  value={draft.salePrice}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, salePrice: e.target.value }))
                  }
                  placeholder="Optionnel"
                />
              </label>
              <div className="immo-form-actions immo-field-full">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => void save()}
                >
                  {busy
                    ? "Enregistrement…"
                    : editId
                      ? "Enregistrer"
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

          <section className="panel immo-list-panel">
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

            {!loading && filtered.length > 0 ? (
              <p className="muted immo-totals">
                Total inventaire :{" "}
                <strong className="mono">
                  {formatFcfa(totals.inventaire)}
                </strong>
                {" · "}
                Total valeur :{" "}
                <strong className="mono">{formatFcfa(totals.vente)}</strong>
              </p>
            ) : null}

            {loading ? (
              <BrandLoader variant="ligne" label="Chargement…" />
            ) : filtered.length === 0 ? (
              <p className="muted immo-empty">Aucune fiche pour l’instant.</p>
            ) : (
              <div className="immo-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">Produit</th>
                      <th scope="col">Qté</th>
                      <th scope="col" className="col-money">
                        P.U. inventaire
                      </th>
                      <th scope="col" className="col-money">
                        Valeur
                      </th>
                      <th scope="col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((item) => (
                      <tr
                        key={item.id}
                        className={item.active ? undefined : "row-muted"}
                      >
                        <td className="mono">{item.date}</td>
                        <td>
                          {item.name}
                          {!item.active ? (
                            <span className="muted"> · désactivé</span>
                          ) : null}
                        </td>
                        <td>
                          <span className="mono">{item.qty}</span>{" "}
                          <span className="muted">{item.unit}</span>
                        </td>
                        <td className="mono col-money">
                          {formatFcfa(item.cost)}
                        </td>
                        <td className="mono col-money">
                          {item.salePrice != null
                            ? formatFcfa(item.salePrice)
                            : "—"}
                        </td>
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
              </div>
            )}
          </section>
        </div>
      </div>
    </AppShell>
  );
}
