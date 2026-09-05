"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { BrandLoader } from "@/components/brand-loader";
import { CHART_COLORS, HorizontalBars } from "@/components/charts/charts";
import { AnalyseChartsPanel } from "@/components/analyse/analyse-charts-panel";
import {
  DashboardSectionNav,
  DashboardShell,
  DashboardToolbar,
} from "@/components/dashboard/dashboard-layout";
import { CataloguePaginationBar } from "@/components/parametres/catalogue-view";
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

const PAGE_SIZE = 12;

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

function normalizeSearch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function useDebouncedValue<T>(value: T, delayMs = 280): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

function paginate<T>(items: T[], page: number, pageSize: number) {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    page: safePage,
    totalPages,
    total,
    from: total === 0 ? 0 : start + 1,
    to: Math.min(start + pageSize, total),
  };
}

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
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const debouncedSearch = useDebouncedValue(search);

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

  const filteredProducts = useMemo(() => {
    if (!report) return [];
    const q = normalizeSearch(debouncedSearch);
    if (!q) return report.products;
    return report.products.filter((p) =>
      normalizeSearch(
        [p.name, KIND_LABELS[p.kind] ?? p.kind, p.advice].join(" "),
      ).includes(q),
    );
  }, [report, debouncedSearch]);

  const pagedProducts = useMemo(
    () => paginate(filteredProducts, page, PAGE_SIZE),
    [filteredProducts, page],
  );

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, section, period, date, site, shift, kind]);

  const signauxCount = report
    ? report.positives.length + report.watches.length + report.conseils.length
    : 0;

  function changePeriod(next: AnalysePeriod) {
    setPeriod(next);
    if (next === "month") {
      const today = todayIsoDate();
      if (date.slice(0, 7) === today.slice(0, 7)) setDate(today);
    }
  }

  const margePct =
    report && report.current.caNet > 0 && report.current.margeBrute !== null
      ? (report.current.margeBrute / report.current.caNet) * 100
      : null;

  return (
    <AppShell
      title="Analyse"
      subtitle={
        report
          ? `${report.window.label} · vs ${report.window.previousLabel}`
          : "CA, marges, stocks et charges — lecture managériale."
      }
      mainClassName="main-analyse"
    >
      <DashboardShell>
        <DashboardToolbar
          tabs={PERIODS}
          activeTab={period}
          onTabChange={(id) => changePeriod(id as AnalysePeriod)}
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
                  <select
                    className="select-input"
                    value={site}
                    onChange={(e) => setSite(e.target.value)}
                  >
                    <option value="all">Les deux sites</option>
                    <option value="zogbo">{SITE_LABELS.zogbo}</option>
                    <option value="gbegamey">{SITE_LABELS.gbegamey}</option>
                  </select>
                </label>
              )}
              <label className="date-field date-field-pill">
                <span>Équipe</span>
                <select
                  className="select-input"
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
              <label className="date-field date-field-pill">
                <span>Nature</span>
                <select
                  className="select-input"
                  value={kind}
                  onChange={(e) => setKind(e.target.value)}
                >
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
          <BrandLoader label="Chargement de l’analyse…" />
        ) : !report && !error ? (
          <div className="analyse-empty">
            <strong>Aucune donnée pour cette période</strong>
            <span>Changez le jour, le mois ou les filtres.</span>
          </div>
        ) : report ? (
          <div className={`dash${loading ? " is-loading" : ""}`}>
            <p className={`section-hint${report.filteredCa ? " is-warn" : ""}`}>
              {report.filteredCa
                ? "CA filtré (équipe / nature). CMV, charges et résultat restent au périmètre maison / site."
                : `Période précédente : ${report.window.previousLabel} · CA ${formatFcfa(report.previous.caNet)}.`}
            </p>

            <div
              className="dash-kpi-grid analyse-kpi-grid"
              aria-label="Indicateurs clés"
            >
              <article className="dash-kpi dash-kpi-tone-gold">
                <div className="dash-kpi-copy">
                  <span className="dash-kpi-label">CA net</span>
                  <span className="dash-kpi-value mono">
                    {formatFcfa(report.current.caNet)}
                  </span>
                  <em className={`analyse-delta ${deltaClass(report.caChangePct)}`}>
                    {fmtPct(report.caChangePct)}
                  </em>
                </div>
              </article>
              <article className="dash-kpi dash-kpi-tone-blue">
                <div className="dash-kpi-copy">
                  <span className="dash-kpi-label">Marge brute</span>
                  <span className="dash-kpi-value mono">
                    {report.current.margeBrute === null
                      ? "n.d."
                      : formatFcfa(report.current.margeBrute)}
                  </span>
                  <em className="analyse-delta">
                    {margePct === null
                      ? "part du CA"
                      : `${margePct.toFixed(0)} % du CA`}
                  </em>
                </div>
              </article>
              <article className="dash-kpi dash-kpi-tone-green">
                <div className="dash-kpi-copy">
                  <span className="dash-kpi-label">Résultat</span>
                  <span className="dash-kpi-value mono">
                    {formatFcfa(report.current.resultat)}
                  </span>
                  <em
                    className={`analyse-delta ${deltaClass(report.resultatChangePct)}`}
                  >
                    {fmtPct(report.resultatChangePct)}
                  </em>
                </div>
              </article>
              <article className="dash-kpi dash-kpi-tone-orange">
                <div className="dash-kpi-copy">
                  <span className="dash-kpi-label">CMV</span>
                  <span className="dash-kpi-value mono">
                    {formatFcfa(report.current.cmv)}
                  </span>
                  <em className={`analyse-delta ${deltaClass(report.cmvChangePct)}`}>
                    {fmtPct(report.cmvChangePct)}
                  </em>
                </div>
              </article>
            </div>

            <DashboardSectionNav
              label="Sections d’analyse"
              active={section}
              onChange={setSection}
              sections={SECTIONS.map((s) => ({
                ...s,
                badge:
                  s.id === "signaux"
                    ? signauxCount
                    : s.id === "produits"
                      ? report.products.length
                      : undefined,
              }))}
            />

            {section === "synthese" ? (
              <>
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

                <div className="dash-grid">
                  <section className="panel dash-card">
                    <div className="panel-head">
                      <h2 className="panel-title">Sites</h2>
                    </div>
                    {report.bySite.length ? (
                      <HorizontalBars
                        rows={report.bySite.map((r, i) => ({
                          key: r.key,
                          label: `${r.label} · ${r.sharePct.toFixed(0)} %`,
                          value: r.caNet,
                          color:
                            i === 0 ? CHART_COLORS.zogbo : CHART_COLORS.gbegamey,
                        }))}
                      />
                    ) : (
                      <p className="muted">Aucune vente ventilée par site.</p>
                    )}
                  </section>
                  <section className="panel dash-card">
                    <div className="panel-head">
                      <h2 className="panel-title">Équipes</h2>
                    </div>
                    {report.byShift.length ? (
                      <HorizontalBars
                        rows={report.byShift.map((r) => ({
                          key: r.key,
                          label: `${r.label} · ${r.sharePct.toFixed(0)} %`,
                          value: r.caNet,
                          color: CHART_COLORS.plats,
                        }))}
                      />
                    ) : (
                      <p className="muted">Aucune vente ventilée par équipe.</p>
                    )}
                  </section>
                </div>
              </>
            ) : null}

            {section === "signaux" ? (
              <section className="analyse-brief" aria-label="Lecture managériale">
                <div className="panel dash-card analyse-brief-col">
                  <h2 className="panel-title">Ce qui va bien</h2>
                  {report.positives.length ? (
                    report.positives.map((item) => (
                      <InsightCard key={item.id} item={item} />
                    ))
                  ) : (
                    <p className="muted">Pas de signal positif assez net.</p>
                  )}
                </div>
                <div className="panel dash-card analyse-brief-col">
                  <h2 className="panel-title">À surveiller</h2>
                  {report.watches.length ? (
                    report.watches.map((item) => (
                      <InsightCard key={item.id} item={item} />
                    ))
                  ) : (
                    <p className="muted">Aucune alerte relative.</p>
                  )}
                </div>
                <div className="panel dash-card analyse-brief-col">
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
              <section className="panel dash-card dash-card-wide">
                <div className="panel-head">
                  <h2 className="panel-title">Produits</h2>
                  <label className="date-field date-field-pill analyse-search-pill">
                    <span>Recherche</span>
                    <input
                      type="search"
                      placeholder="Nom, nature, conseil…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                </div>

                {filteredProducts.length === 0 ? (
                  <div className="analyse-empty">
                    <strong>
                      {report.products.length === 0
                        ? "Aucune vente active sur la période"
                        : "Aucun produit trouvé"}
                    </strong>
                    <span>
                      {report.products.length === 0
                        ? "Changez la période ou les filtres."
                        : "Modifiez la recherche."}
                    </span>
                  </div>
                ) : (
                  <>
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
                          {pagedProducts.items.map((p) => (
                            <tr key={`${p.kind}:${p.productId}`}>
                              <td>{p.name}</td>
                              <td>{KIND_LABELS[p.kind] ?? p.kind}</td>
                              <td className="num mono">{p.qty}</td>
                              <td className="num mono">{formatFcfa(p.caNet)}</td>
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
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <CataloguePaginationBar
                      from={pagedProducts.from}
                      to={pagedProducts.to}
                      total={pagedProducts.total}
                      page={pagedProducts.page}
                      totalPages={pagedProducts.totalPages}
                      onPage={setPage}
                      itemLabel="produit"
                    />
                  </>
                )}

                <details className="analyse-notes">
                  <summary>Limites de lecture</summary>
                  <ul>
                    {report.limitations.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                  <p className="muted">
                    Achats stock {formatFcfa(report.current.achatsStock)} ·
                    acquisitions{" "}
                    {formatFcfa(report.current.acquisitionsImmobilisations)} ·
                    sorties de caisse {formatFcfa(report.current.caisseDepenses)}{" "}
                    (hors résultat, M1 / G8 / G9).
                  </p>
                </details>
              </section>
            ) : null}
          </div>
        ) : null}
      </DashboardShell>
    </AppShell>
  );
}
