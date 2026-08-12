"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ContextBar } from "@/components/context-bar";
import { formatFcfa } from "@/lib/format";
import type {
  CaisseMouvement,
  CaisseSession,
  VenteSite,
} from "@/lib/types";
import { todayIsoDate } from "@/lib/zogbo-calc";

type Board = {
  date: string;
  site: VenteSite;
  active: CaisseSession | null;
  historique: CaisseSession[];
  lockedSite?: boolean;
};

type Detail = {
  session: CaisseSession;
  mouvements: CaisseMouvement[];
  soldeTheorique: number;
  ecart: number | null;
};

function theo(s: CaisseSession) {
  return s.soldeInitial + s.totalVente + s.totalRecette - s.totalDepense;
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

export function CaissePage() {
  const [date, setDate] = useState(() => todayIsoDate());
  const [site, setSite] = useState<VenteSite>("gbegamey");
  const [lockedSite, setLockedSite] = useState(false);
  const [board, setBoard] = useState<Board | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [soldeInitial, setSoldeInitial] = useState("0");
  const [soldePhysique, setSoldePhysique] = useState("");
  const [commentaire, setCommentaire] = useState("");
  const [mNature, setMNature] = useState("");
  const [mBenef, setMBenef] = useState("");
  const [mMontant, setMMontant] = useState("");
  const [mKind, setMKind] = useState<"depense" | "recette">("depense");

  async function load(nextDate = date, nextSite = site) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/caisse?date=${encodeURIComponent(nextDate)}&site=${nextSite}`,
        { cache: "no-store" },
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Erreur");
      setBoard(body as Board);
      if (body.site) setSite(body.site);
      setLockedSite(!!body.lockedSite);
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
    void load(date, site);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, site]);

  async function openCaisse() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/caisse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "open",
          date,
          site,
          soldeInitial: Number(soldeInitial) || 0,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Échec ouverture");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  async function closeCaisse() {
    if (!board?.active) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/caisse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "close",
          id: board.active.id,
          site,
          soldePhysique: Number(soldePhysique) || 0,
          commentaire,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Échec fermeture");
      setSoldePhysique("");
      setCommentaire("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  async function addMouvement() {
    if (!board?.active) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/caisse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "mouvement",
          id: board.active.id,
          site,
          kind: mKind,
          nature: mNature,
          beneficiaire: mBenef,
          montant: Number(mMontant) || 0,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Échec");
      setMNature("");
      setMBenef("");
      setMMontant("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  const active = board?.active ?? null;
  const theoActive = active ? theo(active) : 0;
  const siteLabel = site === "zogbo" ? "Zogbo" : "Gbégamey";
  const ecartPreview =
    soldePhysique === "" ? null : Number(soldePhysique) - theoActive;

  return (
    <AppShell
      title="Caisse"
      subtitle={`${siteLabel} · ouverture, encaissements et fermeture`}
    >
      <div className="caisse-page">
        <ContextBar date={date} onDateChange={setDate} siteLabel={siteLabel}>
          <div
            className="site-switch"
            role="tablist"
            aria-label="Site"
          >
            <button
              type="button"
              className={`site-btn${site === "zogbo" ? " is-active" : ""}`}
              onClick={() => setSite("zogbo")}
              disabled={lockedSite && site !== "zogbo"}
            >
              Zogbo
            </button>
            <button
              type="button"
              className={`site-btn${site === "gbegamey" ? " is-active" : ""}`}
              onClick={() => setSite("gbegamey")}
              disabled={lockedSite && site !== "gbegamey"}
            >
              Gbégamey
            </button>
          </div>
          <Link href="/vente" className="btn btn-ghost">
            → Vente POS
          </Link>
        </ContextBar>

        {error ? (
          <p className="error-banner" role="alert">
            {error}
          </p>
        ) : null}

        {loading && !board ? (
          <p className="muted">Chargement…</p>
        ) : null}

        {!loading || board ? (
          <>
            {active ? (
              <div className="caisse-hero is-open">
                <div className="caisse-hero-main">
                  <span className="caisse-status">
                    <span className="caisse-status-dot" aria-hidden />
                    Session ouverte
                  </span>
                  <span className="caisse-hero-label">Solde théorique</span>
                  <strong className="caisse-hero-value mono">
                    {formatFcfa(theoActive)}
                  </strong>
                  <span className="caisse-hero-meta">
                    Ouverte le {formatOpened(active.openedAt)} · {siteLabel}
                  </span>
                </div>
                <div className="caisse-hero-metrics">
                  <div>
                    <span>Fond de caisse</span>
                    <strong className="mono">
                      {formatFcfa(active.soldeInitial)}
                    </strong>
                  </div>
                  <div>
                    <span>Ventes</span>
                    <strong className="mono text-ok">
                      +{formatFcfa(active.totalVente)}
                    </strong>
                  </div>
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
                </div>
              </div>
            ) : (
              <div className="caisse-hero is-closed">
                <div className="caisse-hero-main">
                  <span className="caisse-status is-idle">
                    <span className="caisse-status-dot" aria-hidden />
                    Aucune session
                  </span>
                  <span className="caisse-hero-label">Caisse {siteLabel}</span>
                  <strong className="caisse-hero-value">Fermée</strong>
                  <span className="caisse-hero-meta">
                    Ouvrez une session pour encaisser les tickets POS
                  </span>
                </div>
                <div className="caisse-open-card">
                  <label className="caisse-field">
                    <span>Solde initial (FCFA)</span>
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
                    {busy ? "Ouverture…" : "Ouvrir la caisse"}
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

                <section className="caisse-panel caisse-panel-wide">
                  <header className="caisse-panel-head">
                    <h2>Journal de session</h2>
                    <p>
                      {detail?.mouvements?.length
                        ? `${detail.mouvements.length} mouvement${detail.mouvements.length > 1 ? "s" : ""}`
                        : "Aucun mouvement hors POS"}
                    </p>
                  </header>
                  {!detail?.mouvements?.length ? (
                    <p className="muted">Les dépenses et recettes apparaîtront ici.</p>
                  ) : (
                    <ul className="caisse-mouvements">
                      {detail.mouvements.map((m) => (
                        <li key={m.id}>
                          <div>
                            <strong>
                              {m.kind === "depense" ? "Dépense" : "Recette"}
                            </strong>
                            <span className="muted">
                              {m.nature}
                              {m.beneficiaire && m.beneficiaire !== "—"
                                ? ` · ${m.beneficiaire}`
                                : ""}
                            </span>
                          </div>
                          <span
                            className={`mono ${m.kind === "depense" ? "text-danger" : "text-ok"}`}
                          >
                            {m.kind === "depense" ? "−" : "+"}
                            {formatFcfa(m.montant)}
                          </span>
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
                <p>{siteLabel} · jours précédents</p>
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
                        <th className="col-money">Ventes</th>
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
                            <td className="mono col-money">
                              {formatFcfa(s.totalVente)}
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
