"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { BrandLoader } from "@/components/brand-loader";
import { RegistreDrawer } from "@/components/registre-drawer";
import { formatFcfa } from "@/lib/format";
import {
  downloadExcel,
  excelFilename,
  type ExcelSheet,
} from "@/lib/export-excel";
import type {
  PilotagePayload,
  PilotageRow,
  PilotageType,
} from "@/lib/pilotage-global-repo";
import { todayIsoDate } from "@/lib/zogbo-calc";

type PeriodeKey =
  | "aujourdhui"
  | "hier"
  | "semaine"
  | "mois"
  | "annee"
  | "tout"
  | "custom";

const PERIODES: { key: PeriodeKey; label: string }[] = [
  { key: "aujourdhui", label: "Aujourd'hui" },
  { key: "hier", label: "Hier" },
  { key: "semaine", label: "Cette semaine" },
  { key: "mois", label: "Ce mois" },
  { key: "annee", label: "Cette année" },
  { key: "tout", label: "Depuis le début" },
  { key: "custom", label: "Intervalle" },
];

type TabKey =
  | "tout"
  | "vente"
  | "caisse"
  | "achat"
  | "perte"
  | "zogbo"
  | "gbegamey"
  | "stock"
  | "transfert";

const TABS: { key: TabKey; label: string }[] = [
  { key: "tout", label: "Tout" },
  { key: "vente", label: "Ventes" },
  { key: "caisse", label: "Caisse" },
  { key: "achat", label: "Achats" },
  { key: "perte", label: "Pertes" },
  { key: "zogbo", label: "Zogbo" },
  { key: "gbegamey", label: "Gbégamey" },
  { key: "stock", label: "Stocks" },
  { key: "transfert", label: "Transferts" },
];

const TYPE_LABELS: Record<PilotageType, string> = {
  vente: "Vente",
  caisse: "Caisse",
  achat: "Achat",
  perte: "Perte",
  zogbo: "Zogbo",
  gbegamey: "Gbégamey",
  stock: "Stock",
  transfert: "Transfert",
  reprise: "Reprise",
  autre: "Autre",
};

const SITE_LABELS: Record<string, string> = {
  zogbo: "Zogbo",
  gbegamey: "Gbégamey",
  centrale: "Centrale",
};

function formatMontant(n: number, unit: string): string {
  if (unit === "FCFA") return formatFcfa(n);
  return `${n.toLocaleString("fr-FR")} ${unit}`;
}

function siteLabel(site: string | null): string {
  if (!site) return "—";
  return SITE_LABELS[site] ?? site;
}

export function PilotageGlobalPage() {
  const [periode, setPeriode] = useState<PeriodeKey>("mois");
  const [customFrom, setCustomFrom] = useState(() => todayIsoDate());
  const [customTo, setCustomTo] = useState(() => todayIsoDate());
  const [site, setSite] = useState<"tous" | "zogbo" | "gbegamey">("tous");
  const [tab, setTab] = useState<TabKey>("tout");
  const [q, setQ] = useState("");
  const [payload, setPayload] = useState<PilotagePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<PilotageRow | null>(null);

  useEffect(() => {
    let annule = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ periode });
        if (periode === "custom") {
          params.set("from", customFrom);
          params.set("to", customTo);
        }
        if (site !== "tous") params.set("site", site);
        if (tab !== "tout") params.set("type", tab);
        if (q.trim()) params.set("q", q.trim());
        const res = await fetch(`/api/pilotage-global?${params}`, {
          cache: "no-store",
        });
        const body = (await res.json()) as PilotagePayload & { error?: string };
        if (!res.ok) throw new Error(body.error || "Erreur de chargement");
        if (!annule) setPayload(body);
      } catch (e) {
        if (!annule) {
          setError(e instanceof Error ? e.message : "Erreur de chargement");
          setPayload(null);
        }
      } finally {
        if (!annule) setLoading(false);
      }
    })();
    return () => {
      annule = true;
    };
  }, [periode, customFrom, customTo, site, tab, q]);

  const rows = useMemo(() => payload?.rows ?? [], [payload]);

  const compteursParTab = useMemo(() => {
    const m = new Map<TabKey, number>();
    for (const r of rows) {
      const key = (r.type === "reprise" || r.type === "autre" ? null : r.type) as TabKey | null;
      if (!key) continue;
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    return m;
  }, [rows]);

  function exportExcel() {
    if (!payload) return;
    const sheetRows = payload.rows.map((r) => ({
      Date: r.date,
      Heure: r.time,
      Site: siteLabel(r.site),
      Type: TYPE_LABELS[r.type],
      Référence: r.reference,
      Description: r.description,
      Quantité: r.quantity ?? "",
      Entrée: r.in || "",
      Sortie: r.out || "",
      Solde: r.solde ?? "",
      Utilisateur: r.user ?? "",
    }));
    const sheets: ExcelSheet[] = [
      {
        name: "Opérations",
        rows: sheetRows,
        subtitle: `${payload.from} → ${payload.to} · ${payload.rows.length} ligne(s)${payload.rowsTronquees ? " (tronqué)" : ""}`,
        totals: ["Entrée", "Sortie"],
      },
      {
        name: "Synthèse",
        rows: [
          { Poste: "CA total", Montant: payload.summary.caTotal },
          { Poste: "Achats", Montant: payload.summary.achats },
          { Poste: "Pertes", Montant: payload.summary.pertes },
          { Poste: "Solde de caisse", Montant: payload.summary.soldeCaisse },
          { Poste: "Résultat net (indicatif)", Montant: payload.summary.resultatNet },
          { Poste: "Nombre d'opérations", Montant: payload.summary.operations },
        ],
      },
    ];
    downloadExcel(
      excelFilename("pilotage-global", payload.from, payload.to),
      sheets,
      { title: "Centre de pilotage global", subtitle: `${payload.from} → ${payload.to}` },
    );
  }

  /** « PDF » via la fenêtre d'impression du navigateur — même mécanisme déjà
   *  utilisé pour les factures : aucune dépendance nouvelle, « Enregistrer
   *  en PDF » est une destination d'impression sur tout navigateur récent. */
  function imprimerRapport() {
    if (!payload) return;
    const w = window.open("", "_blank", "width=900,height=1000");
    if (!w) {
      setError("Impression bloquée par le navigateur — autorisez les fenêtres pop-up.");
      return;
    }
    const genere = new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "long",
      timeStyle: "short",
      timeZone: "Africa/Porto-Novo",
    }).format(new Date());
    const lignes = payload.rows
      .map(
        (r) =>
          `<tr><td>${r.date}</td><td>${r.time}</td><td>${siteLabel(r.site)}</td>` +
          `<td>${TYPE_LABELS[r.type]}</td><td>${esc(r.reference)}</td><td>${esc(r.description)}</td>` +
          `<td class="num">${r.quantity ?? ""}</td><td class="num">${r.in ? formatMontant(r.in, r.unit) : ""}</td>` +
          `<td class="num">${r.out ? formatMontant(r.out, r.unit) : ""}</td><td>${esc(r.user ?? "")}</td></tr>`,
      )
      .join("");
    w.document.write(`<!doctype html><html><head><title>Pilotage global ${payload.from} → ${payload.to}</title>
      <style>
        body{font-family:Arial,sans-serif;font-size:11px;padding:24px;color:#111}
        h1{font-size:18px;margin:0 0 4px}
        .meta{color:#555;margin-bottom:18px}
        .synthese{display:flex;gap:18px;flex-wrap:wrap;margin-bottom:20px}
        .synthese div{border:1px solid #ddd;border-radius:8px;padding:8px 12px}
        .synthese span{display:block;font-size:9px;text-transform:uppercase;color:#777}
        table{width:100%;border-collapse:collapse;font-size:10px}
        th,td{border-bottom:1px solid #ddd;padding:4px 6px;text-align:left}
        th{background:#f3f3f3}
        td.num,th.num{text-align:right;white-space:nowrap}
      </style></head><body>
      <h1>Centre de pilotage global</h1>
      <p class="meta">Période ${payload.from} → ${payload.to} · Généré le ${genere}${payload.rowsTronquees ? " · liste tronquée aux " + payload.rows.length + " opérations les plus récentes" : ""}</p>
      <div class="synthese">
        <div><span>CA total</span>${formatFcfa(payload.summary.caTotal)}</div>
        <div><span>Achats</span>${formatFcfa(payload.summary.achats)}</div>
        <div><span>Pertes</span>${formatFcfa(payload.summary.pertes)}</div>
        <div><span>Solde de caisse</span>${formatFcfa(payload.summary.soldeCaisse)}</div>
        <div><span>Résultat net (indicatif)</span>${formatFcfa(payload.summary.resultatNet)}</div>
        <div><span>Opérations</span>${payload.summary.operations}</div>
      </div>
      <table><thead><tr><th>Date</th><th>Heure</th><th>Site</th><th>Type</th><th>Référence</th><th>Description</th><th class="num">Qté</th><th class="num">Entrée</th><th class="num">Sortie</th><th>Utilisateur</th></tr></thead>
      <tbody>${lignes}</tbody></table>
      </body></html>`);
    w.document.close();
    w.focus();
    w.print();
  }

  return (
    <AppShell
      title="Pilotage global"
      subtitle="Vue consolidée de toute l'activité — ne remplace aucune des pages existantes."
      actions={
        <>
          <button type="button" className="btn btn-ghost" onClick={imprimerRapport} disabled={!payload}>
            Télécharger PDF
          </button>
          <button type="button" className="btn btn-primary" onClick={exportExcel} disabled={!payload}>
            Télécharger Excel
          </button>
        </>
      }
    >
      {error ? (
        <p className="error-banner" role="alert">
          {error}
        </p>
      ) : null}

      {payload ? (
        <section className="pg-summary" aria-label="Synthèse">
          <div className="pg-summary-item pg-summary-accent">
            <span>Chiffre d&apos;affaires</span>
            <strong className="mono">{formatFcfa(payload.summary.caTotal)}</strong>
          </div>
          <div className="pg-summary-item">
            <span>Total des achats</span>
            <strong className="mono">{formatFcfa(payload.summary.achats)}</strong>
          </div>
          <div className="pg-summary-item">
            <span>Total des pertes</span>
            <strong className="mono">{formatFcfa(payload.summary.pertes)}</strong>
          </div>
          <div className="pg-summary-item">
            <span>Solde de caisse global</span>
            <strong className="mono">{formatFcfa(payload.summary.soldeCaisse)}</strong>
          </div>
          <div className="pg-summary-item">
            <span>Résultat net (indicatif)</span>
            <strong
              className={`mono ${payload.summary.resultatNet < 0 ? "is-neg" : "is-pos"}`}
            >
              {formatFcfa(payload.summary.resultatNet)}
            </strong>
          </div>
          <div className="pg-summary-item">
            <span>Opérations</span>
            <strong className="mono">{payload.summary.operations}</strong>
          </div>
          <div className="pg-summary-item">
            <span>Dernière mise à jour</span>
            <strong>
              {payload.summary.derniereMiseAJour
                ? new Intl.DateTimeFormat("fr-FR", {
                    dateStyle: "short",
                    timeStyle: "short",
                    timeZone: "Africa/Porto-Novo",
                  }).format(new Date(payload.summary.derniereMiseAJour))
                : "—"}
            </strong>
          </div>
        </section>
      ) : null}

      <section className="pg-filters" aria-label="Filtres">
        <div className="pg-filter-group" role="tablist" aria-label="Période">
          {PERIODES.map((p) => (
            <button
              key={p.key}
              type="button"
              role="tab"
              aria-selected={periode === p.key}
              className={`section-tab${periode === p.key ? " is-active" : ""}`}
              onClick={() => setPeriode(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>
        {periode === "custom" ? (
          <div className="pg-custom-dates">
            <label className="vente-field">
              <span>Du</span>
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            </label>
            <label className="vente-field">
              <span>Au</span>
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
            </label>
          </div>
        ) : null}
        <div className="pg-filter-group" role="tablist" aria-label="Site">
          {(["tous", "zogbo", "gbegamey"] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={site === s}
              className={`site-btn${site === s ? " is-active" : ""}`}
              onClick={() => setSite(s)}
            >
              {s === "tous" ? "Tous" : s === "zogbo" ? "Zogbo" : "Gbégamey"}
            </button>
          ))}
        </div>
        <input
          type="search"
          className="pg-search"
          placeholder="Rechercher un produit, un ticket, un fournisseur, un montant, une date…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Recherche universelle"
        />
      </section>

      <div className="section-tabs pg-tabs" role="tablist" aria-label="Onglets">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={`section-tab${tab === t.key ? " is-active" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.key !== "tout" && compteursParTab.get(t.key) ? (
              <span className="section-count">{compteursParTab.get(t.key)}</span>
            ) : null}
          </button>
        ))}
      </div>

      {loading && !payload ? (
        <BrandLoader variant="ligne" label="Chargement du pilotage global…" />
      ) : (
        <>
          {payload?.rowsTronquees ? (
            <p className="ui-info" role="note">
              <span className="ui-info-mark" aria-hidden>
                i
              </span>
              Affichage limité aux {payload.rows.length} opérations les plus
              récentes de la période ({payload.totalOperations} au total) — la
              synthèse ci-dessus porte sur l&apos;ensemble, affinez les filtres
              pour voir plus loin dans le détail.
            </p>
          ) : null}

          <section className="panel panel-wide pg-table-wrap">
            <table className="data-table pg-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Heure</th>
                  <th>Site</th>
                  <th>Type</th>
                  <th>Référence</th>
                  <th>Description</th>
                  <th className="col-num">Qté</th>
                  <th className="col-money">Entrée</th>
                  <th className="col-money">Sortie</th>
                  <th className="col-money">Solde</th>
                  <th>Utilisateur</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="muted">
                      Aucune opération sur cette période.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr
                      key={r.id}
                      className="pg-row"
                      onClick={() => setSelected(r)}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") setSelected(r);
                      }}
                    >
                      <td className="mono">{r.date}</td>
                      <td className="mono">{r.time}</td>
                      <td>{siteLabel(r.site)}</td>
                      <td>
                        <span className={`pg-type-pill pg-type-${r.type}`}>
                          {TYPE_LABELS[r.type]}
                        </span>
                      </td>
                      <td>{r.reference}</td>
                      <td className="cell-name">{r.description}</td>
                      <td className="col-num mono">{r.quantity ?? "—"}</td>
                      <td className="col-money mono text-ok">
                        {r.in ? formatMontant(r.in, r.unit) : ""}
                      </td>
                      <td className="col-money mono text-danger">
                        {r.out ? formatMontant(r.out, r.unit) : ""}
                      </td>
                      <td className="col-money mono">
                        {r.solde !== null ? formatMontant(r.solde, r.unit) : "—"}
                      </td>
                      <td>{r.user ?? "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </section>

          {payload?.stats ? (
            <div className="pg-stats-grid">
              <section className="panel">
                <h3 className="panel-title">Par jour</h3>
                {payload.stats.parJour.length === 0 ? (
                  <p className="muted">Rien sur la période.</p>
                ) : (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Jour</th>
                        <th className="col-money">CA</th>
                        <th className="col-money">Achats</th>
                        <th className="col-money">Pertes</th>
                        <th className="col-money">Résultat</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payload.stats.parJour.map((d) => (
                        <tr key={d.date}>
                          <td>{d.date}</td>
                          <td className="mono col-money">{formatFcfa(d.ca)}</td>
                          <td className="mono col-money">{formatFcfa(d.achats)}</td>
                          <td className="mono col-money">{formatFcfa(d.pertes)}</td>
                          <td className="mono col-money">{formatFcfa(d.resultat)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>

              <section className="panel">
                <h3 className="panel-title">Par site</h3>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Site</th>
                      <th className="col-money">CA</th>
                      <th className="col-money">Pertes</th>
                      <th className="col-money">Solde caisse</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payload.stats.parSite.map((s) => (
                      <tr key={s.site}>
                        <td>{siteLabel(s.site)}</td>
                        <td className="mono col-money">{formatFcfa(s.ca)}</td>
                        <td className="mono col-money">{formatFcfa(s.pertes)}</td>
                        <td className="mono col-money">{formatFcfa(s.soldeCaisse)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              <section className="panel">
                <h3 className="panel-title">Par catégorie</h3>
                {payload.stats.parCategorie.length === 0 ? (
                  <p className="muted">Rien sur la période.</p>
                ) : (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Catégorie</th>
                        <th className="col-money">CA</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payload.stats.parCategorie.map((c) => (
                        <tr key={c.categorie}>
                          <td>{c.categorie}</td>
                          <td className="mono col-money">{formatFcfa(c.ca)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            </div>
          ) : null}
        </>
      )}

      <RegistreDrawer
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? selected.description : ""}
        subtitle={
          selected
            ? `${TYPE_LABELS[selected.type]} · ${selected.date} ${selected.time} · ${siteLabel(selected.site)}`
            : undefined
        }
      >
        {selected ? (
          <dl className="pg-detail">
            <div>
              <dt>Référence</dt>
              <dd>{selected.reference}</dd>
            </div>
            <div>
              <dt>Quantité</dt>
              <dd>{selected.quantity ?? "—"}</dd>
            </div>
            <div>
              <dt>Entrée</dt>
              <dd>{selected.in ? formatMontant(selected.in, selected.unit) : "—"}</dd>
            </div>
            <div>
              <dt>Sortie</dt>
              <dd>{selected.out ? formatMontant(selected.out, selected.unit) : "—"}</dd>
            </div>
            <div>
              <dt>Solde</dt>
              <dd>{selected.solde !== null ? formatMontant(selected.solde, selected.unit) : "—"}</dd>
            </div>
            <div>
              <dt>Utilisateur</dt>
              <dd>{selected.user ?? "Non tracé pour ce type d'opération"}</dd>
            </div>
            {Object.entries(selected.detail).map(([k, v]) =>
              v === null || v === undefined || v === "" ? null : (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{typeof v === "object" ? JSON.stringify(v) : String(v)}</dd>
                </div>
              ),
            )}
          </dl>
        ) : null}
      </RegistreDrawer>
    </AppShell>
  );
}

function esc(value: unknown): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] as string,
  );
}
