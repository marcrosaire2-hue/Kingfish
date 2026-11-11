"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { BrandLoader } from "@/components/brand-loader";
import { useSession } from "@/components/session-provider";
import "./composition-page.css";
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
  type MagasinUnit,
} from "@/lib/magasin-calc";

const SITE = "gbegamey";
const API = `/api/composition?site=${SITE}`;

type Produit = { kind: FicheProductKind; id: string; name: string };
type Donnees = { articles: MagasinArticle[]; fiches: Fiche[]; produits: Produit[] };
type LigneDraft = { articleId: string; qty: string };
type Draft = { mode: FicheMode; portions: string; lines: LigneDraft[] };

// Par défaut, une portion par préparation : le plat apparaît dans Plats préparés.
const VIDE: Draft = { mode: "lot", portions: "1", lines: [] };

function brouillon(fiche: Fiche | undefined, articles: MagasinArticle[]): Draft {
  if (!fiche) return VIDE;
  const unites = new Map(articles.map((a) => [a.id, a.unit]));
  return {
    mode: fiche.mode,
    portions: fiche.portions ? String(fiche.portions) : "",
    lines: fiche.lines.map((l) => ({
      articleId: l.articleId,
      qty: String(baseVersRecette(l.qty, unites.get(l.articleId) ?? "u")),
    })),
  };
}

/**
 * Associe un picto / emoji culinaire selon le nom de l'ingrédient
 * (Farine -> 🌿, Œuf -> 🥩/🥚, Chapelure -> 🥣, etc.).
 */
function getCondimentEmoji(name?: string): string {
  if (!name) return "🌿";
  const n = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (n.includes("farine") || n.includes("ble") || n.includes("pain")) return "🌿";
  if (n.includes("oeuf") || n.includes("euf") || n.includes("egg")) return "🥩";
  if (n.includes("chapelure") || n.includes("cereale") || n.includes("semoule")) return "🥣";
  if (n.includes("huile") || n.includes("beurre") || n.includes("margarine") || n.includes("olive")) return "🧈";
  if (n.includes("sel") || n.includes("poivre") || n.includes("epice") || n.includes("curry") || n.includes("cube")) return "🧂";
  if (n.includes("piment") || n.includes("sauce")) return "🌶️";
  if (n.includes("oignon") || n.includes("echalote")) return "🧅";
  if (n.includes("ail")) return "🧄";
  if (n.includes("tomate")) return "🍅";
  if (n.includes("citron")) return "🍋";
  if (n.includes("legume") || n.includes("carotte") || n.includes("salade")) return "🥕";
  if (n.includes("poisson") || n.includes("crevette") || n.includes("crabe")) return "🐟";
  if (n.includes("viande") || n.includes("poulet") || n.includes("boeuf")) return "🥩";
  if (n.includes("lait") || n.includes("creme") || n.includes("fromage")) return "🥛";
  return "🌿";
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
  const [nouveauNom, setNouveauNom] = useState("");
  const [nouvelleUnite, setNouvelleUnite] = useState<MagasinUnit>("g");

  /** Crée le condiment au magasin puis l'ajoute à la fiche en cours. */
  async function creerCondiment() {
    const nom = nouveauNom.trim();
    if (!nom) return;
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      const res = await fetch("/api/magasin?site=gbegamey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "article", name: nom, unit: nouvelleUnite }),
      });
      const body = (await res.json()) as { error?: string; articles?: MagasinArticle[] };
      if (!res.ok) throw new Error(body.error || "Création impossible.");
      const cree = (body.articles ?? []).find(
        (a) => a.name.toLowerCase() === nom.replace(/\s+/g, " ").toLowerCase(),
      );
      const rechargement = await fetch(API, { cache: "no-store" });
      const donnees = await rechargement.json();
      if (!rechargement.ok) throw new Error(donnees.error || "Rechargement impossible.");
      setData(donnees as Donnees);
      if (cree) {
        setDraft((d) => ({ ...d, lines: [...d.lines, { articleId: cree.id, qty: "" }] }));
      }
      setNouveauNom("");
      setFlash(`${nom} créé et ajouté : indiquez sa quantité, puis enregistrez.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Création impossible.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    let annule = false;
    async function charger() {
      try {
        const res = await fetch(API, { cache: "no-store" });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Chargement impossible.");
        if (!annule) {
          const donnees = body as Donnees;
          setData(donnees);
          // Sélectionner par défaut le premier plat pour un rendu immédiat
          if (donnees.produits && donnees.produits.length > 0) {
            const premier = donnees.produits[0]!;
            const fichesMap = new Map((donnees.fiches ?? []).map((f) => [f.id, f]));
            setSelected(premier);
            setDraft(
              brouillon(
                fichesMap.get(ficheId(SITE, premier.kind, premier.id)),
                donnees.articles ?? [],
              ),
            );
          }
        }
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
      subtitle="Les condiments de chaque plat et accompagnement de Gbégamey."
      mainClassName="main-composition"
    >
      <div className="compo-container">
        {/* En-tête / Hero Banner moderne */}
        <header className="compo-hero" aria-label="Bannière Composition plat">
          <div className="compo-hero-content">
            <div className="compo-hero-icon" aria-hidden>
              <svg
                viewBox="0 0 24 24"
                width="28"
                height="28"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 2v20M2 2v8a4 4 0 0 0 4 4v8M6 2v6M10 2v6" />
              </svg>
            </div>
            <div className="compo-hero-text">
              <h1 className="compo-hero-title">Composition plat</h1>
              <p className="compo-hero-sub">
                Les condiments de chaque plat et accompagnement de Gbégamey.
              </p>
            </div>
          </div>

          <div className="compo-hero-deco" aria-hidden>
            {/* Toque de chef en filigrane */}
            <svg
              className="compo-hero-chef-hat"
              viewBox="0 0 64 64"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M16 46h32M18 46v6a2 2 0 0 0 2 2h24a2 2 0 0 0 2-2v-6M18 46c-6 0-10-4-10-10 0-5 3.5-9 8-9.8C16.8 22 20 18 25 18c2 0 4 .7 5.6 1.8C32.4 15 36.8 12 42 12c6.6 0 12 5.4 12 12 0 .7-.1 1.4-.2 2 4.6.8 8.2 4.8 8.2 9.8 0 5.5-4.5 10.2-10 10.2" />
            </svg>
            {/* Ligne courbe dorée */}
            <svg className="compo-hero-curve" viewBox="0 0 160 50" fill="none">
              <path
                d="M10 45 C 60 45, 110 35, 155 12"
                stroke="#f59e0b"
                strokeWidth="3.5"
                strokeLinecap="round"
              />
            </svg>
          </div>
        </header>

        {error ? (
          <div className="compo-error-banner" role="alert">
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>{error}</span>
          </div>
        ) : null}

        {!data && !error ? <BrandLoader label="Chargement des compositions…" /> : null}

        {data ? (
          <div className="compo-layout">
            {/* Colonne Gauche : Recherche & Liste des plats */}
            <aside className="compo-card compo-card-sidebar" aria-label="Liste des plats">
              <div className="compo-search-header">
                <svg
                  className="compo-search-title-icon"
                  viewBox="0 0 24 24"
                  width="22"
                  height="22"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <circle cx="11" cy="11" r="7" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <h2 className="compo-search-title">Rechercher</h2>
              </div>

              <div className="compo-search-field">
                <input
                  type="text"
                  className="compo-search-input"
                  placeholder="Tapez un plat..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Rechercher un plat"
                />
              </div>

              <ul className="compo-list" role="listbox" aria-label="Plats et accompagnements">
                {produits.map((p) => {
                  const fiche = fiches.get(ficheId(SITE, p.kind, p.id));
                  const actif = selected?.kind === p.kind && selected.id === p.id;
                  return (
                    <li key={`${p.kind}:${p.id}`}>
                      <button
                        type="button"
                        className={`compo-item${actif ? " is-active" : ""}`}
                        aria-selected={actif}
                        onClick={() => choisir(p)}
                      >
                        <span className="compo-item-name">{p.name}</span>
                        {fiche || actif ? (
                          <svg
                            className="compo-item-check"
                            viewBox="0 0 24 24"
                            width="18"
                            height="18"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden
                          >
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
                {produits.length === 0 ? (
                  <li className="compo-empty-list">Aucun plat trouvé</li>
                ) : null}
              </ul>
            </aside>

            {/* Colonne Droite : Fiche de composition */}
            <section
              className="compo-card compo-card-detail"
              aria-label="Fiche de composition du plat"
            >
              {!selected ? (
                <div className="compo-placeholder">
                  <div className="compo-placeholder-icon" aria-hidden>
                    <svg
                      viewBox="0 0 24 24"
                      width="34"
                      height="34"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M18 2v20M2 2v8a4 4 0 0 0 4 4v8M6 2v6M10 2v6" />
                    </svg>
                  </div>
                  <h3>Sélectionnez un plat ou un accompagnement</h3>
                  <p>
                    Choisissez un élément dans la liste de gauche pour configurer sa
                    composition et ses condiments.
                  </p>
                </div>
              ) : (
                <>
                  {/* Titre du plat avec badge icône */}
                  <div className="compo-detail-header">
                    <div className="compo-detail-badge" aria-hidden>
                      <svg
                        viewBox="0 0 24 24"
                        width="22"
                        height="22"
                        fill="none"
                        stroke="#ffffff"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M18 2v20M2 2v8a4 4 0 0 0 4 4v8M6 2v6M10 2v6" />
                      </svg>
                    </div>
                    <h2 className="compo-detail-title">{selected.name}</h2>
                  </div>

                  {/* Mode de préparation & Portions */}
                  <div className="compo-prep-row">
                    <div className="compo-field compo-field-mode">
                      <label htmlFor="compo-prep-mode" className="compo-field-label">
                        Préparation
                      </label>
                      <div className="compo-select-wrapper">
                        <select
                          id="compo-prep-mode"
                          className="compo-select"
                          value={draft.mode}
                          disabled={readOnly}
                          onChange={(e) =>
                            setDraft((d) => ({ ...d, mode: e.target.value as FicheMode }))
                          }
                        >
                          <option value="lot">Plat préparé à l’avance</option>
                          <option value="commande">À la commande</option>
                        </select>
                        <svg
                          className="compo-select-chevron"
                          viewBox="0 0 24 24"
                          width="16"
                          height="16"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden
                        >
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </div>
                    </div>

                    {draft.mode === "lot" ? (
                      <div className="compo-field compo-field-portions">
                        <label htmlFor="compo-prep-portions" className="compo-field-label">
                          Portions par préparation (1 si la fiche est par plat)
                        </label>
                        <input
                          id="compo-prep-portions"
                          className="compo-input"
                          type="number"
                          min="1"
                          value={draft.portions}
                          disabled={readOnly}
                          onChange={(e) =>
                            setDraft((d) => ({ ...d, portions: e.target.value }))
                          }
                        />
                      </div>
                    ) : null}
                  </div>

                  {/* Bandeau d'information */}
                  <div className="compo-info-box" role="status">
                    <svg
                      className="compo-info-icon"
                      viewBox="0 0 24 24"
                      width="20"
                      height="20"
                      fill="currentColor"
                      aria-hidden
                    >
                      <circle cx="12" cy="12" r="10" fill="currentColor" />
                      <path
                        d="M12 16v-4M12 8h.01"
                        stroke="#ffffff"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                    </svg>
                    <span className="compo-info-text">
                      {draft.mode === "lot"
                        ? "Quantités pour une préparation. Les condiments sortent quand la cuisine enregistre les plats préparés."
                        : "Quantités pour une portion. Les condiments sortent à chaque vente du plat."}
                    </span>
                  </div>

                  {/* Lignes de condiments */}
                  <div className="compo-lines-list">
                    {draft.lines.map((line, index) => {
                      const article = articles.find((a) => a.id === line.articleId);
                      const unit = uniteRecette(unites.get(line.articleId) ?? "u");
                      return (
                        <div className="compo-line-row" key={index}>
                          <div className="compo-line-icon" aria-hidden>
                            {getCondimentEmoji(article?.name)}
                          </div>

                          <div className="compo-line-select-wrap">
                            <select
                              className="compo-select"
                              aria-label="Condiment"
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
                            <svg
                              className="compo-select-chevron"
                              viewBox="0 0 24 24"
                              width="16"
                              height="16"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden
                            >
                              <polyline points="6 9 12 15 18 9" />
                            </svg>
                          </div>

                          <div className="compo-qty-cell">
                            <span className="compo-qty-badge">{unit}</span>
                            <input
                              className="compo-qty-input"
                              type="number"
                              min="0"
                              step="any"
                              aria-label={`Quantité en ${unit}`}
                              value={line.qty}
                              disabled={readOnly}
                              onChange={(e) => majLigne(index, { qty: e.target.value })}
                            />
                          </div>

                          {readOnly ? null : (
                            <button
                              type="button"
                              className="compo-btn-remove"
                              aria-label="Retirer ce condiment"
                              onClick={() =>
                                setDraft((d) => ({
                                  ...d,
                                  lines: d.lines.filter((_, i) => i !== index),
                                }))
                              }
                            >
                              <svg
                                viewBox="0 0 24 24"
                                width="16"
                                height="16"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden
                              >
                                <polyline points="3 6 5 6 21 6" />
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                <line x1="10" y1="11" x2="10" y2="17" />
                                <line x1="14" y1="11" x2="14" y2="17" />
                              </svg>
                              <span>Retirer</span>
                            </button>
                          )}
                        </div>
                      );
                    })}

                    {draft.lines.length === 0 ? (
                      <div className="compo-no-lines">
                        <p>Aucun condiment associé à ce plat pour le moment.</p>
                      </div>
                    ) : null}
                  </div>

                  {/* Barre d'actions (Ajouter, Enregistrer, Supprimer) */}
                  {readOnly ? null : (
                    <div className="compo-actions-bar">
                      <button
                        type="button"
                        className="compo-btn-add"
                        disabled={articles.length === 0}
                        onClick={() =>
                          setDraft((d) => ({
                            ...d,
                            lines: [
                              ...d.lines,
                              { articleId: articles[0]?.id ?? "", qty: "" },
                            ],
                          }))
                        }
                      >
                        <svg
                          viewBox="0 0 24 24"
                          width="18"
                          height="18"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden
                        >
                          <line x1="12" y1="5" x2="12" y2="19" />
                          <line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                        <span>Ajouter un condiment</span>
                      </button>

                      <button
                        type="button"
                        className="compo-btn-save"
                        disabled={busy}
                        onClick={() => void enregistrer()}
                      >
                        {busy ? "Enregistrement…" : "Enregistrer"}
                      </button>

                      {ficheCourante ? (
                        <button
                          type="button"
                          className="compo-btn-delete"
                          disabled={busy}
                          onClick={() => void supprimer()}
                        >
                          Supprimer la fiche
                        </button>
                      ) : null}
                    </div>
                  )}

                  {/* Condiment absent de la liste (création rapide) */}
                  {readOnly ? null : (
                    <details className="compo-create-accordion">
                      <summary className="compo-create-summary">
                        <span>+ Condiment absent de la liste ? Créer un nouveau condiment</span>
                      </summary>
                      <div className="compo-create-body">
                        <div className="compo-create-field">
                          <label htmlFor="compo-new-name" className="compo-field-label">
                            Nom du condiment
                          </label>
                          <input
                            id="compo-new-name"
                            className="compo-input"
                            placeholder="Ex. Huile d’arachide"
                            value={nouveauNom}
                            onChange={(e) => setNouveauNom(e.target.value)}
                          />
                        </div>
                        <div className="compo-create-field">
                          <label htmlFor="compo-new-unit" className="compo-field-label">
                            Compté en
                          </label>
                          <div className="compo-select-wrapper">
                            <select
                              id="compo-new-unit"
                              className="compo-select"
                              value={nouvelleUnite}
                              onChange={(e) => setNouvelleUnite(e.target.value as MagasinUnit)}
                            >
                              <option value="g">Grammes (g)</option>
                              <option value="kg">Kilos (kg)</option>
                              <option value="L">Litres (L)</option>
                              <option value="u">Pièces (u)</option>
                            </select>
                            <svg
                              className="compo-select-chevron"
                              viewBox="0 0 24 24"
                              width="16"
                              height="16"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden
                            >
                              <polyline points="6 9 12 15 18 9" />
                            </svg>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="compo-btn-create-submit"
                          disabled={busy || !nouveauNom.trim()}
                          onClick={() => void creerCondiment()}
                        >
                          Créer et ajouter
                        </button>
                      </div>
                    </details>
                  )}

                  {flash ? (
                    <div className="compo-flash-banner" role="status">
                      <svg
                        viewBox="0 0 24 24"
                        width="18"
                        height="18"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      <span>{flash}</span>
                    </div>
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
