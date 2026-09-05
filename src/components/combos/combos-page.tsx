"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { BrandLoader } from "@/components/brand-loader";
import { formatFcfa } from "@/lib/format";
import { newComboId } from "@/lib/combos-model";
import type { ComboComponent, ComboDish } from "@/lib/types";

type CatalogItem = { id: string; name: string; unitPrice: number };
type ComboView = ComboDish & {
  prixNormal: number;
  economie: number;
  componentsDetail: Array<
    ComboComponent & { name: string; unitPrice: number }
  >;
};

type Board = {
  combos: ComboView[];
  catalog: {
    plats: CatalogItem[];
    locaux: CatalogItem[];
    boissons: CatalogItem[];
  };
  canEdit: boolean;
};

const EMPTY_DRAFT = (): ComboDish => ({
  id: "",
  name: "",
  unitPrice: 0,
  components: [],
  active: true,
  imageUrl: null,
});

export function CombosPage() {
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [editing, setEditing] = useState<ComboDish | null>(null);
  const [pickKind, setPickKind] = useState<ComboComponent["kind"]>("plat");
  const [pickId, setPickId] = useState("");
  const [pickQty, setPickQty] = useState("1");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/combos", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Erreur");
      setBoard(body as Board);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const pickList = useMemo(() => {
    if (!board) return [];
    if (pickKind === "plat") return board.catalog.plats;
    if (pickKind === "local") return board.catalog.locaux;
    return board.catalog.boissons;
  }, [board, pickKind]);

  function startCreate() {
    setEditing(EMPTY_DRAFT());
    setPickId("");
    setPickQty("1");
  }

  function startEdit(c: ComboView) {
    setEditing({
      id: c.id,
      name: c.name,
      unitPrice: c.unitPrice,
      components: c.components.map((x) => ({ ...x })),
      active: c.active,
      imageUrl: c.imageUrl ?? null,
      baseDishName: c.baseDishName ?? null,
      costPrice: c.costPrice,
      alertThreshold: c.alertThreshold,
    });
  }

  function addComponent() {
    if (!editing || !pickId) return;
    const qty = Math.max(1, Math.round(Number(pickQty) || 1));
    const existing = editing.components.findIndex(
      (c) => c.kind === pickKind && c.productId === pickId,
    );
    const next = [...editing.components];
    if (existing >= 0) {
      next[existing] = {
        ...next[existing],
        qty: next[existing].qty + qty,
      };
    } else {
      next.push({ kind: pickKind, productId: pickId, qty });
    }
    setEditing({ ...editing, components: next });
  }

  function removeComponent(idx: number) {
    if (!editing) return;
    setEditing({
      ...editing,
      components: editing.components.filter((_, i) => i !== idx),
    });
  }

  async function saveEditing() {
    if (!board || !editing) return;
    if (!editing.name.trim()) {
      setError("Nom du combo requis.");
      return;
    }
    if (!editing.components.length) {
      setError("Ajoutez au moins un produit.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const id = editing.id || newComboId(editing.name);
      const nextList: ComboDish[] = board.combos
        .filter((c) => c.id !== id)
        .map((c) => ({
          id: c.id,
          name: c.name,
          unitPrice: c.unitPrice,
          components: c.components,
          active: c.active,
          imageUrl: c.imageUrl ?? null,
          baseDishName: c.baseDishName ?? null,
          costPrice: c.costPrice,
          alertThreshold: c.alertThreshold,
        }));
      nextList.push({
        ...editing,
        id,
        name: editing.name.trim(),
        unitPrice: Math.max(0, Math.round(Number(editing.unitPrice) || 0)),
      });
      const res = await fetch("/api/combos", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ combos: nextList }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Échec enregistrement");
      setEditing(null);
      setFlash("Combo enregistré.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(c: ComboView) {
    if (!board?.canEdit) return;
    setBusy(true);
    try {
      const nextList = board.combos.map((x) =>
        x.id === c.id
          ? {
              id: x.id,
              name: x.name,
              unitPrice: x.unitPrice,
              components: x.components,
              active: !x.active,
              imageUrl: x.imageUrl ?? null,
              baseDishName: x.baseDishName ?? null,
              costPrice: x.costPrice,
              alertThreshold: x.alertThreshold,
            }
          : {
              id: x.id,
              name: x.name,
              unitPrice: x.unitPrice,
              components: x.components,
              active: x.active,
              imageUrl: x.imageUrl ?? null,
              baseDishName: x.baseDishName ?? null,
              costPrice: x.costPrice,
              alertThreshold: x.alertThreshold,
            },
      );
      const res = await fetch("/api/combos", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ combos: nextList }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Échec");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec");
    } finally {
      setBusy(false);
    }
  }

  async function removeCombo(c: ComboView) {
    if (!board?.canEdit) return;
    if (!window.confirm(`Supprimer le combo « ${c.name} » ?`)) return;
    setBusy(true);
    try {
      const nextList = board.combos
        .filter((x) => x.id !== c.id)
        .map((x) => ({
          id: x.id,
          name: x.name,
          unitPrice: x.unitPrice,
          components: x.components,
          active: x.active,
          imageUrl: x.imageUrl ?? null,
          baseDishName: x.baseDishName ?? null,
          costPrice: x.costPrice,
          alertThreshold: x.alertThreshold,
        }));
      const res = await fetch("/api/combos", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ combos: nextList }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Échec");
      setFlash("Combo supprimé.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec");
    } finally {
      setBusy(false);
    }
  }

  function componentLabel(comp: ComboComponent): string {
    const fromDetail = board?.combos
      .flatMap((c) => c.componentsDetail)
      .find((d) => d.kind === comp.kind && d.productId === comp.productId);
    if (fromDetail) return fromDetail.name;
    const list =
      comp.kind === "plat"
        ? board?.catalog.plats
        : comp.kind === "local"
          ? board?.catalog.locaux
          : board?.catalog.boissons;
    return list?.find((x) => x.id === comp.productId)?.name ?? comp.productId;
  }

  return (
    <AppShell
      title="Combos"
      subtitle="Formules multi-produits · stock des composants décrémenté à la vente"
      actions={
        board?.canEdit ? (
          <button type="button" className="btn btn-primary" onClick={startCreate}>
            Nouveau combo
          </button>
        ) : undefined
      }
    >
      <div className="combos-page">
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
        {busy ? <BrandLoader variant="voile" label="Enregistrement…" /> : null}
        {loading && !board ? (
          <BrandLoader label="Chargement des combos…" />
        ) : null}

        {editing ? (
          <section className="combos-editor panel">
            <header className="combos-editor-head">
              <h2>{editing.id ? "Modifier le combo" : "Nouveau combo"}</h2>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setEditing(null)}
              >
                Fermer
              </button>
            </header>
            <div className="combos-form-grid">
              <label className="caisse-field">
                <span>Nom</span>
                <input
                  value={editing.name}
                  onChange={(e) =>
                    setEditing({ ...editing, name: e.target.value })
                  }
                  placeholder="Ex. Menu poisson + riz"
                />
              </label>
              <label className="caisse-field">
                <span>Prix combo (FCFA)</span>
                <input
                  type="number"
                  min={0}
                  value={editing.unitPrice}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      unitPrice: Number(e.target.value) || 0,
                    })
                  }
                />
              </label>
              <label className="caisse-field combos-check">
                <input
                  type="checkbox"
                  checked={editing.active}
                  onChange={(e) =>
                    setEditing({ ...editing, active: e.target.checked })
                  }
                />
                <span>Actif (vendable)</span>
              </label>
            </div>

            <div className="combos-add-row">
              <select
                value={pickKind}
                onChange={(e) => {
                  setPickKind(e.target.value as ComboComponent["kind"]);
                  setPickId("");
                }}
              >
                <option value="plat">Plat</option>
                <option value="local">Accompagnement</option>
                <option value="boisson">Boisson</option>
              </select>
              <select
                value={pickId}
                onChange={(e) => setPickId(e.target.value)}
              >
                <option value="">Choisir un produit…</option>
                {pickList.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {formatFcfa(p.unitPrice)}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                value={pickQty}
                onChange={(e) => setPickQty(e.target.value)}
                aria-label="Quantité"
                className="combos-qty"
              />
              <button
                type="button"
                className="btn btn-ghost"
                disabled={!pickId}
                onClick={addComponent}
              >
                Ajouter
              </button>
            </div>

            {!editing.components.length ? (
              <p className="muted">Aucun composant — ajoutez des produits.</p>
            ) : (
              <ul className="combos-components">
                {editing.components.map((c, i) => (
                  <li key={`${c.kind}-${c.productId}-${i}`}>
                    <span>
                      {componentLabel(c)} × {c.qty}
                    </span>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => removeComponent(i)}
                    >
                      Retirer
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="combos-editor-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void saveEditing()}
              >
                Enregistrer
              </button>
            </div>
          </section>
        ) : null}

        <section className="combos-list">
          {!board?.combos.length && !loading ? (
            <p className="muted">
              Aucun combo pour l&apos;instant. Créez une formule pour la proposer
              à la vente.
            </p>
          ) : (
            <div className="combos-grid">
              {board?.combos.map((c) => (
                <article
                  key={c.id}
                  className={`combos-card${c.active ? "" : " is-inactive"}`}
                >
                  <header>
                    <h3>{c.name}</h3>
                    <span
                      className={`caisse-pill${c.active ? " is-open" : ""}`}
                    >
                      {c.active ? "Actif" : "Inactif"}
                    </span>
                  </header>
                  <p className="combos-price mono">
                    {formatFcfa(c.unitPrice)}
                    {c.economie > 0 ? (
                      <span className="combos-eco">
                        {" "}
                        · éco. {formatFcfa(c.economie)}
                      </span>
                    ) : null}
                  </p>
                  <p className="muted combos-normal">
                    Prix normal {formatFcfa(c.prixNormal)}
                  </p>
                  <ul className="combos-comp-list">
                    {c.componentsDetail.map((d) => (
                      <li key={`${d.kind}-${d.productId}`}>
                        {d.name} × {d.qty}
                      </li>
                    ))}
                  </ul>
                  {board.canEdit ? (
                    <div className="combos-card-actions">
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => startEdit(c)}
                      >
                        Modifier
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => void toggleActive(c)}
                      >
                        {c.active ? "Désactiver" : "Activer"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => void removeCombo(c)}
                      >
                        Supprimer
                      </button>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
