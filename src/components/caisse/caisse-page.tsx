"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { BrandLoader } from "@/components/brand-loader";
import { ContextBar } from "@/components/context-bar";
import { ExportExcelButton } from "@/components/export-excel-button";
import {
  CAISSES,
  CAISSE_LABELS,
  CAISSE_SHORT_LABELS,
  soldeTheorique as theo,
} from "@/lib/caisse-model";
import { formatFcfa } from "@/lib/format";
import { exportCaisseExcel } from "@/lib/page-exports";
import type {
  CaisseKey,
  CaisseMouvement,
  CaisseOverviewItem,
  CaisseSession,
} from "@/lib/types";
import { todayIsoDate } from "@/lib/zogbo-calc";

type Board = {
  date: string;
  caisse: CaisseKey;
  active: CaisseSession | null;
  historique: CaisseSession[];
  overview: CaisseOverviewItem[] | null;
  allowedCaisses: CaisseKey[];
};

type Detail = {
  session: CaisseSession;
  mouvements: CaisseMouvement[];
  soldeTheorique: number;
  ecart: number | null;
};

/**
 * Jours écoulés entre la date de service de la caisse et aujourd'hui. Sert à
 * alerter quand une caisse reste ouverte plusieurs jours : tant qu'elle ne
 * ferme pas, le calendrier des écrans Vente/POS reste collé à cette date
 * (voir operatingDateFromCaisse).
 */
function joursOuverte(date: string): number {
  const today = todayIsoDate();
  if (date >= today) return 0;
  const [y1, m1, d1] = date.split("-").map(Number);
  const [y2, m2, d2] = today.split("-").map(Number);
  if (!y1 || !m1 || !d1 || !y2 || !m2 || !d2) return 0;
  const ms = Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1);
  return Math.round(ms / 86400000);
}

function formatOpened(iso: string): string {
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "Africa/Porto-Novo",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

const MOUVEMENT_LABELS: Record<CaisseMouvement["kind"], string> = {
  depense: "Dépense",
  recette: "Recette",
  "versement-sortie": "Versement sorti",
  "versement-entree": "Versement reçu",
};

/** Un versement sorti et une dépense vident tous deux le tiroir. */
function sortDuTiroir(kind: CaisseMouvement["kind"]): boolean {
  return kind === "depense" || kind === "versement-sortie";
}

export function CaissePage() {
  const [date, setDate] = useState(() => todayIsoDate());
  // Vide au départ : l'API choisit la caisse autorisée du compte (defaultCaisse).
  // Si le lien vient du POS (/caisse?caisse=zogbo), la zone demandée fait foi.
  const [caisse, setCaisse] = useState<CaisseKey | "">(() => {
    if (typeof window === "undefined") return "";
    const demandee = new URLSearchParams(window.location.search).get("caisse");
    return CAISSES.includes(demandee as CaisseKey) ? (demandee as CaisseKey) : "";
  });
  const [allowed, setAllowed] = useState<CaisseKey[]>([]);
  const [board, setBoard] = useState<Board | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [soldeInitial, setSoldeInitial] = useState("0");
  const [soldePhysique, setSoldePhysique] = useState("");
  const [commentaire, setCommentaire] = useState("");
  const [mNature, setMNature] = useState("");
  const [mBenef, setMBenef] = useState("");
  const [mMontant, setMMontant] = useState("");
  const [mKind, setMKind] = useState<"depense" | "recette">("depense");
  const [vCaisse, setVCaisse] = useState<CaisseKey | "">("");
  const [vMontant, setVMontant] = useState("");
  const [vNature, setVNature] = useState("");

  async function load(nextDate = date, nextCaisse = caisse) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/caisse?date=${encodeURIComponent(nextDate)}${nextCaisse ? `&caisse=${nextCaisse}` : ""}`,
        { cache: "no-store" },
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Erreur");
      setBoard(body as Board);
      if (body.caisse) setCaisse(body.caisse as CaisseKey);
      setAllowed((body.allowedCaisses as CaisseKey[]) || []);
      if (body.active?.id) {
        await loadDetail(body.active.id);
      } else {
        setDetail(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(id: string) {
    const res = await fetch(`/api/caisse?id=${encodeURIComponent(id)}`, {
      cache: "no-store",
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || "Erreur détail");
    setDetail(body as Detail);
  }

  useEffect(() => {
    void load(date, caisse);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, caisse]);

  async function post(corps: Record<string, unknown>, echec: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/caisse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corps),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || echec);
      await load();
      return body as Record<string, unknown>;
    } catch (e) {
      setError(e instanceof Error ? e.message : echec);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function openCaisse() {
    await post(
      {
        action: "open",
        date,
        caisse,
        soldeInitial: Number(soldeInitial) || 0,
      },
      "Échec ouverture",
    );
  }

  async function closeCaisse() {
    if (!board?.active) return;
    const ok = await post(
      {
        action: "close",
        id: board.active.id,
        soldePhysique: Number(soldePhysique) || 0,
        commentaire,
      },
      "Échec fermeture",
    );
    if (ok) {
      setSoldePhysique("");
      setCommentaire("");
    }
  }

  async function addMouvement() {
    if (!board?.active) return;
    const ok = await post(
      {
        action: "mouvement",
        id: board.active.id,
        kind: mKind,
        nature: mNature,
        beneficiaire: mBenef,
        montant: Number(mMontant) || 0,
      },
      "Échec du mouvement",
    );
    if (ok) {
      setMNature("");
      setMBenef("");
      setMMontant("");
    }
  }

  async function verser() {
    if (!board?.active || !vCaisse) return;
    const montant = Number(vMontant) || 0;
    const ok = await post(
      {
        action: "versement",
        id: board.active.id,
        toCaisse: vCaisse,
        montant,
        nature: vNature,
      },
      "Échec du versement",
    );
    if (ok) {
      setVMontant("");
      setVNature("");
      setFlash(
        `${formatFcfa(montant)} versés à la ${CAISSE_SHORT_LABELS[vCaisse].toLowerCase()}`,
      );
      window.setTimeout(() => setFlash(null), 2600);
    }
  }

  async function annulerMouvement(m: CaisseMouvement) {
    if (
      !window.confirm(
        `Annuler ce mouvement ?\n\n${MOUVEMENT_LABELS[m.kind]} · ${formatFcfa(m.montant)}\nLe solde théorique reprend ce montant.`,
      )
    ) {
      return;
    }
    await post(
      { action: "annuler-mouvement", mouvementId: m.id },
      "Échec de l’annulation",
    );
  }

  const active = board?.active ?? null;
  const theoActive = active ? theo(active) : 0;
  // La caisse affichée est celle résolue par le serveur ; tant qu'aucune
  // réponse valide n'arrive, la première caisse autorisée sert d'étiquette.
  const resolved: CaisseKey = board?.caisse ?? allowed[0] ?? "centrale";
  const label = CAISSE_LABELS[resolved];
  const estCentrale = resolved === "centrale";
  const ecartPreview =
    soldePhysique === "" ? null : Number(soldePhysique) - theoActive;
  const autresCaisses = CAISSES.filter((c) => c !== resolved);
  // Une zone ne verse que vers le coffre central : jamais vers l'autre zone.
  const versementDestinations = autresCaisses.filter(
    (c) => c === "centrale" || allowed.includes(c),
  );

  return (
    <AppShell
      title="Caisse"
      subtitle={
        estCentrale
          ? "Coffre central · versements des zones, dépenses générales"
          : `${label} · encaissements POS, mouvements et clôture`
      }
      actions={
        board ? (
          <ExportExcelButton
            label="Exporter Excel"
            onExport={() =>
              exportCaisseExcel({
                date,
                caisse: resolved,
                historique: board.historique ?? [],
                overview: board.overview ?? null,
                activeMouvements: detail?.mouvements ?? [],
              })
            }
          />
        ) : undefined
      }
    >
      <div className="caisse-page">
        <ContextBar
          date={date}
          onDateChange={setDate}
          siteLabel={CAISSE_SHORT_LABELS[resolved]}
        >
          {allowed.length > 1 ? (
            <div className="site-switch caisse-switch" role="tablist" aria-label="Caisse">
              {allowed.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="tab"
                  aria-selected={caisse === c}
                  className={`site-btn${caisse === c ? " is-active" : ""}`}
                  onClick={() => setCaisse(c)}
                >
                  {CAISSE_SHORT_LABELS[c]}
                </button>
              ))}
            </div>
          ) : null}
          {estCentrale ? null : (
            <Link href="/vente" className="btn btn-ghost">
              → Vente POS
            </Link>
          )}
        </ContextBar>

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

        {board?.overview ? (
          <section className="caisse-overview" aria-label="Soldes du réseau">
            {board.overview.map((o) => (
              <button
                key={o.caisse}
                type="button"
                className={`caisse-overview-card${o.caisse === caisse ? " is-active" : ""}${
                  o.session ? " is-open" : ""
                }`}
                onClick={() => setCaisse(o.caisse)}
              >
                <span className="caisse-overview-label">
                  {CAISSE_LABELS[o.caisse]}
                </span>
                <strong className="mono">
                  {o.session ? formatFcfa(o.soldeTheorique) : "Fermée"}
                </strong>
                <span className="muted">
                  {o.session
                    ? `Ouverte par ${o.session.userName}`
                    : "Aucune session"}
                </span>
              </button>
            ))}
          </section>
        ) : null}

        {loading && !board ? (
          <BrandLoader variant="ligne" label="Chargement de la caisse…" />
        ) : null}

        {/* Ouverture, mouvement, versement, clôture : une opération de caisse
            ne doit pas pouvoir partir deux fois. */}
        {busy ? <BrandLoader variant="voile" label="Opération en cours…" /> : null}

        {/* Tout ce qui suit dépend de la caisse résolue par le serveur : tant
            qu'aucune caisse n'est validée (premier chargement, refus d'accès),
            on n'affiche ni héros ni bouton d'ouverture. */}
        {board ? (
          <>
            {active ? (
              <div className="caisse-hero is-open">
                <div className="caisse-hero-main">
                  <span className="caisse-status">
                    <span className="caisse-status-dot" aria-hidden />
                    {label} ouverte
                  </span>
                  <span className="caisse-hero-label">Solde théorique</span>
                  <strong className="caisse-hero-value mono">
                    {formatFcfa(theoActive)}
                  </strong>
                  <span className="caisse-hero-meta">
                    Ouverte le {formatOpened(active.openedAt)} par{" "}
                    {active.userName}
                  </span>
                  {joursOuverte(active.date) >= 1 ? (
                    <span className="caisse-hero-warn">
                      ⚠ Caisse du {active.date.slice(8)}/
                      {active.date.slice(5, 7)} encore ouverte —{" "}
                      {joursOuverte(active.date)} jour
                      {joursOuverte(active.date) > 1 ? "s" : ""} de retard.
                      Fermez-la pour repasser au jour courant.
                    </span>
                  ) : null}
                </div>
                <div className="caisse-hero-metrics">
                  <div>
                    <span>Fond de caisse</span>
                    <strong className="mono">
                      {formatFcfa(active.soldeInitial)}
                    </strong>
                  </div>
                  {estCentrale ? null : (
                    <div>
                      <span>Ventes</span>
                      <strong className="mono text-ok">
                        +{formatFcfa(active.totalVente)}
                      </strong>
                    </div>
                  )}
                  <div>
                    <span>Dépenses</span>
                    <strong className="mono text-danger">
                      −{formatFcfa(active.totalDepense)}
                    </strong>
                  </div>
                  <div>
                    <span>Autres recettes</span>
                    <strong className="mono">
                      +{formatFcfa(active.totalRecette)}
                    </strong>
                  </div>
                  <div>
                    <span>Versements reçus</span>
                    <strong className="mono text-ok">
                      +{formatFcfa(active.totalVersementRecu)}
                    </strong>
                  </div>
                  <div>
                    <span>Versements sortis</span>
                    <strong className="mono text-danger">
                      −{formatFcfa(active.totalVersementSorti)}
                    </strong>
                  </div>
                </div>
              </div>
            ) : (
              <div className="caisse-hero is-closed">
                <div className="caisse-hero-main">
                  <span className="caisse-status is-idle">
                    <span className="caisse-status-dot" aria-hidden />
                    Aucune session
                  </span>
                  <span className="caisse-hero-label">{label}</span>
                  <strong className="caisse-hero-value">Fermée</strong>
                  <span className="caisse-hero-meta">
                    {estCentrale
                      ? "Ouvrez le coffre pour recevoir les versements des zones"
                      : "Ouvrez la caisse pour encaisser les tickets POS de la zone"}
                  </span>
                </div>
                <div className="caisse-open-card">
                  <label className="caisse-field">
                    <span>Fond de caisse (FCFA)</span>
                    <input
                      type="number"
                      min={0}
                      value={soldeInitial}
                      onChange={(e) => setSoldeInitial(e.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={() => void openCaisse()}
                  >
                    {busy ? "Ouverture…" : `Ouvrir la ${CAISSE_SHORT_LABELS[resolved].toLowerCase()}`}
                  </button>
                </div>
              </div>
            )}

            {active ? (
              <div className="caisse-layout">
                <section className="caisse-panel">
                  <header className="caisse-panel-head">
                    <h2>Mouvement</h2>
                    <p>Dépense ou autre recette hors tickets POS</p>
                  </header>
                  <div className="caisse-kind-switch" role="tablist">
                    <button
                      type="button"
                      className={`caisse-kind-btn${mKind === "depense" ? " is-active is-depense" : ""}`}
                      onClick={() => setMKind("depense")}
                    >
                      Dépense
                    </button>
                    <button
                      type="button"
                      className={`caisse-kind-btn${mKind === "recette" ? " is-active is-recette" : ""}`}
                      onClick={() => setMKind("recette")}
                    >
                      Autre recette
                    </button>
                  </div>
                  <div className="caisse-form-grid">
                    <label className="caisse-field">
                      <span>Nature</span>
                      <input
                        value={mNature}
                        onChange={(e) => setMNature(e.target.value)}
                        placeholder="Ex. course, avance…"
                      />
                    </label>
                    <label className="caisse-field">
                      <span>Bénéficiaire / provenance</span>
                      <input
                        value={mBenef}
                        onChange={(e) => setMBenef(e.target.value)}
                      />
                    </label>
                    <label className="caisse-field">
                      <span>Montant (FCFA)</span>
                      <input
                        type="number"
                        min={0}
                        value={mMontant}
                        onChange={(e) => setMMontant(e.target.value)}
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy || !mNature.trim() || !mMontant}
                    onClick={() => void addMouvement()}
                  >
                    Enregistrer
                  </button>
                </section>

                <section className="caisse-panel">
                  <header className="caisse-panel-head">
                    <h2>Versement</h2>
                    <p>
                      {estCentrale
                        ? "Doter une zone en fond de caisse"
                        : "Verser la recette au coffre central"}
                    </p>
                  </header>
                  <div className="caisse-form-grid">
                    <label className="caisse-field">
                      <span>Vers</span>
                      <select
                        value={vCaisse}
                        onChange={(e) =>
                          setVCaisse(e.target.value as CaisseKey | "")
                        }
                      >
                        <option value="">— Choisir —</option>
                        {versementDestinations.map((c) => (
                          <option key={c} value={c}>
                            {CAISSE_LABELS[c]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="caisse-field">
                      <span>Montant (FCFA)</span>
                      <input
                        type="number"
                        min={0}
                        max={theoActive}
                        value={vMontant}
                        onChange={(e) => setVMontant(e.target.value)}
                      />
                    </label>
                    <label className="caisse-field">
                      <span>Motif</span>
                      <input
                        value={vNature}
                        onChange={(e) => setVNature(e.target.value)}
                        placeholder="Ex. recette du soir"
                      />
                    </label>
                  </div>
                  <p className="muted caisse-hint">
                    Disponible : {formatFcfa(theoActive)} · la caisse
                    d’arrivée doit être ouverte.
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={
                      busy ||
                      !vCaisse ||
                      !vMontant ||
                      Number(vMontant) <= 0 ||
                      Number(vMontant) > theoActive
                    }
                    onClick={() => void verser()}
                  >
                    Verser
                  </button>
                </section>

                <section className="caisse-panel caisse-panel-close">
                  <header className="caisse-panel-head">
                    <h2>Fermeture</h2>
                    <p>Comptez le tiroir puis clôturez la session</p>
                  </header>
                  <label className="caisse-field">
                    <span>Solde physique compté</span>
                    <input
                      type="number"
                      value={soldePhysique}
                      onChange={(e) => setSoldePhysique(e.target.value)}
                      placeholder={String(theoActive)}
                    />
                  </label>
                  {ecartPreview !== null ? (
                    <div
                      className={`caisse-ecart${ecartPreview === 0 ? " is-ok" : " is-warn"}`}
                    >
                      <span>Écart</span>
                      <strong className="mono">
                        {formatFcfa(ecartPreview)}
                      </strong>
                    </div>
                  ) : (
                    <p className="muted caisse-hint">
                      Attendu : {formatFcfa(theoActive)}
                    </p>
                  )}
                  <label className="caisse-field">
                    <span>Observation</span>
                    <textarea
                      rows={2}
                      value={commentaire}
                      onChange={(e) => setCommentaire(e.target.value)}
                      placeholder="Optionnel"
                    />
                  </label>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy || soldePhysique === ""}
                    onClick={() => void closeCaisse()}
                  >
                    Fermer la caisse
                  </button>
                </section>

                {/* Pas de `caisse-panel-wide` ici : la grille est à deux
                    colonnes et quatre panneaux (Mouvement, Versement,
                    Fermeture, Journal) — forcer celui-ci en pleine largeur le
                    poussait seul sur sa ligne et laissait un vide de la
                    hauteur de Fermeture à côté d'elle. En cellule normale, il
                    prend naturellement la place à droite de la clôture, ce
                    qui a du sens : vérifier le journal en comptant le tiroir. */}
                <section className="caisse-panel">
                  <header className="caisse-panel-head">
                    <h2>Journal de session</h2>
                    <p>
                      {detail?.mouvements?.length
                        ? `${detail.mouvements.length} mouvement${detail.mouvements.length > 1 ? "s" : ""}`
                        : "Aucun mouvement hors POS"}
                    </p>
                  </header>
                  {!detail?.mouvements?.length ? (
                    <p className="muted">
                      Les dépenses, recettes et versements apparaîtront ici.
                    </p>
                  ) : (
                    <ul className="caisse-mouvements">
                      {detail.mouvements.map((m) => (
                        <li
                          key={m.id}
                          className={m.cancelledAt ? "is-cancelled" : undefined}
                        >
                          <div>
                            <strong>{MOUVEMENT_LABELS[m.kind]}</strong>
                            <span className="muted">
                              {m.nature}
                              {m.beneficiaire && m.beneficiaire !== "—"
                                ? ` · ${m.beneficiaire}`
                                : ""}
                              {m.actorName ? ` · ${m.actorName}` : ""}
                              {m.cancelledAt
                                ? ` · annulé par ${m.cancelledByName ?? "—"}`
                                : ""}
                            </span>
                          </div>
                          <span
                            className={`mono ${sortDuTiroir(m.kind) ? "text-danger" : "text-ok"}`}
                          >
                            {sortDuTiroir(m.kind) ? "−" : "+"}
                            {formatFcfa(m.montant)}
                          </span>
                          {!m.cancelledAt &&
                          (m.kind === "depense" || m.kind === "recette") ? (
                            <button
                              type="button"
                              className="btn btn-ghost"
                              disabled={busy}
                              onClick={() => void annulerMouvement(m)}
                            >
                              Annuler
                            </button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            ) : null}

            <section className="caisse-panel caisse-history">
              <header className="caisse-panel-head">
                <h2>Historique des sessions</h2>
                <p>{label} · jours précédents</p>
              </header>
              {!board?.historique?.length ? (
                <p className="muted">Pas encore de session enregistrée.</p>
              ) : (
                <div className="caisse-history-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Statut</th>
                        <th>Ouverte par</th>
                        {estCentrale ? null : <th className="col-money">Ventes</th>}
                        <th className="col-money">Versements</th>
                        <th className="col-money">Solde th.</th>
                        <th className="col-money">Écart</th>
                      </tr>
                    </thead>
                    <tbody>
                      {board.historique.map((s) => {
                        const t = theo(s);
                        const ecart =
                          s.soldePhysique === null
                            ? null
                            : s.soldePhysique - t;
                        const versements =
                          s.totalVersementRecu - s.totalVersementSorti;
                        return (
                          <tr key={s.id}>
                            <td>{s.date}</td>
                            <td>
                              <span
                                className={
                                  s.statut === "ouverte"
                                    ? "caisse-pill is-open"
                                    : "caisse-pill"
                                }
                              >
                                {s.statut === "ouverte" ? "Ouverte" : "Fermée"}
                              </span>
                            </td>
                            <td>{s.userName}</td>
                            {estCentrale ? null : (
                              <td className="mono col-money">
                                {formatFcfa(s.totalVente)}
                              </td>
                            )}
                            <td className="mono col-money">
                              {versements === 0 ? "—" : formatFcfa(versements)}
                            </td>
                            <td className="mono col-money">{formatFcfa(t)}</td>
                            <td
                              className={`mono col-money${ecart !== null && ecart !== 0 ? " text-danger" : ""}`}
                            >
                              {ecart === null ? "—" : formatFcfa(ecart)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
