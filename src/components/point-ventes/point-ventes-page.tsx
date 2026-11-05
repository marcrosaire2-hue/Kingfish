"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { BrandLoader } from "@/components/brand-loader";
import {
  DashKpiGrid,
  DashboardSectionNav,
  DashboardShell,
  DashboardToolbar,
} from "@/components/dashboard/dashboard-layout";
import { formatFcfa } from "@/lib/format";
import type { PointArticle, PointFamille } from "@/lib/point-ventes-calc";
import type { PointVentesPayload } from "@/lib/point-ventes-repo";
import type { VenteSite } from "@/lib/types";
import { shiftIsoDate, todayIsoDate } from "@/lib/zogbo-calc";

type SiteFilter = "all" | VenteSite;
type Periode = "jour" | "semaine" | "mois" | "perso";
type FamilleKey = "plats" | "accompagnements" | "boissons";

const PERIODES: Array<{ id: Periode; label: string }> = [
  { id: "jour", label: "Aujourd’hui" },
  { id: "semaine", label: "7 jours" },
  { id: "mois", label: "Ce mois" },
  { id: "perso", label: "Personnalisé" },
];

const FAMILLES: Array<{ id: FamilleKey; label: string; unite: string }> = [
  { id: "plats", label: "Plats", unite: "plats" },
  { id: "accompagnements", label: "Accompagnements", unite: "accompagnements" },
  { id: "boissons", label: "Boissons", unite: "boissons" },
];

function bornes(periode: Exclude<Periode, "perso">): { from: string; to: string } {
  const to = todayIsoDate();
  if (periode === "jour") return { from: to, to };
  if (periode === "semaine") return { from: shiftIsoDate(to, -6) ?? to, to };
  return { from: `${to.slice(0, 7)}-01`, to };
}

export function PointVentesPage() {
  const [periode, setPeriode] = useState<Periode>("mois");
  const [from, setFrom] = useState(() => bornes("mois").from);
  const [to, setTo] = useState(todayIsoDate);
  const [site, setSite] = useState<SiteFilter>("all");
  const [limite, setLimite] = useState(10);
  const [famille, setFamille] = useState<FamilleKey>("plats");
  const [lockedSite, setLockedSite] = useState(false);
  const [data, setData] = useState<PointVentesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ from, to, site, limite: String(limite) });
      const res = await fetch(`/api/point-ventes?${params}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Chargement impossible");
      setData(body as PointVentesPayload);
      setLockedSite(Boolean(body.lockedSite));
      if (body.lockedSite && (body.site === "zogbo" || body.site === "gbegamey")) {
        setSite(body.site);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }, [from, to, site, limite]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  function choisirPeriode(id: string) {
    const p = id as Periode;
    setPeriode(p);
    if (p !== "perso") {
      const b = bornes(p);
      setFrom(b.from);
      setTo(b.to);
    }
  }

  const courante = data ? data[famille] : null;
  const total = data
    ? {
        amount: data.plats.amount + data.accompagnements.amount + data.boissons.amount,
        qty: data.plats.qty + data.accompagnements.qty + data.boissons.qty,
        vendus: data.plats.vendus + data.accompagnements.vendus + data.boissons.vendus,
        jamais:
          data.plats.jamaisVendus +
          data.accompagnements.jamaisVendus +
          data.boissons.jamaisVendus,
      }
    : null;

  return (
    <AppShell
      title="Point des ventes"
      subtitle="Ce qui se vend le mieux, ce qui se vend mal, et ce qui ne se vend pas."
      mainClassName="main-point-ventes"
      actions={
        <button type="button" className="btn btn-ghost" onClick={() => void load()} disabled={loading}>
          Actualiser
        </button>
      }
    >
      <DashboardShell>
        <DashboardToolbar
          tabs={PERIODES}
          activeTab={periode}
          onTabChange={choisirPeriode}
          filters={
            <>
              <label className="date-field date-field-pill">
                <span>Du</span>
                <input
                  type="date"
                  value={from}
                  max={to}
                  onChange={(e) => {
                    setPeriode("perso");
                    setFrom(e.target.value);
                  }}
                />
              </label>
              <label className="date-field date-field-pill">
                <span>Au</span>
                <input
                  type="date"
                  value={to}
                  min={from}
                  max={todayIsoDate()}
                  onChange={(e) => {
                    setPeriode("perso");
                    setTo(e.target.value);
                  }}
                />
              </label>
              <label className="date-field date-field-pill">
                <span>Site</span>
                <select
                  className="select-input"
                  value={site}
                  onChange={(e) => setSite(e.target.value as SiteFilter)}
                  disabled={lockedSite}
                >
                  {!lockedSite ? <option value="all">Tous</option> : null}
                  <option value="zogbo">Zogbo</option>
                  <option value="gbegamey">Gbégamey</option>
                </select>
              </label>
              <label className="date-field date-field-pill">
                <span>Classement</span>
                <select
                  className="select-input"
                  value={limite}
                  onChange={(e) => setLimite(Number(e.target.value))}
                >
                  <option value={5}>5 articles</option>
                  <option value={10}>10 articles</option>
                  <option value={20}>20 articles</option>
                </select>
              </label>
            </>
          }
        />

        {error ? (
          <p className="error-banner" role="alert">
            {error}
          </p>
        ) : null}

        {loading && !data ? <BrandLoader label="Calcul du point des ventes…" /> : null}

        {data && total && courante ? (
          <>
            <DashKpiGrid
              items={[
                { label: "Chiffre d’affaires", value: formatFcfa(total.amount), tone: "accent" },
                { label: "Unités vendues", value: String(total.qty) },
                { label: "Articles vendus", value: String(total.vendus) },
                {
                  label: "Articles jamais vendus",
                  value: String(total.jamais),
                  tone: total.jamais > 0 ? "warn" : undefined,
                },
              ]}
            />

            <DashboardSectionNav
              label="Familles d’articles"
              active={famille}
              onChange={setFamille}
              sections={FAMILLES.map((f) => ({
                id: f.id,
                label: f.label,
                badge: data[f.id].vendus,
              }))}
            />

            <p className="pv-resume muted">
              {courante.total} {FAMILLES.find((f) => f.id === famille)?.unite} au catalogue ·{" "}
              <strong>{courante.vendus} vendu(s)</strong> · {courante.qty} unité(s) ·{" "}
              {formatFcfa(courante.amount)}
            </p>

            <div className="dash-grid">
              <section className="panel dash-card pv-card is-top">
                <div className="panel-head">
                  <h2 className="panel-title">Les mieux vendus</h2>
                </div>
                <Classement
                  articles={courante.top}
                  maxQty={courante.top[0]?.qty ?? 0}
                  vide="Aucune vente sur cette période."
                />
              </section>
              <section className="panel dash-card pv-card is-flop">
                <div className="panel-head">
                  <h2 className="panel-title">Les moins vendus</h2>
                </div>
                <Classement
                  articles={courante.flop}
                  maxQty={courante.top[0]?.qty ?? 0}
                  vide={
                    courante.vendus === 1
                      ? "Un seul article vendu sur cette période."
                      : "Aucune vente sur cette période."
                  }
                />
              </section>
            </div>

            <JamaisVendus famille={courante} />
          </>
        ) : null}
      </DashboardShell>
    </AppShell>
  );
}

function Classement({
  articles,
  maxQty,
  vide,
}: {
  articles: PointArticle[];
  maxQty: number;
  vide: string;
}) {
  if (articles.length === 0) return <p className="muted">{vide}</p>;
  return (
    <ol className="pv-rank">
      {articles.map((a, i) => {
        const pct = maxQty > 0 ? Math.max(4, Math.round((a.qty / maxQty) * 100)) : 0;
        return (
          <li key={a.productId} className="pv-rank-row">
            <span className="pv-rank-num mono">{i + 1}</span>
            <div className="pv-rank-main">
              <div className="pv-rank-line">
                <strong className="pv-rank-name">{a.name}</strong>
                <span className="pv-rank-qty mono">{a.qty}</span>
              </div>
              <div className="pv-rank-line">
                <span className="pv-bar-track" aria-hidden>
                  <span className="pv-bar" style={{ width: `${pct}%` }} />
                </span>
                <span className="pv-rank-amount mono muted">{formatFcfa(a.amount)}</span>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function JamaisVendus({ famille }: { famille: PointFamille }) {
  return (
    <section className="panel dash-card pv-card is-zero">
      <div className="panel-head">
        <h2 className="panel-title">Jamais vendus sur la période</h2>
        <p className="muted">{famille.jamaisVendus} article(s)</p>
      </div>
      {famille.jamaisVendusListe.length === 0 ? (
        <p className="muted">Tous les articles ont été vendus au moins une fois.</p>
      ) : (
        <ul className="pv-zero-list">
          {famille.jamaisVendusListe.map((a) => (
            <li key={a.productId}>{a.name}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
