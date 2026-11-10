"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { BrandLoader } from "@/components/brand-loader";
import "./condiments.css";
import {
  recetteVersBase,
  uniteRecette,
  type MagasinUnit,
  type ProductionSaisie,
} from "@/lib/magasin-calc";
import type { EtatMagasin, LigneStockMagasin } from "@/lib/magasin-repo";
import { useLiveRefresh } from "@/lib/use-live-refresh";

const API = "/api/magasin?site=gbegamey";

type Vue = "stock" | "manquants";
type Action = Record<string, unknown> & { action: string };

const nombre = (n: number) =>
  n.toLocaleString("fr-FR", { maximumFractionDigits: 3 });

const dateCourte = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })
    : "—";

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
  const [entree, setEntree] = useState("");
  const [prix, setPrix] = useState("");
  const [comptage, setComptage] = useState("");
  const ecart = ligne.lastEcart;
  const prixRetenu = Number(prix) || ligne.unitPrice;

  async function ajouter() {
    const montant = Math.round(Number(entree) * prixRetenu).toLocaleString("fr-FR");
    if (!window.confirm(`Enregistrer cet achat de ${ligne.name} ? ${montant} F sortiront de la caisse.`)) {
      return;
    }
    const ok = await onAction({
      action: "entree",
      articleId: ligne.id,
      qty: Number(entree),
      unitPrice: prixRetenu,
    });
    if (ok) {
      setEntree("");
      setPrix("");
    }
  }
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
      <td>
        {ligne.name}
        {ligne.supplement ? <span className="muted"> · supplément</span> : null}
      </td>
      <td className={`mono${ligne.alerte ? " mag-alert" : ""}`}>
        {nombre(ligne.stock)} {ligne.unit}
      </td>
      <td className="mono">
        {ligne.lastCounted === null
          ? "—"
          : `${nombre(ligne.lastCounted)} (${dateCourte(ligne.lastCountAt)})`}
      </td>
      <td className={`mono${ecart ? " mag-alert" : ""}`}>
        {ecart === null ? "—" : `${ecart > 0 ? "+" : ""}${nombre(ecart)}`}
      </td>
      {readOnly ? null : (
        <>
          <td>
            {ligne.family === "magasin" ? (
              <div className="mag-row-action">
                <input
                  className="mag-input"
                  type="number"
                  min="0"
                  step="any"
                  aria-label={`Quantité achetée de ${ligne.name}`}
                  placeholder="Qté"
                  value={entree}
                  onChange={(e) => setEntree(e.target.value)}
                />
                <input
                  className="mag-input"
                  type="number"
                  min="0"
                  step="any"
                  aria-label={`Prix d'achat par ${ligne.unit} de ${ligne.name}`}
                  placeholder={ligne.unitPrice ? String(ligne.unitPrice) : "Prix"}
                  value={prix}
                  onChange={(e) => setPrix(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={busy || !(Number(entree) > 0) || !(prixRetenu > 0)}
                  onClick={() => void ajouter()}
                >
                  Acheter
                </button>
              </div>
            ) : null}
          </td>
          <td>
            <div className="mag-row-action">
              <input
                className="mag-input"
                type="number"
                min="0"
                step="any"
                aria-label={`Comptage ${ligne.name}`}
                value={comptage}
                onChange={(e) => setComptage(e.target.value)}
              />
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy || comptage === ""}
                onClick={() => void compter()}
              >
                Compter
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
    <div className="mag-table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>{lignes[0]?.family === "portion" ? "Plat" : "Condiment"}</th>
            <th>Stock théorique</th>
            <th>Dernier comptage</th>
            <th>Écart</th>
            {readOnly ? null : (
              <>
                <th>{lignes[0]?.family === "portion" ? "" : "Achat"}</th>
                <th>Comptage</th>
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

  return { etat, busy, error, action };
}

export function CondimentsPanel({ readOnly }: { readOnly: boolean }) {
  const { etat, busy, error, action } = useMagasin();
  const [vue, setVue] = useState<Vue>("stock");
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

  if (!etat && !error) return <BrandLoader label="Chargement des condiments…" />;

  const alertes = etat?.manquants.filter((m) => m.alerte).length ?? 0;

  return (
    <div className="mag-page">
      <div className="section-tabs" role="tablist" aria-label="Condiments">
        {(
          [
            ["stock", "Stock et achats"],
            ["manquants", alertes ? `Manquants (${alertes})` : "Manquants"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={vue === key}
            className={`section-tab${vue === key ? " is-active" : ""}`}
            onClick={() => setVue(key)}
          >
            {label}
          </button>
        ))}
      </div>

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

          <section className="panel mag-card">
            <h3>Stock des condiments</h3>
            {etat.stock.length ? (
              <TableStock lignes={etat.stock} readOnly={readOnly} busy={busy} onAction={action} />
            ) : (
              <p className="mag-hint">Aucun condiment pour l’instant.</p>
            )}
          </section>
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
