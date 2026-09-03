"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { BrandLoader } from "@/components/brand-loader";
import {
  CHART_COLORS,
  HorizontalBars,
} from "@/components/charts/charts";
import { AnalyseChartsPanel } from "@/components/analyse/analyse-charts-panel";
import { formatFcfa } from "@/lib/format";
import { SITE_LABELS } from "@/lib/auth-types";
import { todayIsoDate } from "@/lib/zogbo-calc";
import {
  lastDayOfMonth,
  type AnalysePeriod,
  type AnalyseReport,
  type HealthCard,
  type HealthTone,
  type Insight,
  type InsightKind,
  type ProductAdvice,
} from "@/lib/analyse-calc";
import "./analyse-page.css";

type Payload = {
  report: AnalyseReport;
  lockedSite: boolean;
  userSite: string;
};

const PERIODS: { id: AnalysePeriod; label: string }[] = [
  { id: "day", label: "Jour" },
  { id: "month", label: "Mois" },
];

function toneClass(tone: HealthTone | Insight["tone"]): string {
  if (tone === "ok") return "is-ok";
  if (tone === "risque") return "is-risk";
  if (tone === "attention") return "is-watch";
  return "is-mute";
}

function kindBadge(kind: InsightKind): string {
  if (kind === "fait") return "Fait";
  if (kind === "estimation") return "Estimation";
  if (kind === "alerte") return "Alerte";
  return "Conseil";
}

function adviceClass(advice: ProductAdvice): string {
  if (advice === "À développer") return "is-ok";
  if (advice === "À surveiller" || advice === "À optimiser") return "is-watch";
  if (advice === "À revoir") return "is-risk";
  return "is-mute";
}

function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined) return "n.d.";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(0)} %`;
}

function toneLabel(tone: HealthTone | Insight["tone"]): string {
  if (tone === "ok") return "Favorable";
  if (tone === "risque") return "Risque";
  if (tone === "attention") return "Vigilance";
  return "Indéterminé";
}

function deltaClass(n: number | null | undefined): string {
  if (n === null || n === undefined || n === 0) return "";
  return n > 0 ? "is-up" : "is-down";
}

function healthOf(
  health: HealthCard[],
  key: HealthCard["key"],
): HealthCard | undefined {
  return health.find((c) => c.key === key);
}

const KIND_LABELS: Record<string, string> = {
  plat: "Plat",
  boisson: "Boisson",
  local: "Accomp.",
  extra: "Extra",
};

type AnalyseSection = "synthese" | "signaux" | "graphiques" | "produits";

const SECTIONS: { id: AnalyseSection; label: string }[] = [
  { id: "synthese", label: "Synthèse" },
  { id: "signaux", label: "Signaux" },
  { id: "graphiques", label: "Graphiques" },
  { id: "produits", label: "Produits" },
];

function InsightCard({ item }: { item: Insight }) {
  return (
    <article className={`analyse-insight ${toneClass(item.tone)}`}>
      <header>
        <span className="analyse-badge">{kindBadge(item.kind)}</span>
        <h3>{item.title}</h3>
      </header>
      <p>{item.body}</p>
      {item.action ? (
        <p className="analyse-insight-action">
          <span>À faire</span> {item.action}
        </p>
      ) : null}
      <footer>
        {item.metric ? <span className="mono">{item.metric}</span> : <span />}
        <span>Confiance {item.confidence}</span>
      </footer>
    </article>
  );
}

function HealthChip({
  tone,
  label,
  summary,
}: {
  tone: HealthTone;
  label: string;
  summary: string;
}) {
  return (
    <article className={`analyse-health-card ${toneClass(tone)}`}>
      <span className="analyse-health-tone">{toneLabel(tone)}</span>
      <h2>{label}</h2>
      <p>{summary}</p>
    </article>
  );
}

export function AnalysePage() {
  const [period, setPeriod] = useState<AnalysePeriod>("month");
  const [date, setDate] = useState(todayIsoDate);
  const [site, setSite] = useState("all");
  const [shift, setShift] = useState("all");
  const [kind, setKind] = useState("all");
  const [section, setSection] = useState<AnalyseSection>("synthese");
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ period, date, site, shift, kind });
      const res = await fetch(`/api/analyse?${qs}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Chargement impossible");
      setPayload(body as Payload);
    } catch (e) {
      setPayload(null);
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setLoading(false);
    }
  }, [period, date, site, shift, kind]);

  useEffect(() => {
    void load();
  }, [load]);

  const report = payload?.report;
  const lockedSite = payload?.lockedSite ?? false;
  const commercial = report ? healthOf(report.health, "commercial") : undefined;
  const margeHealth = report ? healthOf(report.health, "marge") : undefined;
  const depenseHealth = report ? healthOf(report.health, "depenses") : undefined;
  const stocksHealth = report ? healthOf(report.health, "stocks") : undefined;

  const kindSlices = useMemo(() => {
    if (!report) return [];
    const colors: Record<string, string> = {
      plat: CHART_COLORS.plats,
      boisson: CHART_COLORS.boissons,
      local: CHART_COLORS.accompagnements,
      extra: CHART_COLORS.extra,
    };
    return report.byKind.map((row) => ({
      key: row.key,
      label: row.label,
      value: row.caNet,
      color: colors[row.key] ?? CHART_COLORS.accent,
    }));
  }, [report]);

  function changePeriod(next: AnalysePeriod) {
    setPeriod(next);
    if (next === "month") {
      const today = todayIsoDate();
      if (date.slice(0, 7) === today.slice(0, 7)) setDate(today);
    }
  }

  return (
    <AppShell
      title="Analyse"
      subtitle="CA, marges, stocks et charges — lecture managériale, sans réécrire la comptabilité."
      mainClassName="main-analyse"
    >
      <div className="analyse-page">
        <header className="analyse-hero">
          <div className="analyse-hero-main">
            <div
              className="analyse-period-tabs"
              role="tablist"
              aria-label="Période"
            >
              {PERIODS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="tab"
                  aria-selected={period === p.id}
                  className={`analyse-period-tab${period === p.id ? " is-active" : ""}`}
                  onClick={() => changePeriod(p.id)}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="analyse-filters">
              <label className="analyse-field">
                <span>{period === "day" ? "Jour" : "Mois"}</span>
                {period === "month" ? (
                  <input
                    type="month"
                    value={date.slice(0, 7)}
                    max={todayIsoDate().slice(0, 7)}
                    onChange={(e) => {
                      const ym = e.target.value;
                      if (!/^\d{4}-\d{2}$/.test(ym)) return;
                      const today = todayIsoDate();
                      const end = lastDayOfMonth(ym);
                      setDate(ym === today.slice(0, 7) ? today : end);
                    }}
                  />
                ) : (
                  <input
                    type="date"
                    value={date}
                    max={todayIsoDate()}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
                      setDate(v);
                    }}
                  />
                )}
              </label>

              {lockedSite ? null : (
                <label className="analyse-field">
                  <span>Site</span>
                  <select
                    value={site}
                    onChange={(e) => setSite(e.target.value)}
                  >
                    <option value="all">Les deux sites</option>
                    <option value="zogbo">{SITE_LABELS.zogbo}</option>
                    <option value="gbegamey">{SITE_LABELS.gbegamey}</option>
                  </select>
                </label>
              )}

              <label className="analyse-field">
                <span>Équipe</span>
                <select
                  value={shift}
                  onChange={(e) => setShift(e.target.value)}
                >
                  <option value="all">Toutes</option>
                  <option value="jour">Jour</option>
                  <option value="soir">Soir</option>
                  <option value="nuit">Nuit</option>
                  <option value="aucune">Hors équipe</option>
                </select>
              </label>

              <label className="analyse-field">
                <span>Nature</span>
                <select value={kind} onChange={(e) => setKind(e.target.value)}>
                  <option value="all">Toutes</option>
                  <option value="plat">Plats</option>
                  <option value="boisson">Boissons</option>
                  <option value="local">Accompagnements</option>
                  <option value="extra">Extra</option>
                </select>
              </label>
            </div>
          </div>

          <div className="analyse-ca-card" aria-label="Chiffre d’affaires net">
            <span className="analyse-ca-label">CA net</span>
            <strong className="analyse-ca-value mono">
              {loading && !report ? "…" : formatFcfa(report?.current.caNet ?? 0)}
            </strong>
            {report ? (
              <>
                <p className="analyse-ca-meta">
                  {report.window.label}
                  {" · "}
                  <span className={`analyse-delta ${deltaClass(report.caChangePct)}`}>
                    {fmtPct(report.caChangePct)}
                  </span>
                </p>
                <p className="analyse-ca-prev">
                  {report.window.previousLabel}
                  {" · "}
                  <strong className="mono">
                    {formatFcfa(report.previous.caNet)}
                  </strong>
                </p>
              </>
            ) : (
              <p className="analyse-ca-meta">Chargement de la période…</p>
            )}
          </div>
        </header>

        {error ? (
          <p className="error-banner" role="alert">
            {error}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => void load()}
            >
              Réessayer
            </button>
          </p>
        ) : null}

        {loading && !report ? (
          <BrandLoader variant="ligne" label="Analyse des données…" />
        ) : null}

        {!loading && !report && !error ? (
          <p className="analyse-empty">Aucune donnée pour cette période.</p>
        ) : null}

        {report ? (
          <>
            {report.filteredCa ? (
              <p className="analyse-filtered-note" role="note">
                CA filtré (équipe / nature). CMV, charges et résultat restent
                au périmètre maison / site.
              </p>
            ) : null}

            <nav
              className="analyse-section-nav"
              role="tablist"
              aria-label="Sections analyse"
            >
              {SECTIONS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  aria-selected={section === s.id}
                  className={`analyse-section-tab${section === s.id ? " is-active" : ""}`}
                  onClick={() => setSection(s.id)}
                >
                  {s.label}
                  {s.id === "produits" && report.products.length > 0 ? (
                    <span className="analyse-section-badge">
                      {report.products.length}
                    </span>
                  ) : null}
                </button>
              ))}
            </nav>

            <div
              className={`analyse-body${loading ? " is-loading" : ""}`}
              role="tabpanel"
            >
              {section === "synthese" ? (
                <>
                  <section className="analyse-kpi-grid" aria-label="Indicateurs">
                    <div className="analyse-kpi">
                      <span>Marge brute</span>
                      <strong className="mono">
                        {report.current.margeBrute === null
                          ? "n.d."
                          : formatFcfa(report.current.margeBrute)}
                      </strong>
                    </div>
                    <div className="analyse-kpi">
                      <span>Charges</span>
                      <strong className="mono">
                        {formatFcfa(report.current.chargesExploitation)}
                      </strong>
                    </div>
                    <div className="analyse-kpi">
                      <span>Résultat</span>
                      <strong className="mono">
                        {formatFcfa(report.current.resultat)}
                      </strong>
                    </div>
                    <div className="analyse-kpi">
                      <span>CMV</span>
                      <strong className="mono">
                        {formatFcfa(report.current.cmv)}
                      </strong>
                    </div>
                  </section>

                  <section
                    className="analyse-health"
                    aria-label="Santé de l’activité"
                  >
                    <HealthChip
                      tone={commercial?.tone ?? "indetermine"}
                      label={commercial?.label ?? "Santé commerciale"}
                      summary={commercial?.summary ?? ""}
                    />
                    <HealthChip
                      tone={margeHealth?.tone ?? "indetermine"}
                      label={margeHealth?.label ?? "Santé de la marge"}
                      summary={margeHealth?.summary ?? ""}
                    />
                    <HealthChip
                      tone={depenseHealth?.tone ?? "indetermine"}
                      label={depenseHealth?.label ?? "Niveau de dépenses"}
                      summary={depenseHealth?.summary ?? ""}
                    />
                    <HealthChip
                      tone={stocksHealth?.tone ?? "indetermine"}
                      label={stocksHealth?.label ?? "Santé des stocks"}
                      summary={stocksHealth?.summary ?? ""}
                    />
                  </section>

                  <div className="analyse-split-panels">
                    <section className="panel">
                      <h2 className="panel-title">Sites</h2>
                      <HorizontalBars
                        rows={report.bySite.map((r, i) => ({
                          key: r.key,
                          label: r.label,
                          value: r.caNet,
                          color:
                            i === 0
                              ? CHART_COLORS.zogbo
                              : CHART_COLORS.gbegamey,
                        }))}
                      />
                    </section>
                    <section className="panel">
                      <h2 className="panel-title">Équipes</h2>
                      <HorizontalBars
                        rows={report.byShift.map((r) => ({
                          key: r.key,
                          label: r.label,
                          value: r.caNet,
                          color: CHART_COLORS.plats,
                        }))}
                      />
                    </section>
                  </div>
                </>
              ) : null}

              {section === "signaux" ? (
                <section
                  className="analyse-brief"
                  aria-label="Lecture managériale"
                >
                  <div className="panel analyse-brief-col">
                    <h2 className="panel-title">Ce qui va bien</h2>
                    {report.positives.length ? (
                      report.positives.map((item) => (
                        <InsightCard key={item.id} item={item} />
                      ))
                    ) : (
                      <p className="muted">Pas de signal positif assez net.</p>
                    )}
                  </div>
                  <div className="panel analyse-brief-col">
                    <h2 className="panel-title">À surveiller</h2>
                    {report.watches.length ? (
                      report.watches.map((item) => (
                        <InsightCard key={item.id} item={item} />
                      ))
                    ) : (
                      <p className="muted">Aucune alerte relative.</p>
                    )}
                  </div>
                  <div className="panel analyse-brief-col">
                    <h2 className="panel-title">Conseils</h2>
                    {report.conseils.length ? (
                      report.conseils.map((item) => (
                        <InsightCard key={item.id} item={item} />
                      ))
                    ) : (
                      <p className="muted">
                        Rien à recommander sans signal mesurable.
                      </p>
                    )}
                  </div>
                </section>
              ) : null}

              {section === "graphiques" ? (
                <AnalyseChartsPanel report={report} kindSlices={kindSlices} />
              ) : null}

              {section === "produits" ? (
                <>
                  <section className="panel panel-wide">
                    <h2 className="panel-title">Produits</h2>
                    <div className="table-scroll">
                      <table className="data-table analyse-table">
                        <thead>
                          <tr>
                            <th>Produit</th>
                            <th>Nature</th>
                            <th className="num">Qté</th>
                            <th className="num">CA net</th>
                            <th className="num">Remise</th>
                            <th className="num">Coût</th>
                            <th className="num">Marge</th>
                            <th className="num">Évolution</th>
                            <th>Conseil</th>
                          </tr>
                        </thead>
                        <tbody>
                          {report.products.length === 0 ? (
                            <tr>
                              <td colSpan={9} className="muted">
                                Aucune vente active sur la période.
                              </td>
                            </tr>
                          ) : (
                            report.products.map((p) => (
                              <tr key={`${p.kind}:${p.productId}`}>
                                <td>{p.name}</td>
                                <td>{KIND_LABELS[p.kind] ?? p.kind}</td>
                                <td className="num mono">{p.qty}</td>
                                <td className="num mono">
                                  {formatFcfa(p.caNet)}
                                </td>
                                <td className="num mono">
                                  {formatFcfa(p.remises)}
                                </td>
                                <td className="num mono">
                                  {p.costKnown
                                    ? formatFcfa(p.costAmount)
                                    : "coût inconnu"}
                                </td>
                                <td className="num mono">
                                  {p.marginPct === null
                                    ? "—"
                                    : `${p.marginPct.toFixed(0)} %`}
                                </td>
                                <td className="num mono">
                                  {fmtPct(p.qtyChangePct)}
                                </td>
                                <td>
                                  <span
                                    className={`analyse-advice ${adviceClass(p.advice)}`}
                                  >
                                    {p.advice}
                                  </span>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </section>

                  <details className="panel analyse-notes">
                    <summary className="panel-title">Limites de lecture</summary>
                    <ul>
                      {report.limitations.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                    <p className="muted">
                      Achats stock {formatFcfa(report.current.achatsStock)} ·
                      acquisitions{" "}
                      {formatFcfa(report.current.acquisitionsImmobilisations)} ·
                      sorties de caisse{" "}
                      {formatFcfa(report.current.caisseDepenses)} (hors
                      résultat, M1 / G8 / G9).
                    </p>
                  </details>
                </>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
