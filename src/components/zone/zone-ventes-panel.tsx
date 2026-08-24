"use client";

import Link from "next/link";
import { formatFcfa } from "@/lib/format";
import type { VenteLogEntry, VenteSite, VentesDaySummary } from "@/lib/types";
import { BrandLoader } from "@/components/brand-loader";

const KIND_LABELS: Record<string, string> = {
  plat: "Plat",
  boisson: "Boisson",
  extra: "Vente libre",
  local: "Sur place",
  matiere: "Matière",
};

const SOURCE_LABELS: Record<string, string> = {
  caisse: "Caisse",
  aquapro: "Importé",
  "carnet-zogbo": "Carnet",
  reprise: "Reprise",
  "inventaire-marco": "Inventaire",
};

function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

function sourceLabel(source: string | null | undefined): string {
  if (!source) return "Caisse";
  return SOURCE_LABELS[source] ?? source;
}

function formatTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      timeStyle: "medium",
      timeZone: "Africa/Porto-Novo",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function ZoneVentesPanel({
  date,
  site,
  ventes,
  summary,
  loading,
}: {
  date: string;
  site: VenteSite;
  ventes: VenteLogEntry[];
  summary: VentesDaySummary | null;
  loading: boolean;
}) {
  const siteLabel = site === "zogbo" ? "Zogbo" : "Gbégamey";
  const kindRows = summary
    ? Object.entries(summary.byKind).sort((a, b) => b[1].montant - a[1].montant)
    : [];
  const sourceRows = summary
    ? Object.entries(summary.bySource).sort(
        (a, b) => b[1].montant - a[1].montant,
      )
    : [];

  return (
    <div className="zone-panel">
      <div className="param-meta">
        <p>
          Journal des ventes {siteLabel} — détail de chaque ligne enregistrée
          (carnet, caisse, import…).
        </p>
      </div>

      <div className="stat-row">
        <div className="stat-chip accent">
          <span className="stat-label">CA journal (FCFA)</span>
          <span className="stat-value mono">
            {formatFcfa(summary?.montant ?? 0)}
          </span>
        </div>
        <div className="stat-chip">
          <span className="stat-label">Lignes / transactions</span>
          <span className="stat-value mono">{summary?.lignes ?? 0}</span>
        </div>
        <div className="stat-chip">
          <span className="stat-label">Articles vendus</span>
          <span className="stat-value mono">{summary?.articles ?? 0}</span>
        </div>
      </div>

      {summary && summary.lignes > 0 ? (
        <div className="ui-info" role="note">
          <span className="ui-info-mark" aria-hidden>
            i
          </span>
          <p>
            Le CA affiché provient de ce journal. Les onglets Plats /
            Boissons suivent les <strong>compteurs de stock</strong> : si une
            vente n’a pas mis à jour le stock (import carnet, reprise), le
            détail apparaît ici mais pas dans les compteurs.
          </p>
        </div>
      ) : null}

      {kindRows.length > 0 ? (
        <section className="panel">
          <h3 className="panel-title">Par type de produit</h3>
          <table className="data-table compact">
            <thead>
              <tr>
                <th>Type</th>
                <th className="col-qty">Lignes</th>
                <th className="col-qty">Qté</th>
                <th className="col-qty">Montant</th>
              </tr>
            </thead>
            <tbody>
              {kindRows.map(([kind, row]) => (
                <tr key={kind}>
                  <td>{kindLabel(kind)}</td>
                  <td className="col-qty mono">{row.lignes}</td>
                  <td className="col-qty mono">{row.qty}</td>
                  <td className="col-qty mono">{formatFcfa(row.montant)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {sourceRows.length > 0 ? (
        <section className="panel">
          <h3 className="panel-title">Par source</h3>
          <table className="data-table compact">
            <thead>
              <tr>
                <th>Source</th>
                <th className="col-qty">Lignes</th>
                <th className="col-qty">Montant</th>
              </tr>
            </thead>
            <tbody>
              {sourceRows.map(([source, row]) => (
                <tr key={source}>
                  <td>{sourceLabel(source)}</td>
                  <td className="col-qty mono">{row.lignes}</td>
                  <td className="col-qty mono">{formatFcfa(row.montant)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <section className="panel panel-wide">
        <div className="panel-head-row">
          <h3 className="panel-title">Détail des ventes</h3>
          <Link
            href={`/journal-ventes?from=${date}&to=${date}&site=${site}`}
            className="btn btn-ghost"
          >
            Journal complet
          </Link>
        </div>
        <table className="data-table zogbo-table">
          <thead>
            <tr>
              <th>Heure</th>
              <th>Source</th>
              <th>Type</th>
              <th>Produit</th>
              <th className="col-qty">Qté</th>
              <th className="col-qty">P.U.</th>
              <th className="col-qty">Montant</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7}>
                      <BrandLoader variant="ligne" label="Chargement…" />
                    </td>
              </tr>
            ) : ventes.length === 0 ? (
              <tr>
                <td colSpan={7} className="muted">
                  Aucune vente enregistrée pour cette date.
                </td>
              </tr>
            ) : (
              ventes.map((v) => (
                <tr key={v.id}>
                  <td className="mono">{formatTime(v.at)}</td>
                  <td>{sourceLabel(v.source)}</td>
                  <td>{kindLabel(v.kind)}</td>
                  <td className="cell-name">{v.name}</td>
                  <td className="col-qty mono">{v.qty}</td>
                  <td className="col-qty mono">{formatFcfa(v.unitPrice)}</td>
                  <td className="col-qty mono">{formatFcfa(v.amount)}</td>
                </tr>
              ))
            )}
          </tbody>
          {ventes.length > 0 && summary ? (
            <tfoot>
              <tr>
                <th colSpan={4} scope="row">
                  Total ({summary.lignes} lignes)
                </th>
                <td className="col-qty mono">{summary.articles}</td>
                <td />
                <td className="col-qty mono">{formatFcfa(summary.montant)}</td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </section>
    </div>
  );
}
