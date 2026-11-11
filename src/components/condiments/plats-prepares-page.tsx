"use client";

import { FormEvent, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { BrandLoader } from "@/components/brand-loader";
import { useSession } from "@/components/session-provider";
import { canWriteStock } from "@/lib/auth-types";
import { useMagasin } from "./condiments-panel";
import type { LigneStockMagasin } from "@/lib/magasin-repo";
import type { ProductionSaisie } from "@/lib/magasin-calc";
import "./plats-prepares.css";

const nombre = (n: number) =>
  n.toLocaleString("fr-FR", { maximumFractionDigits: 3 });

const dateCourte = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })
    : "—";

/**
 * Vignette gourmande circulaire pour chaque plat
 */
function DishThumb({ name }: { name: string }) {
  const n = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  if (n.includes("brochette") || n.includes("choucouya")) {
    return (
      <div className="plats-dish-thumb" aria-hidden>
        <svg viewBox="0 0 40 40" width="100%" height="100%">
          <rect width="40" height="40" fill="#fef3c7" />
          <path d="M8 32 L32 8" stroke="#78350f" strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="15" cy="25" r="4.5" fill="#b45309" stroke="#78350f" strokeWidth="1" />
          <circle cx="21" cy="19" r="4.5" fill="#d97706" stroke="#78350f" strokeWidth="1" />
          <circle cx="27" cy="13" r="4.5" fill="#b45309" stroke="#78350f" strokeWidth="1" />
          <circle cx="13" cy="27" r="1.5" fill="#22c55e" />
          <circle cx="23" cy="17" r="1.5" fill="#ef4444" />
        </svg>
      </div>
    );
  }

  if (n.includes("chawarma") || n.includes("wrap") || n.includes("roll")) {
    return (
      <div className="plats-dish-thumb" aria-hidden>
        <svg viewBox="0 0 40 40" width="100%" height="100%">
          <rect width="40" height="40" fill="#fef9c3" />
          <path d="M12 28 C 10 22, 22 10, 28 12 C 32 16, 26 30, 20 28 Z" fill="#fde047" stroke="#ca8a04" strokeWidth="1.5" />
          <path d="M18 20 C 16 16, 24 12, 26 14 C 28 18, 22 24, 18 20 Z" fill="#ea580c" />
          <circle cx="22" cy="17" r="2" fill="#22c55e" />
          <circle cx="20" cy="23" r="2" fill="#ef4444" />
        </svg>
      </div>
    );
  }

  // Plat de poisson par défaut
  return (
    <div className="plats-dish-thumb" aria-hidden>
      <svg viewBox="0 0 40 40" width="100%" height="100%">
        <rect width="40" height="40" fill="#e0f2fe" />
        <ellipse cx="20" cy="20" rx="15" ry="11" fill="#bae6fd" />
        <path d="M8 20 C 12 14, 26 14, 30 20 C 26 26, 12 26, 8 20 Z" fill="#0284c7" />
        <circle cx="25" cy="18" r="1.5" fill="#ffffff" />
        <circle cx="25.5" cy="18" r="0.8" fill="#0f172a" />
        <path d="M14 16 L12 24" stroke="#f59e0b" strokeWidth="1.2" strokeLinecap="round" />
        <path d="M18 16 L16 24" stroke="#f59e0b" strokeWidth="1.2" strokeLinecap="round" />
        <path d="M22 16 L20 24" stroke="#f59e0b" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    </div>
  );
}

/**
 * Ligne du tableau des portions avec bouton OR "✓ Compter"
 */
function LignePortion({
  ligne,
  readOnly,
  busy,
  onAction,
}: {
  ligne: LigneStockMagasin;
  readOnly: boolean;
  busy: boolean;
  onAction: (action: Record<string, unknown> & { action: string }) => Promise<boolean>;
}) {
  const [comptage, setComptage] = useState("1");
  const ecart = ligne.lastEcart;

  async function compter() {
    if (comptage === "") return;
    const ok = await onAction({
      action: "comptage",
      family: ligne.family,
      itemId: ligne.id,
      qty: Number(comptage),
    });
    if (ok) setComptage("1");
  }

  return (
    <tr>
      <td className="cell-titre">
        <div className="plats-dish-cell">
          <DishThumb name={ligne.name} />
          <div className="plats-dish-info">
            <span className="plats-dish-name">{ligne.name}</span>
            {ligne.supplement ? (
              <span className="plats-dish-note">Supplément</span>
            ) : null}
          </div>
        </div>
      </td>
      <td className="col-center" data-label="Stock théorique">
        <span className="plats-stock-pill">
          {nombre(ligne.stock)} {ligne.unit}
        </span>
      </td>
      <td className="col-center plats-val-muted" data-label="Dernier comptage">
        {ligne.lastCounted === null
          ? "—"
          : `${nombre(ligne.lastCounted)} (${dateCourte(ligne.lastCountAt)})`}
      </td>
      <td className={`col-center ${ecart !== null && ecart < 0 ? "plats-val-alert" : "plats-val-muted"}`} data-label="Écart">
        {ecart === null ? "—" : `${ecart > 0 ? "+" : ""}${nombre(ecart)}`}
      </td>
      {readOnly ? null : (
        <td className="col-center cell-action">
          <div className="plats-comptage-cell">
            <input
              className="plats-comptage-input"
              type="number"
              min="0"
              step="any"
              aria-label={`Comptage ${ligne.name}`}
              value={comptage}
              onChange={(e) => setComptage(e.target.value)}
            />
            <button
              type="button"
              className="plats-btn-compter"
              disabled={busy || comptage === ""}
              onClick={() => void compter()}
            >
              <svg
                className="plats-btn-compter-icon"
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>Compter</span>
            </button>
          </div>
        </td>
      )}
    </tr>
  );
}

export function PlatsPreparesPage() {
  const { user } = useSession();
  const readOnly = Boolean(user && !canWriteStock(user.role));
  const { etat, busy, error, action } = useMagasin();

  const [ficheId, setFicheId] = useState("");
  const [lots, setLots] = useState("1");
  const [portions, setPortions] = useState("");
  const [absents, setAbsents] = useState<Record<string, boolean>>({});
  const [reels, setReels] = useState<Record<string, string>>({});

  const articles = useMemo(
    () => new Map((etat?.articles ?? []).map((a) => [a.id, a])),
    [etat?.articles],
  );

  const fiche = (etat?.fichesLot ?? []).find((f) => f.id === ficheId);
  const nbLots = Number(lots) || 0;

  function reset() {
    setLots("1");
    setPortions("");
    setAbsents({});
    setReels({});
  }

  async function declarer(e: FormEvent) {
    e.preventDefault();
    if (!fiche) return;
    const saisies: ProductionSaisie[] = fiche.lines
      .filter((l) => !l.supplement)
      .map((l) => ({
        articleId: l.articleId,
        manquant: absents[l.articleId] === true,
        reel: reels[l.articleId] ? Number(reels[l.articleId]) : null,
      }));
    const ok = await action({
      action: "production",
      ficheId: fiche.id,
      lots: nbLots,
      portions: portions === "" ? null : Number(portions),
      saisies,
    });
    if (ok) reset();
  }

  return (
    <AppShell
      title="Plats préparés"
      subtitle="Le nombre de plats préparés à Gbégamey."
      mainClassName="main-plats-prepares"
    >
      <div className="plats-page-container">
        {/* Hero Banner avec toque de chef et plat gourmand */}
        <header className="plats-hero" aria-label="Bannière Plats préparés">
          <div className="plats-hero-content">
            <div className="plats-hero-icon" aria-hidden>
              {/* Toque de chef */}
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
                <path d="M6 18h12M7 18v2a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-2M7 18c-2.5 0-4-1.8-4-4.5 0-2 1.5-3.8 3.5-4.2C6.8 6.5 9 5 12 5c3 0 5.2 1.5 5.5 4.3 2 .4 3.5 2.2 3.5 4.2 0 2.7-1.5 4.5-4 4.5" />
              </svg>
            </div>
            <div className="plats-hero-text">
              <h1 className="plats-hero-title">Plats préparés</h1>
              <p className="plats-hero-sub">Le nombre de plats préparés à Gbégamey.</p>
            </div>
          </div>

          <div className="plats-hero-deco" aria-hidden>
            {/* Assiette gourmande illustrée */}
            <div className="plats-hero-dish-wrap">
              <svg viewBox="0 0 200 120" className="plats-hero-dish-img">
                <ellipse cx="100" cy="62" rx="95" ry="52" fill="#ffffff" stroke="#f1f5f9" strokeWidth="3" />
                <ellipse cx="100" cy="62" rx="85" ry="44" fill="#f8fafc" />
                {/* Salade / verdure */}
                <path d="M40 50 Q 55 35 70 45 Q 85 30 100 42 Q 120 32 140 45 Q 160 38 170 55 Q 155 75 140 68 Q 120 80 100 70 Q 75 82 55 70 Z" fill="#4ade80" opacity="0.9" />
                <path d="M45 54 Q 60 40 75 48 Q 95 36 115 46 Q 135 38 155 50 Q 165 60 150 70 Q 130 78 110 72 Q 85 80 60 70 Z" fill="#22c55e" opacity="0.8" />
                {/* Premier poisson grillé doré */}
                <g transform="rotate(-12 90 52)">
                  <path d="M35 52 C 45 38, 90 36, 135 48 C 150 52, 158 56, 155 60 C 152 64, 140 68, 125 70 C 85 74, 45 66, 35 52 Z" fill="#b45309" stroke="#78350f" strokeWidth="1.5" />
                  <path d="M40 52 C 50 42, 88 40, 130 50 C 142 53, 148 56, 145 59 C 142 62, 132 65, 120 67 C 82 70, 50 64, 40 52 Z" fill="#d97706" />
                  <line x1="65" y1="42" x2="60" y2="60" stroke="#78350f" strokeWidth="2.5" strokeLinecap="round" />
                  <line x1="80" y1="43" x2="75" y2="62" stroke="#78350f" strokeWidth="2.5" strokeLinecap="round" />
                  <line x1="95" y1="45" x2="90" y2="64" stroke="#78350f" strokeWidth="2.5" strokeLinecap="round" />
                  <line x1="110" y1="48" x2="105" y2="66" stroke="#78350f" strokeWidth="2.5" strokeLinecap="round" />
                </g>
                {/* Deuxième poisson grillé */}
                <g transform="rotate(-5 100 68)">
                  <path d="M45 68 C 55 54, 100 52, 145 64 C 160 68, 168 72, 165 76 C 162 80, 150 84, 135 86 C 95 90, 55 82, 45 68 Z" fill="#92400e" stroke="#78350f" strokeWidth="1.5" />
                  <path d="M50 68 C 60 58, 98 56, 140 66 C 152 69, 158 72, 155 75 C 152 78, 142 81, 130 83 C 92 86, 60 80, 50 68 Z" fill="#b45309" />
                  <line x1="75" y1="58" x2="70" y2="76" stroke="#451a03" strokeWidth="2.5" strokeLinecap="round" />
                  <line x1="90" y1="60" x2="85" y2="78" stroke="#451a03" strokeWidth="2.5" strokeLinecap="round" />
                  <line x1="105" y1="62" x2="100" y2="80" stroke="#451a03" strokeWidth="2.5" strokeLinecap="round" />
                  <line x1="120" y1="65" x2="115" y2="82" stroke="#451a03" strokeWidth="2.5" strokeLinecap="round" />
                </g>
                {/* Tomates cerises et citron */}
                <circle cx="145" cy="44" r="6" fill="#ef4444" stroke="#b91c1c" strokeWidth="1" />
                <circle cx="155" cy="52" r="5.5" fill="#dc2626" stroke="#991b1b" strokeWidth="1" />
                <path d="M125 76 A 16 16 0 0 1 155 78 Z" fill="#facc15" stroke="#eab308" strokeWidth="1.5" />
                <ellipse cx="140" cy="78" rx="12" ry="7" fill="#fef08a" />
              </svg>
            </div>
            {/* Courbe dorée accent */}
            <svg className="plats-hero-curve" viewBox="0 0 180 50" fill="none">
              <path
                d="M10 45 C 70 45, 120 35, 175 12"
                stroke="#f59e0b"
                strokeWidth="3.5"
                strokeLinecap="round"
              />
            </svg>
          </div>
        </header>

        {error ? (
          <div className="error-banner" role="alert">
            {error}
          </div>
        ) : null}

        {!etat && !error ? <BrandLoader label="Chargement des plats…" /> : null}

        {etat ? (
          <>
            {/* Carte 1 : Enregistrer les plats préparés */}
            {readOnly ? null : (
              <form className="plats-card" onSubmit={(e) => void declarer(e)}>
                <div className="plats-card-header">
                  <svg
                    className="plats-card-title-icon"
                    viewBox="0 0 24 24"
                    width="24"
                    height="24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2m-6 9 2 2 4-4" />
                  </svg>
                  <h2 className="plats-card-title">Enregistrer les plats préparés</h2>
                </div>
                <p className="plats-card-sub">
                  Les condiments utilisés sortent du stock et les plats préparés y entrent. Décochez
                  un condiment absent ou corrigez la quantité réelle.
                </p>

                {etat.fichesLot.length === 0 ? (
                  <p className="mag-hint">
                    Aucun plat à préparer pour l’instant. Créez sa fiche dans Composition plat.
                  </p>
                ) : (
                  <div className="plats-form-grid">
                    {/* Champ Plat */}
                    <div className="plats-field">
                      <label htmlFor="plat-select-id" className="plats-field-label">
                        <svg
                          className="plats-field-label-icon"
                          viewBox="0 0 24 24"
                          width="18"
                          height="18"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden
                        >
                          <path d="M18 2v20M2 2v8a4 4 0 0 0 4 4v8M6 2v6M10 2v6" />
                        </svg>
                        <span>Plat</span>
                      </label>
                      <div className="plats-select-wrap">
                        <select
                          id="plat-select-id"
                          className="plats-select"
                          value={ficheId}
                          onChange={(e) => {
                            setFicheId(e.target.value);
                            reset();
                          }}
                        >
                          <option value="">Choisir un plat…</option>
                          {etat.fichesLot.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.productName}
                            </option>
                          ))}
                        </select>
                        <svg
                          className="plats-select-arrow"
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

                    {/* Champ Nombre de plats */}
                    <div className="plats-field">
                      <label htmlFor="plat-lots-id" className="plats-field-label">
                        <svg
                          className="plats-field-label-icon"
                          viewBox="0 0 24 24"
                          width="18"
                          height="18"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden
                        >
                          <circle cx="12" cy="12" r="10" />
                          <line x1="10" y1="8" x2="9" y2="16" />
                          <line x1="15" y1="8" x2="14" y2="16" />
                          <line x1="8" y1="11" x2="16" y2="11" />
                          <line x1="8" y1="14" x2="16" y2="14" />
                        </svg>
                        <span>
                          {fiche && fiche.portions > 1
                            ? "Nombre de marmites"
                            : "Nombre de plats préparés"}
                        </span>
                      </label>
                      <input
                        id="plat-lots-id"
                        className="plats-input"
                        type="number"
                        min="0"
                        step="any"
                        value={lots}
                        onChange={(e) => setLots(e.target.value)}
                      />
                    </div>

                    {/* Champ Portions obtenues si multi-portions */}
                    {fiche && fiche.portions > 1 ? (
                      <div className="plats-field">
                        <label htmlFor="plat-portions-id" className="plats-field-label">
                          <span>Portions obtenues</span>
                        </label>
                        <input
                          id="plat-portions-id"
                          className="plats-input"
                          type="number"
                          min="0"
                          step="any"
                          placeholder={String(fiche.portions * nbLots)}
                          value={portions}
                          onChange={(e) => setPortions(e.target.value)}
                        />
                      </div>
                    ) : null}
                  </div>
                )}

                {/* Condiments prévus par la recette */}
                {fiche ? (
                  <div className="plats-condiments-preview">
                    <h3 className="plats-condiments-title">
                      Condiments utilisés pour {lots} {fiche.portions > 1 ? "marmite(s)" : "plat(s)"}
                    </h3>
                    <div className="plats-condiments-grid">
                      {fiche.lines
                        .filter((l) => !l.supplement)
                        .map((l) => {
                          const article = articles.get(l.articleId);
                          const prevu = l.qty * nbLots;
                          const absent = absents[l.articleId] === true;
                          return (
                            <div className="plats-condiment-row" key={l.articleId}>
                              <label className="plats-condiment-check">
                                <input
                                  type="checkbox"
                                  checked={!absent}
                                  onChange={(e) =>
                                    setAbsents((a) => ({ ...a, [l.articleId]: !e.target.checked }))
                                  }
                                />
                                <span>{article?.name ?? "Ingrédient"}</span>
                              </label>
                              <input
                                className="plats-condiment-input"
                                type="number"
                                min="0"
                                step="any"
                                disabled={absent}
                                aria-label={`Quantité réelle ${article?.name ?? ""}`}
                                placeholder={nombre(prevu)}
                                value={reels[l.articleId] ?? ""}
                                onChange={(e) =>
                                  setReels((r) => ({ ...r, [l.articleId]: e.target.value }))
                                }
                              />
                              <span className="plats-condiment-unit">{article?.unit ?? ""}</span>
                            </div>
                          );
                        })}
                    </div>
                    <div className="plats-form-actions">
                      <button
                        type="submit"
                        className="plats-btn-submit"
                        disabled={busy || nbLots <= 0}
                      >
                        {busy ? "Enregistrement…" : "Enregistrer"}
                      </button>
                    </div>
                  </div>
                ) : null}
              </form>
            )}

            {/* Carte 2 : Portions de plats disponibles (Tableau avec en-tête bleu & boutons or) */}
            <section className="plats-card plats-table-card" aria-label="Portions de plats disponibles">
              <div className="plats-card-header">
                <svg
                  className="plats-card-title-icon"
                  viewBox="0 0 24 24"
                  width="24"
                  height="24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <polygon points="12 2 2 7 12 12 22 7 12 2" />
                  <polyline points="2 17 12 22 22 17" />
                  <polyline points="2 12 12 17 22 12" />
                </svg>
                <h2 className="plats-card-title">Portions de plats disponibles</h2>
              </div>

              {etat.portions.length ? (
                <div className="plats-table-container">
                  <table className="plats-table">
                    <thead>
                      <tr>
                        <th>Plat</th>
                        <th className="col-center">Stock théorique</th>
                        <th className="col-center">Dernier comptage</th>
                        <th className="col-center">Écart</th>
                        {readOnly ? null : <th className="col-center">Comptage</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {etat.portions.map((ligne) => (
                        <LignePortion
                          key={ligne.id}
                          ligne={ligne}
                          readOnly={readOnly}
                          busy={busy}
                          onAction={action}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="mag-hint" style={{ marginTop: 12 }}>
                  Aucun plat produit en lot pour le moment.
                </p>
              )}
            </section>

            {/* Carte 3 : Dernières préparations */}
            <section className="plats-card plats-table-card" aria-label="Dernières préparations">
              <div className="plats-card-header">
                <svg
                  className="plats-card-title-icon"
                  viewBox="0 0 24 24"
                  width="24"
                  height="24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                <h2 className="plats-card-title">Dernières préparations</h2>
              </div>

              {etat.productions.length ? (
                <div className="plats-table-container">
                  <table className="plats-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Plat</th>
                        <th className="col-center">Plats / Marmites</th>
                        <th className="col-center">Portions</th>
                        <th className="col-center">Rendement</th>
                        <th>Par</th>
                        <th className="col-center">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {etat.productions.map((p) => (
                        <tr key={p.id}>
                          <td data-label="Date">{dateCourte(p.at)}</td>
                          <td className="cell-titre">
                            <strong>{p.productName}</strong>
                          </td>
                          <td className="col-center mono" data-label="Plats / Marmites">{nombre(p.lots)}</td>
                          <td className="col-center mono" data-label="Portions">{nombre(p.portions)}</td>
                          <td
                            className={`col-center mono ${p.ecartPortions < 0 ? "plats-val-alert" : ""}`}
                            data-label="Rendement"
                          >
                            {p.ecartPortions > 0 ? "+" : ""}
                            {nombre(p.ecartPortions)}
                          </td>
                          <td className="plats-val-muted" data-label="Par">{p.actorName ?? "—"}</td>
                          <td className="col-center cell-action">
                            {p.cancelledAt ? (
                              <span className="plats-val-muted">Annulée</span>
                            ) : readOnly ? null : (
                              <button
                                type="button"
                                className="plats-btn-annuler"
                                disabled={busy}
                                onClick={() => {
                                  if (
                                    window.confirm(
                                      `Annuler cette préparation de ${p.productName} ?`,
                                    )
                                  ) {
                                    void action({ action: "annuler-production", id: p.id });
                                  }
                                }}
                              >
                                Annuler
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="mag-hint" style={{ marginTop: 12 }}>
                  Aucun plat préparé enregistré pour le moment.
                </p>
              )}
            </section>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
