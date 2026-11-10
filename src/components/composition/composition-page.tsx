"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { BrandLoader } from "@/components/brand-loader";
import { useSession } from "@/components/session-provider";
import "@/components/condiments/condiments.css";
import { canWriteStock } from "@/lib/auth-types";
import {
  baseVersRecette,
  ficheId,
  recetteVersBase,
  uniteRecette,
  type Fiche,
  type FicheMode,
  type FicheProductKind,
  type MagasinArticle,
} from "@/lib/magasin-calc";

const SITE = "gbegamey";
const API = `/api/composition?site=${SITE}`;

type Produit = { kind: FicheProductKind; id: string; name: string };
type Donnees = { articles: MagasinArticle[]; fiches: Fiche[]; produits: Produit[] };
type LigneDraft = { articleId: string; qty: string; supplement: boolean };
type Draft = { mode: FicheMode; portions: string; lines: LigneDraft[] };

const VIDE: Draft = { mode: "commande", portions: "", lines: [] };

function brouillon(fiche: Fiche | undefined, articles: MagasinArticle[]): Draft {
  if (!fiche) return VIDE;
  const unites = new Map(articles.map((a) => [a.id, a.unit]));
  return {
    mode: fiche.mode,
    portions: fiche.portions ? String(fiche.portions) : "",
    lines: fiche.lines.map((l) => ({
      articleId: l.articleId,
      qty: String(baseVersRecette(l.qty, unites.get(l.articleId) ?? "u")),
      supplement: l.supplement,
    })),
  };
}

export function CompositionPage() {
  const { user } = useSession();
  const readOnly = Boolean(user && !canWriteStock(user.role));
  const [data, setData] = useState<Donnees | null>(null);
  const [selected, setSelected] = useState<Produit | null>(null);
  const [draft, setDraft] = useState<Draft>(VIDE);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    let annule = false;
    async function charger() {
      try {
        const res = await fetch(API, { cache: "no-store" });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Chargement impossible.");
        if (!annule) setData(body as Donnees);
      } catch (e) {
        if (!annule) setError(e instanceof Error ? e.message : "Chargement impossible.");
      }
    }
    void charger();
    return () => {
      annule = true;
    };
  }, []);

  const fiches = useMemo(
    () => new Map((data?.fiches ?? []).map((f) => [f.id, f])),
    [data],
  );
  const articles = useMemo(() => data?.articles ?? [], [data]);
  const unites = useMemo(() => new Map(articles.map((a) => [a.id, a.unit])), [articles]);

  const produits = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.produits ?? []).filter((p) => !q || p.name.toLowerCase().includes(q));
  }, [data, search]);

  const ficheCourante = selected
    ? fiches.get(ficheId(SITE, selected.kind, selected.id))
    : undefined;

  function choisir(produit: Produit) {
    setSelected(produit);
    setFlash(null);
    setError(null);
    setDraft(brouillon(fiches.get(ficheId(SITE, produit.kind, produit.id)), articles));
  }

  function majLigne(index: number, patch: Partial<LigneDraft>) {
    setDraft((d) => ({
      ...d,
      lines: d.lines.map((l, i) => (i === index ? { ...l, ...patch } : l)),
    }));
  }

  async function envoyer(init: RequestInit, url: string, message: string) {
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      const res = await fetch(url, init);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Enregistrement impossible.");
      setData(body as Donnees);
      setFlash(message);
      return body as Donnees;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function enregistrer() {
    if (!selected) return;
    await envoyer(
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productKind: selected.kind,
          productId: selected.id,
          productName: selected.name,
          mode: draft.mode,
          portions: Number(draft.portions) || 0,
          lines: draft.lines.map((l) => ({
            articleId: l.articleId,
            qty: recetteVersBase(Number(l.qty) || 0, unites.get(l.articleId) ?? "u"),
            supplement: l.supplement,
          })),
        }),
      },
      API,
      "Composition enregistrée.",
    );
  }

  async function supprimer() {
    if (!ficheCourante || !window.confirm(`Supprimer la composition de ${ficheCourante.productName} ?`)) {
      return;
    }
    const res = await envoyer(
      { method: "DELETE" },
      `${API}&id=${encodeURIComponent(ficheCourante.id)}`,
      "Composition supprimée.",
    );
    if (res) setDraft(VIDE);
  }

  return (
    <AppShell
      title="Composition plat"
      subtitle="Les ingrédients de chaque plat et accompagnement de Gbégamey."
    >
      <div className="mag-page">
        {error ? (
          <p className="error-banner" role="alert">
            {error}
          </p>
        ) : null}
        {!data && !error ? <BrandLoader label="Chargement des compositions…" /> : null}
        {data ? (
          <div className="compo-layout">
            <section className="panel mag-card" aria-label="Produits">
              <label className="mag-field">
                Rechercher
                <input
                  className="mag-input"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <ul className="compo-list">
                {produits.map((p) => {
                  const fiche = fiches.get(ficheId(SITE, p.kind, p.id));
                  const actif = selected?.kind === p.kind && selected.id === p.id;
                  return (
                    <li key={`${p.kind}:${p.id}`}>
                      <button
                        type="button"
                        className={`compo-item${actif ? " is-active" : ""}`}
                        aria-pressed={actif}
                        onClick={() => choisir(p)}
                      >
                        <span>{p.name}</span>
                        <span className="muted">{fiche ? "✓" : ""}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>

            <section className="panel mag-card" aria-label="Fiche de composition">
              {!selected ? (
                <p className="mag-hint">Choisissez un plat ou un accompagnement.</p>
              ) : (
                <>
                  <h3>{selected.name}</h3>
                  {articles.length === 0 ? (
                    <p className="mag-hint">
                      Ajoutez d’abord vos ingrédients dans Stock Gbégamey, onglet Condiments.
                    </p>
                  ) : null}
                  <div className="mag-form">
                    <label className="mag-field">
                      Préparation
                      <select
                        className="select-input"
                        value={draft.mode}
                        disabled={readOnly}
                        onChange={(e) =>
                          setDraft((d) => ({ ...d, mode: e.target.value as FicheMode }))
                        }
                      >
                        <option value="commande">À la commande</option>
                        <option value="lot">En lot (marmite)</option>
                      </select>
                    </label>
                    {draft.mode === "lot" ? (
                      <label className="mag-field">
                        Portions par lot
                        <input
                          className="mag-input"
                          type="number"
                          min="1"
                          value={draft.portions}
                          disabled={readOnly}
                          onChange={(e) =>
                            setDraft((d) => ({ ...d, portions: e.target.value }))
                          }
                        />
                      </label>
                    ) : null}
                  </div>
                  <p className="mag-hint" style={{ marginTop: 12 }}>
                    {draft.mode === "lot"
                      ? "Quantités pour un lot complet. Les ingrédients sortent quand la cuisine déclare la production."
                      : "Quantités pour une portion. Les ingrédients sortent à chaque vente."}
                  </p>

                  {draft.lines.map((line, index) => (
                    <div className="mag-line" key={index}>
                      <select
                        className="select-input"
                        aria-label="Ingrédient"
                        value={line.articleId}
                        disabled={readOnly}
                        onChange={(e) => majLigne(index, { articleId: e.target.value })}
                      >
                        {articles.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                      <label className="mag-field">
                        {uniteRecette(unites.get(line.articleId) ?? "u")}
                        <input
                          className="mag-input"
                          type="number"
                          min="0"
                          step="any"
                          value={line.qty}
                          disabled={readOnly}
                          onChange={(e) => majLigne(index, { qty: e.target.value })}
                        />
                      </label>
                      <label className="mag-check">
                        <input
                          type="checkbox"
                          checked={line.supplement}
                          disabled={readOnly}
                          onChange={(e) => majLigne(index, { supplement: e.target.checked })}
                        />
                        Supplément
                      </label>
                      {readOnly ? null : (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() =>
                            setDraft((d) => ({
                              ...d,
                              lines: d.lines.filter((_, i) => i !== index),
                            }))
                          }
                        >
                          Retirer
                        </button>
                      )}
                    </div>
                  ))}

                  {readOnly ? null : (
                    <div className="compo-actions">
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={articles.length === 0}
                        onClick={() =>
                          setDraft((d) => ({
                            ...d,
                            lines: [
                              ...d.lines,
                              { articleId: articles[0]!.id, qty: "", supplement: false },
                            ],
                          }))
                        }
                      >
                        Ajouter un ingrédient
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={busy}
                        onClick={() => void enregistrer()}
                      >
                        {busy ? "…" : "Enregistrer"}
                      </button>
                      {ficheCourante ? (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          disabled={busy}
                          onClick={() => void supprimer()}
                        >
                          Supprimer la fiche
                        </button>
                      ) : null}
                    </div>
                  )}
                  {flash ? (
                    <p className="ui-info" role="status">
                      {flash}
                    </p>
                  ) : null}
                </>
              )}
            </section>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
