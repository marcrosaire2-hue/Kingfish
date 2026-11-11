"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { BrandLoader } from "@/components/brand-loader";
import "./condiments.css";
import "@/components/stock-zogbo/stock-gbegamey.css";
import {
  recetteVersBase,
  uniteRecette,
  type MagasinUnit,
  type ProductionSaisie,
} from "@/lib/magasin-calc";
import type { EtatMagasin, LigneStockMagasin } from "@/lib/magasin-repo";
import { useLiveRefresh } from "@/lib/use-live-refresh";

const API = "/api/magasin?site=gbegamey";

export type VueCondiments = "stock" | "manquants";
type Vue = VueCondiments;
type Action = Record<string, unknown> & { action: string };

const nombre = (n: number) =>
  n.toLocaleString("fr-FR", { maximumFractionDigits: 3 });

const dateCourte = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })
    : "—";

/** Vignette ronde SVG pour un condiment, en fonction de son nom. */
function CondimentThumb({ name }: { name: string }) {
  const n = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  let bg = "#fef3c7";
  let fill = "#d97706";
  if (n.includes("ail") || n.includes("oignon") || n.includes("echalote")) { bg = "#fef9c3"; fill = "#ca8a04"; }
  else if (n.includes("carotte") || n.includes("tomate")) { bg = "#fee2e2"; fill = "#dc2626"; }
  else if (n.includes("farine") || n.includes("chapelure") || n.includes("semoule")) { bg = "#fef3c7"; fill = "#b45309"; }
  else if (n.includes("huile") || n.includes("beurre")) { bg = "#fef9c3"; fill = "#eab308"; }
  else if (n.includes("sel") || n.includes("poivre") || n.includes("piment")) { bg = "#fce7f3"; fill = "#be185d"; }
  else if (n.includes("sucre")) { bg = "#f0fdf4"; fill = "#16a34a"; }
  return (
    <div className="sg-condiment-thumb" aria-hidden>
      <svg viewBox="0 0 44 44" width="44" height="44">
        <rect width="44" height="44" rx="22" fill={bg} />
        <circle cx="22" cy="18" r="8" fill={fill} opacity="0.85" />
        <circle cx="22" cy="18" r="4" fill={fill} opacity="0.55" />
        <ellipse cx="22" cy="30" rx="10" ry="5" fill={fill} opacity="0.25" />
      </svg>
    </div>
  );
}

/**
 * Enregistre un achat : demande le prix si l'article n'en a pas, fait
 * confirmer la sortie de caisse, puis envoie l'entrée au magasin.
 */
async function acheter(
  ligne: LigneStockMagasin,
  qty: number,
  onAction: (action: Action) => Promise<boolean>,
): Promise<boolean> {
  const saisi = prompt(`Prix par ${ligne.unit} de ${ligne.name} :`, String(ligne.unitPrice || ""));
  if (saisi === null) return false;
  const unitPrice = Number(saisi);
  if (!(unitPrice > 0)) {
    window.alert("Prix invalide.");
    return false;
  }
  const montant = Math.round(qty * unitPrice).toLocaleString("fr-FR");
  if (!window.confirm(`Enregistrer cet achat de ${ligne.name} ? ${montant} F sortiront de la caisse.`)) {
    return false;
  }
  return onAction({ action: "entree", articleId: ligne.id, qty, unitPrice });
}

function LigneStock({
  ligne,
  readOnly,
  busy,
  onAction,
}: {
  ligne: LigneStockMagasin;
  readOnly: boolean;
  busy: boolean;
  onAction: (action: Action) => Promise<boolean>;
}) {
  const [comptage, setComptage] = useState("");
  const ecart = ligne.lastEcart;
  async function compter() {
    const ok = await onAction({
      action: "comptage",
      family: ligne.family,
      itemId: ligne.id,
      qty: Number(comptage),
    });
    if (ok) setComptage("");
  }

  return (
    <tr>
      <td className="cell-titre">
        <div className="sg-condiment-cell">
          <CondimentThumb name={ligne.name} />
          <span className="sg-condiment-name">
            {ligne.name}
            {ligne.supplement ? <span style={{ color: "#94a3b8", fontWeight: 500, fontSize: "0.82rem" }}> · supplément</span> : null}
          </span>
        </div>
      </td>
      <td data-label="Stock théorique">
        <span className={`sg-stock-theorique${ligne.alerte ? " is-alerte" : ""}`}>{nombre(ligne.stock)} {ligne.unit}</span>
      </td>
      <td className="col-center" data-label="Dernier comptage">
        {ligne.lastCounted === null
          ? "—"
          : `${nombre(ligne.lastCounted)} (${dateCourte(ligne.lastCountAt)})`}
      </td>
      <td className="col-center" data-label="Écart">
        <span className="sg-ecart-pill">
          {ecart === null ? "—" : `${ecart > 0 ? "+" : ""}${nombre(ecart)} ${ligne.unit}`}
        </span>
      </td>
      {readOnly ? null : (
        <>
          <td className="cell-action">
            {ligne.family === "magasin" ? (
              <button
                type="button"
                className="sg-btn-achat"
                disabled={busy}
                onClick={() => {
                  const q = prompt(`Quantité achetée de ${ligne.name} (${ligne.unit}) :`);
                  if (!q || !(Number(q) > 0)) return;
                  void acheter(ligne, Number(q), onAction);
                }}
              >
                🛒 Acheter
              </button>
            ) : null}
          </td>
          <td className="cell-action">
            <div className="sg-comptage-cell">
              <input
                className="sg-comptage-input"
                type="number"
                min="0"
                step="any"
                aria-label={`Comptage ${ligne.name}`}
                value={comptage}
                onChange={(e) => setComptage(e.target.value)}
              />
              <button
                type="button"
                className="sg-btn-compter"
                disabled={busy || comptage === ""}
                onClick={() => void compter()}
              >
                ✓ Compter
              </button>
            </div>
          </td>
        </>
      )}
    </tr>
  );
}

function TableStock({
  lignes,
  readOnly,
  busy,
  onAction,
}: {
  lignes: LigneStockMagasin[];
  readOnly: boolean;
  busy: boolean;
  onAction: (action: Action) => Promise<boolean>;
}) {
  return (
    <div className="sg-table-container">
      <table className="sg-table">
        <thead>
          <tr>
            <th>{lignes[0]?.family === "portion" ? "PLAT" : "CONDIMENT"}</th>
            <th>STOCK THÉORIQUE</th>
            <th className="col-center">DERNIER COMPTAGE</th>
            <th className="col-center">ÉCART</th>
            {readOnly ? null : (
              <>
                <th>{lignes[0]?.family === "portion" ? "" : "ACHAT"}</th>
                <th className="col-center">COMPTAGE</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {lignes.map((l) => (
            <LigneStock key={l.id} ligne={l} readOnly={readOnly} busy={busy} onAction={onAction} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* Icônes trait (style Lucide) utilisées par les cartes Gbégamey. */
function Icone({ d, size = 16 }: { d: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}

const ICONES = {
  caisse: "M3 7h18v13H3zM3 7l2-4h14l2 4M9 11h6",
  bol: "M3 11h18a9 9 0 0 1-18 0zM8 7c0-1 1-2 1-3M12 7c0-1 1-2 1-3M16 7c0-1 1-2 1-3",
  cube: "M21 16V8l-9-5-9 5v8l9 5zM3.3 7 12 12l8.7-5M12 22V12",
  calendrier: "M3 5h18v16H3zM16 3v4M8 3v4M3 10h18",
  echange: "M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3",
  liste: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  info: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01",
  plus: "M12 5v14M5 12h14",
  chevron: "M6 9l6 6 6-6",
  actualiser: "M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5",
} as const;

type Motif = "achat" | "comptage";

/** Carte « Ajouter un stock / mouvement » : achat ou comptage d'un condiment. */
function CarteMouvement({
  lignes,
  busy,
  onAction,
}: {
  lignes: LigneStockMagasin[];
  busy: boolean;
  onAction: (action: Action) => Promise<boolean>;
}) {
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState("");
  const [motif, setMotif] = useState<Motif | "">("");
  const ligne = lignes.find((l) => l.id === itemId);
  const achatPossible = ligne?.family === "magasin";
  const quantite = Number(qty);
  const valide =
    !!ligne &&
    motif !== "" &&
    qty !== "" &&
    (motif === "comptage" ? quantite >= 0 : quantite > 0 && achatPossible);

  async function envoyer(e: FormEvent) {
    e.preventDefault();
    if (!ligne || !valide) return;
    const ok =
      motif === "achat"
        ? await acheter(ligne, quantite, onAction)
        : await onAction({
            action: "comptage",
            family: ligne.family,
            itemId: ligne.id,
            qty: quantite,
          });
    if (ok) {
      setQty("");
      setMotif("");
    }
  }

  return (
    <form className="sg-card" onSubmit={(e) => void envoyer(e)}>
      <div className="sg-card-header-row">
        <div className="sg-card-title-group">
          <div className="sg-card-title-wrap">
            <span className="sg-card-title-icon">
              <Icone d={ICONES.caisse} size={22} />
            </span>
            <h3 className="sg-card-title">Ajouter un stock / mouvement</h3>
          </div>
          <p className="sg-card-sub">Enregistrez un nouveau stock ou un mouvement de stock.</p>
        </div>
      </div>

      <div className="sg-mouvement-form">
        <label className="sg-field">
          <span className="sg-label">
            <span className="sg-label-icon"><Icone d={ICONES.bol} /></span>
            Condiment
          </span>
          <span className="sg-input-wrap">
            <select
              className="sg-select"
              value={itemId}
              onChange={(e) => {
                setItemId(e.target.value);
                setQty("");
              }}
            >
              <option value="">Choisir un condiment…</option>
              {lignes.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            <span className="sg-select-chevron"><Icone d={ICONES.chevron} /></span>
          </span>
        </label>

        <label className="sg-field">
          <span className="sg-label">
            <span className="sg-label-icon"><Icone d={ICONES.cube} /></span>
            Stock théorique
          </span>
          <input
            className="sg-input"
            disabled
            value={ligne ? `${nombre(ligne.stock)} ${ligne.unit}` : "—"}
            readOnly
          />
        </label>

        <label className="sg-field">
          <span className="sg-label">
            <span className="sg-label-icon"><Icone d={ICONES.calendrier} /></span>
            Dernier comptage
          </span>
          <input
            className="sg-input"
            disabled
            readOnly
            value={
              ligne?.lastCountAt
                ? `${nombre(ligne.lastCounted ?? 0)} ${ligne.unit} · ${new Date(ligne.lastCountAt).toLocaleDateString("fr-FR")}`
                : "—"
            }
          />
        </label>

        <label className="sg-field">
          <span className="sg-label">
            <span className="sg-label-icon"><Icone d={ICONES.echange} /></span>
            {motif === "comptage" ? "Quantité comptée" : "Quantité"}
          </span>
          <input
            className="sg-input"
            type="number"
            min="0"
            step="any"
            placeholder={ligne ? `Ex : 5 ${ligne.unit}` : "Ex : 5"}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
        </label>

        <label className="sg-field">
          <span className="sg-label">
            <span className="sg-label-icon"><Icone d={ICONES.liste} /></span>
            Motif
          </span>
          <span className="sg-input-wrap">
            <select
              className="sg-select"
              value={motif}
              onChange={(e) => setMotif(e.target.value as Motif | "")}
            >
              <option value="">Sélectionner…</option>
              <option value="achat" disabled={!!ligne && !achatPossible}>
                Achat (sortie de caisse)
              </option>
              <option value="comptage">Comptage</option>
            </select>
            <span className="sg-select-chevron"><Icone d={ICONES.chevron} /></span>
          </span>
        </label>

        <button type="submit" className="sg-btn-ajouter" disabled={busy || !valide}>
          <Icone d={ICONES.plus} size={18} />
          {busy ? "…" : "Ajouter"}
        </button>
      </div>
    </form>
  );
}

export function VueProduction({
  etat,
  readOnly,
  busy,
  onAction,
}: {
  etat: EtatMagasin;
  readOnly: boolean;
  busy: boolean;
  onAction: (action: Action) => Promise<boolean>;
}) {
  const [ficheId, setFicheId] = useState("");
  const [lots, setLots] = useState("1");
  const [portions, setPortions] = useState("");
  const [absents, setAbsents] = useState<Record<string, boolean>>({});
  const [reels, setReels] = useState<Record<string, string>>({});

  const articles = useMemo(
    () => new Map(etat.articles.map((a) => [a.id, a])),
    [etat.articles],
  );
  const fiche = etat.fichesLot.find((f) => f.id === ficheId);
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
    const ok = await onAction({
      action: "production",
      ficheId: fiche.id,
      lots: nbLots,
      portions: portions === "" ? null : Number(portions),
      saisies,
    });
    if (ok) reset();
  }

  return (
    <div className="mag-page">
      {readOnly ? null : (
        <form className="panel mag-card" onSubmit={(e) => void declarer(e)}>
          <h3>Enregistrer les plats préparés</h3>
          <p className="mag-hint">
            Les condiments utilisés sortent du stock et les plats préparés y entrent. Décochez un condiment absent ou corrigez la quantité réelle.
          </p>
          {etat.fichesLot.length === 0 ? (
            <p className="mag-hint">
              Aucun plat à préparer pour l’instant. Créez sa fiche dans Composition plat.
            </p>
          ) : (
            <div className="mag-form">
              <label className="mag-field">
                Plat
                <select
                  className="select-input"
                  value={ficheId}
                  onChange={(e) => {
                    setFicheId(e.target.value);
                    reset();
                  }}
                >
                  <option value="">Choisir…</option>
                  {etat.fichesLot.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.productName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="mag-field">
                {fiche && fiche.portions > 1 ? "Nombre de marmites" : "Nombre de plats préparés"}
                <input
                  className="mag-input"
                  type="number"
                  min="0"
                  step="any"
                  value={lots}
                  onChange={(e) => setLots(e.target.value)}
                />
              </label>
              {fiche && fiche.portions > 1 ? (
                <label className="mag-field">
                  Portions obtenues
                  <input
                    className="mag-input"
                    type="number"
                    min="0"
                    step="any"
                    placeholder={String(fiche.portions * nbLots)}
                    value={portions}
                    onChange={(e) => setPortions(e.target.value)}
                  />
                </label>
              ) : null}
            </div>
          )}

          {fiche ? (
            <div style={{ marginTop: 12 }}>
              {fiche.lines
                .filter((l) => !l.supplement)
                .map((l) => {
                  const article = articles.get(l.articleId);
                  const prevu = l.qty * nbLots;
                  const absent = absents[l.articleId] === true;
                  return (
                    <div className="mag-line" key={l.articleId}>
                      <label className="mag-check">
                        <input
                          type="checkbox"
                          checked={!absent}
                          onChange={(e) =>
                            setAbsents((a) => ({ ...a, [l.articleId]: !e.target.checked }))
                          }
                        />
                        {article?.name ?? "Ingrédient"}
                      </label>
                      <input
                        className="mag-input"
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
                      <span className="muted">{article?.unit ?? ""}</span>
                    </div>
                  );
                })}
              <div className="compo-actions">
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={busy || nbLots <= 0}
                >
                  {busy ? "…" : "Enregistrer"}
                </button>
              </div>
            </div>
          ) : null}
        </form>
      )}

      <section className="panel mag-card">
        <h3>Portions de plats disponibles</h3>
        {etat.portions.length ? (
          <TableStock lignes={etat.portions} readOnly={readOnly} busy={busy} onAction={onAction} />
        ) : (
          <p className="mag-hint">Aucun plat produit en lot.</p>
        )}
      </section>

      <section className="panel mag-card">
        <h3>Dernières préparations</h3>
        {etat.productions.length ? (
          <div className="mag-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Plat</th>
                  <th>Plats ou marmites</th>
                  <th>Portions</th>
                  <th>Rendement</th>
                  <th>Par</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {etat.productions.map((p) => (
                  <tr key={p.id}>
                    <td>{dateCourte(p.at)}</td>
                    <td>{p.productName}</td>
                    <td className="mono">{nombre(p.lots)}</td>
                    <td className="mono">{nombre(p.portions)}</td>
                    <td className={`mono${p.ecartPortions < 0 ? " mag-alert" : ""}`}>
                      {p.ecartPortions > 0 ? "+" : ""}
                      {nombre(p.ecartPortions)}
                    </td>
                    <td>{p.actorName ?? "—"}</td>
                    <td>
                      {p.cancelledAt ? (
                        <span className="muted">Annulée</span>
                      ) : readOnly ? null : (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          disabled={busy}
                          onClick={() => {
                            if (window.confirm(`Annuler cette préparation de ${p.productName} ?`)) {
                              void onAction({ action: "annuler-production", id: p.id });
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
          <p className="mag-hint">Aucun plat préparé enregistré.</p>
        )}
      </section>
    </div>
  );
}

/** État du magasin et écriture, partagés par Condiments et Plats préparés. */
export function useMagasin() {
  const [etat, setEtat] = useState<EtatMagasin | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const charger = useCallback(async () => {
    try {
      const res = await fetch(API, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Chargement impossible.");
      setEtat(body as EtatMagasin);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chargement impossible.");
    }
  }, []);

  useEffect(() => {
    let annule = false;
    async function initial() {
      await Promise.resolve();
      if (!annule) await charger();
    }
    void initial();
    return () => {
      annule = true;
    };
  }, [charger]);

  useLiveRefresh(() => void charger());

  const action = useCallback(async (payload: Action): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Enregistrement impossible.");
      setEtat(body as EtatMagasin);
      if (body.avertissement) setError(String(body.avertissement));
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible.");
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  return { etat, busy, error, action, recharger: charger };
}

export function CondimentsPanel({
  readOnly,
  vue,
  onAlertesChange,
}: {
  readOnly: boolean;
  /** Vue choisie par la page (sélecteur à côté des onglets Condiments / Boissons). */
  vue: Vue;
  /** Nombre de manquants en alerte, affiché dans le sélecteur de la page. */
  onAlertesChange?: (n: number) => void;
}) {
  const { etat, busy, error, action, recharger } = useMagasin();
  const [actualisation, setActualisation] = useState(false);
  const [nom, setNom] = useState("");
  const [unite, setUnite] = useState<MagasinUnit>("kg");
  const [prix, setPrix] = useState("");
  const [seuil, setSeuil] = useState("");
  const [supplement, setSupplement] = useState(false);
  const [dose, setDose] = useState("");

  async function ajouterArticle(e: FormEvent) {
    e.preventDefault();
    const ok = await action({
      action: "article",
      name: nom,
      unit: unite,
      unitPrice: Number(prix) || 0,
      threshold: Number(seuil) || 0,
      supplement,
      dose: supplement ? recetteVersBase(Number(dose) || 0, unite) : 0,
    });
    if (ok) {
      setNom("");
      setPrix("");
      setSeuil("");
      setSupplement(false);
      setDose("");
    }
  }

  const aCompter = useMemo(() => {
    const noms = new Map((etat?.articles ?? []).map((a) => [a.id, a.name]));
    return (etat?.aCompter ?? []).map((id) => noms.get(id) ?? id);
  }, [etat]);

  const alertes = etat?.manquants.filter((m) => m.alerte).length ?? 0;
  useEffect(() => {
    onAlertesChange?.(alertes);
  }, [alertes, onAlertesChange]);

  if (!etat && !error) return <BrandLoader label="Chargement des condiments…" />;

  return (
    <div className="mag-page">
      {error ? (
        <p className="error-banner" role="alert">
          {error}
        </p>
      ) : null}

      {etat && vue === "stock" ? (
        <>
          {aCompter.length ? (
            <section className="panel mag-card">
              <h3>À compter aujourd’hui</h3>
              <div className="mag-chips">
                {aCompter.map((n) => (
                  <span key={n} className="mag-chip">
                    {n}
                  </span>
                ))}
              </div>
            </section>
          ) : null}

          {readOnly ? null : (
            <CarteMouvement lignes={etat.stock} busy={busy} onAction={action} />
          )}

          <section className="sg-card">
            <div className="sg-card-header-row" style={{ marginBottom: 0 }}>
              <div className="sg-card-title-wrap">
                <span className="sg-card-title-icon">
                  <Icone d={ICONES.cube} size={22} />
                </span>
                <h3 className="sg-card-title">Stock des condiments</h3>
              </div>
              <button
                type="button"
                className="sg-btn-actualiser"
                disabled={actualisation}
                onClick={async () => {
                  setActualisation(true);
                  await recharger();
                  setActualisation(false);
                }}
              >
                <Icone d={ICONES.actualiser} />
                {actualisation ? "Actualisation…" : "Actualiser"}
              </button>
            </div>
            {etat.stock.length ? (
              <TableStock lignes={etat.stock} readOnly={readOnly} busy={busy} onAction={action} />
            ) : (
              <p className="mag-hint">Aucun condiment pour l’instant.</p>
            )}
          </section>

          {readOnly ? null : (
            <form className="panel mag-card" onSubmit={(e) => void ajouterArticle(e)}>
              <h3>Nouveau condiment</h3>
              <div className="mag-form">
                <label className="mag-field">
                  Nom
                  <input className="mag-input" value={nom} onChange={(e) => setNom(e.target.value)} />
                </label>
                <label className="mag-field">
                  Unité
                  <select
                    className="select-input"
                    value={unite}
                    onChange={(e) => setUnite(e.target.value as MagasinUnit)}
                  >
                    <option value="kg">Kilo (kg)</option>
                    <option value="g">Gramme (g)</option>
                    <option value="L">Litre (L)</option>
                    <option value="u">Pièce (u)</option>
                  </select>
                </label>
                <label className="mag-field">
                  Prix par unité
                  <input
                    className="mag-input"
                    type="number"
                    min="0"
                    step="any"
                    value={prix}
                    onChange={(e) => setPrix(e.target.value)}
                  />
                </label>
                <label className="mag-field">
                  Seuil d’alerte
                  <input
                    className="mag-input"
                    type="number"
                    min="0"
                    step="any"
                    value={seuil}
                    onChange={(e) => setSeuil(e.target.value)}
                  />
                </label>
                <label className="mag-check">
                  <input
                    type="checkbox"
                    checked={supplement}
                    onChange={(e) => setSupplement(e.target.checked)}
                  />
                  Supplément à la caisse
                </label>
                {supplement ? (
                  <label className="mag-field">
                    Quantité par plat ({uniteRecette(unite)})
                    <input
                      className="mag-input"
                      type="number"
                      min="0"
                      step="any"
                      value={dose}
                      onChange={(e) => setDose(e.target.value)}
                    />
                  </label>
                ) : null}
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={busy || !nom.trim() || (supplement && !(Number(dose) > 0))}
                >
                  {busy ? "…" : "Ajouter"}
                </button>
              </div>
            </form>
          )}

        </>
      ) : null}

      {etat && vue === "manquants" ? (
        <section className="panel mag-card">
          <h3>Ingrédients manquants, 7 derniers jours</h3>
          <p className="mag-hint">
            Une alerte signale un manque déclaré au moins 3 fois alors que le stock indiquait du disponible.
          </p>
          {etat.manquants.length ? (
            <div className="mag-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Condiment ou plat</th>
                    <th>Déclarations</th>
                    <th>Quantité</th>
                    <th>Avec stock disponible</th>
                    <th>Alerte</th>
                  </tr>
                </thead>
                <tbody>
                  {etat.manquants.map((m) => (
                    <tr key={`${m.family}:${m.itemId}`}>
                      <td>{m.name}</td>
                      <td className="mono">{m.declarations}</td>
                      <td className="mono">{nombre(m.qty)}</td>
                      <td className="mono">{m.avecStock}</td>
                      <td>{m.alerte ? <span className="mag-alert">À vérifier</span> : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mag-hint">Aucun manque déclaré.</p>
          )}
        </section>
      ) : null}
    </div>
  );
}
