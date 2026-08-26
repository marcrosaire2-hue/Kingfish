"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { BrandLoader } from "@/components/brand-loader";
import { ContextBar } from "@/components/context-bar";
import { formatFcfa } from "@/lib/format";
import type { RapportQuotidien } from "@/lib/rapport-quotidien-repo";
import { todayIsoDate } from "@/lib/zogbo-calc";

export function RapportQuotidienPage() {
  const [date, setDate] = useState(() => todayIsoDate());
  const [site, setSite] = useState<"all" | "zogbo" | "gbegamey">("all");
  const [rapport, setRapport] = useState<RapportQuotidien | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function load(nextDate = date, nextSite = site) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/rapport-quotidien?date=${encodeURIComponent(nextDate)}&site=${nextSite}`,
        { cache: "no-store" },
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Erreur");
      setRapport(body as RapportQuotidien);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(date, site);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, site]);

  async function copyTexte() {
    if (!rapport?.texteBrut) return;
    try {
      await navigator.clipboard.writeText(rapport.texteBrut);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("Impossible de copier le texte.");
    }
  }

  return (
    <AppShell
      title="Rapport quotidien"
      subtitle="CA, équipes, top produits, pertes, écarts caisse, stock critique"
      actions={
        rapport ? (
          <button type="button" className="btn btn-primary" onClick={() => void copyTexte()}>
            {copied ? "Copié" : "Copier pour WhatsApp / e-mail"}
          </button>
        ) : undefined
      }
    >
      <div className="rapport-page">
        <ContextBar date={date} onDateChange={setDate} siteLabel="Rapport">
          <div className="site-switch" role="tablist" aria-label="Site">
            {(
              [
                ["all", "Les deux"],
                ["zogbo", "Zogbo"],
                ["gbegamey", "Gbégamey"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={site === value}
                className={`site-btn${site === value ? " is-active" : ""}`}
                onClick={() => setSite(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </ContextBar>

        {error ? (
          <p className="error-banner" role="alert">
            {error}
          </p>
        ) : null}
        {loading && !rapport ? (
          <BrandLoader variant="ligne" label="Génération du rapport…" />
        ) : null}

        {rapport ? (
          <>
            <section className="rapport-totaux">
              <div>
                <span>CA total</span>
                <strong className="mono">{formatFcfa(rapport.totaux.ca)}</strong>
              </div>
              <div>
                <span>Ventes</span>
                <strong className="mono">{rapport.totaux.ventesCount}</strong>
              </div>
              <div>
                <span>Panier moyen</span>
                <strong className="mono">
                  {formatFcfa(rapport.totaux.panierMoyen)}
                </strong>
              </div>
              <div>
                <span>Pertes</span>
                <strong className="mono">
                  {formatFcfa(rapport.totaux.pertesMontant)}
                </strong>
              </div>
              <div>
                <span>Écarts caisse</span>
                <strong className="mono">
                  {formatFcfa(rapport.totaux.ecartsCaisse)}
                </strong>
              </div>
            </section>

            {rapport.sites.map((s) => (
              <section key={s.site} className="rapport-site panel">
                <header>
                  <h2>{s.label}</h2>
                  <span className="muted">
                    Caisse : {s.caisseStatut}
                    {s.ecartCaisse !== null
                      ? ` · écart ${formatFcfa(s.ecartCaisse)}`
                      : ""}
                  </span>
                </header>
                <div className="rapport-site-metrics">
                  <div>
                    <span>CA</span>
                    <strong className="mono">{formatFcfa(s.ca)}</strong>
                  </div>
                  <div>
                    <span>Jour</span>
                    <strong className="mono">{formatFcfa(s.caJour)}</strong>
                  </div>
                  <div>
                    <span>Nuit</span>
                    <strong className="mono">{formatFcfa(s.caNuit)}</strong>
                  </div>
                  <div>
                    <span>Ventes</span>
                    <strong className="mono">{s.ventesCount}</strong>
                  </div>
                  <div>
                    <span>Pertes</span>
                    <strong className="mono">
                      {formatFcfa(s.pertesMontant)}
                    </strong>
                  </div>
                </div>
                {s.topProduits.length ? (
                  <div className="rapport-block">
                    <h3>Top produits</h3>
                    <ul>
                      {s.topProduits.map((p) => (
                        <li key={p.name}>
                          {p.name} · {p.qty} · {formatFcfa(p.amount)}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {s.stockCritique.length ? (
                  <div className="rapport-block">
                    <h3>Stock critique</h3>
                    <ul>
                      {s.stockCritique.map((p) => (
                        <li key={`${p.kind}-${p.name}`}>
                          {p.name}
                          {p.stockLeft !== null ? ` · reste ${p.stockLeft}` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="muted">Aucun stock critique signalé.</p>
                )}
              </section>
            ))}

            <section className="rapport-texte panel">
              <header>
                <h2>Texte d&apos;envoi</h2>
                <p className="muted">
                  Copiez vers WhatsApp ou e-mail (aucune API d&apos;envoi
                  branchée).
                </p>
              </header>
              <pre className="rapport-pre">{rapport.texteBrut}</pre>
            </section>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
