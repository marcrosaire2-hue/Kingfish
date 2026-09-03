"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { BrandLoader } from "@/components/brand-loader";
import {
  CHART_COLORS,
  HorizontalBars,
} from "@/components/charts/charts";
import { AnalyseChartsPanel } from "@/components/analyse/analyse-charts-panel";
import {
  DashboardBody,
  DashboardSectionNav,
  DashboardShell,
  DashboardToolbar,
} from "@/components/dashboard/dashboard-layout";
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

  if (loading && !report) {
    return (
      <AppShell
        title="Analyse"
        subtitle="Lecture managériale du CA, des marges et des charges."
        mainClassName="main-analyse"
      >
        <BrandLoader variant="ligne" label="Analyse des données…" />
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Analyse"
      subtitle="Lecture managériale du CA, des marges, des stocks et des charges — sans réécrire la comptabilité."
      mainClassName="main-analyse"
    >
      <DashboardShell>
        <details className="journal-filters-fold" open>
          <summary className="journal-filters-summary">
            Filtres
            <span className="journal-filters-summary-hint">
              Période, site, équipe…
            </span>
          </summary>
        <DashboardToolbar
          tabs={PERIODS}
          activeTab={period}
          onTabChange={(id) => {
            const next = id as AnalysePeriod;
            setPeriod(next);
            if (next === "month") {
              const today = todayIsoDate();
              // Mois en cours : jusqu’à aujourd’hui. Sinon on garde la date.
              if (date.slice(0, 7) === today.slice(0, 7)) setDate(today);
            }
          }}
          filters={
            <>
              <label className="date-field date-field-pill">
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
                <label className="date-field date-field-pill">
                  <span>Site</span>
                  <select value={site} onChange={(e) => setSite(e.target.value)}>
                    <option value="all">Les deux sites</option>
                    <option value="zogbo">{SITE_LABELS.zogbo}</option>
                    <option value="gbegamey">{SITE_LABELS.gbegamey}</option>
                  </select>
                </label>
              )}
              <label className="date-field date-field-pill">
                <span>Équipe</span>
                <select value={shift} onChange={(e) => setShift(e.target.value)}>
                  <option value="all">Toutes</option>
                  <option value="jour">Jour</option>
                  <option value="soir">Soir</option>
                  <option value="nuit">Nuit</option>
                  <option value="aucune">Hors équipe</option>
                </select>
              </label>
              <label className="date-field date-field-pill">
                <span>Nature</span>
                <select value={kind} onChange={(e) => setKind(e.target.value)}>
                  <option value="all">Toutes</option>
                  <option value="plat">Plats</option>
                  <option value="boisson">Boissons</option>
                  <option value="local">Accompagnements</option>
                  <option value="extra">Extra</option>
                </select>
              </label>
            </>
          }
        />
        </details>

        {error ? (
          <p className="error-banner" role="alert">
            {error}
          </p>
        ) : null}

        {report ? (
          <>
            <DashboardSectionNav
              label="Sections analyse"
              sections={SECTIONS.map((s) => ({
                id: s.id,
                label: s.label,
                badge:
                  s.id === "produits" && report.products.length > 0
                    ? report.products.length
                    : undefined,
              }))}
              active={section}
              onChange={setSection}
            />

            <DashboardBody className={loading ? "is-loading" : undefined}>
              {section === "synthese" ? (
                <div className="analyse-section-panel" role="tabpanel">
                  <section className="dash-ca-final" aria-label="Résultat de la période">
                    <div className="dash-ca-final-main">
                      <span className="dash-ca-final-label">CA net</span>
                      <strong className="dash-ca-final-value mono">
                        {formatFcfa(report.current.caNet)}
                      </strong>
                      <span className="dash-ca-final-hint">
                        {report.window.label}
                        {" · "}
                        <span className={`analyse-delta ${deltaClass(report.caChangePct)}`}>
                          {fmtPct(report.caChangePct)}
                        </span>
                        {" vs "}
                        {report.window.previousLabel}
                        {report.filteredCa
                          ? " · CA filtré (CMV et charges restent au périmètre maison / site)"
                          : ""}
                      </span>
                    </div>
                    <div className="dash-ca-final-side">
                      <div>
                        <span>CA {report.window.previousLabel}</span>
                        <strong className="mono">
                          {formatFcfa(report.previous.caNet)}
                        </strong>
                      </div>
                      <div>
                        <span>Marge brute</span>
                        <strong className="mono">
                          {report.current.margeBrute === null
                            ? "n.d."
                            : formatFcfa(report.current.margeBrute)}
                        </strong>
                      </div>
                      <div>
                        <span>Charges</span>
                        <strong className="mono">
                          {formatFcfa(report.current.chargesExploitation)}
                        </strong>
                      </div>
                      <div>
                        <span>Résultat</span>
                        <strong className="mono">
                          {formatFcfa(report.current.resultat)}
                        </strong>
                      </div>
                    </div>
                  </section>

                  <section className="analyse-health" aria-label="Santé de l’activité">
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
                          color: i === 0 ? CHART_COLORS.zogbo : CHART_COLORS.gbegamey,
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
                </div>
              ) : null}

              {section === "signaux" ? (
                <div className="analyse-section-panel" role="tabpanel">
                  <section className="analyse-brief" aria-label="Lecture managériale">
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
                        <p className="muted">Rien à recommander sans signal mesurable.</p>
                      )}
                    </div>
                  </section>
                </div>
              ) : null}

              {section === "graphiques" ? (
                <div className="analyse-section-panel" role="tabpanel">
                  <AnalyseChartsPanel report={report} kindSlices={kindSlices} />
                </div>
              ) : null}

              {section === "produits" ? (
                <div className="analyse-section-panel" role="tabpanel">
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
                                <td className="num mono">{formatFcfa(p.caNet)}</td>
                                <td className="num mono">{formatFcfa(p.remises)}</td>
                                <td className="num mono">
                                  {p.costKnown ? formatFcfa(p.costAmount) : "coût inconnu"}
                                </td>
                                <td className="num mono">
                                  {p.marginPct === null ? "—" : `${p.marginPct.toFixed(0)} %`}
                                </td>
                                <td className="num mono">{fmtPct(p.qtyChangePct)}</td>
                                <td>
                                  <span className={`analyse-advice ${adviceClass(p.advice)}`}>
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
                      Achats stock {formatFcfa(report.current.achatsStock)} · acquisitions{" "}
                      {formatFcfa(report.current.acquisitionsImmobilisations)} · sorties de
                      caisse {formatFcfa(report.current.caisseDepenses)} (hors résultat, M1 /
                      G8 / G9).
                    </p>
                  </details>
                </div>
              ) : null}
            </DashboardBody>
          </>
        ) : null}
      </DashboardShell>
    </AppShell>
  );
}
