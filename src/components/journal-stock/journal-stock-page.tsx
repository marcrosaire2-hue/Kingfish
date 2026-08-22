"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { BrandLoader } from "@/components/brand-loader";
import { ExportExcelButton } from "@/components/export-excel-button";
import { formatFcfa } from "@/lib/format";
import type {
  JournalBalanceRow,
  JournalRow,
  JournalTotals,
  JournalType,
} from "@/lib/journal-stock-repo";
import { exportJournalStockExcel } from "@/lib/page-exports";

type SiteFilter = "tous" | "zogbo" | "gbegamey";
type TypeFilter = "tous" | JournalType;

const TYPE_LABELS: Record<TypeFilter, string> = {
  tous: "Tous",
  vente: "Vente",
  achat: "Achat",
  perte: "Perte",
  reception: "Réception",
};

const KIND_LABELS: Record<string, string> = {
  plat: "Plat",
  local: "Sur place",
  combo: "Combo",
  boisson: "Boisson",
  extra: "Vente libre",
  matiere: "Matière",
  immobilisation: "Emballage / Actif",
  libre: "Achat hors-catalogue",
};

function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

const EMPTY_TOTALS: JournalTotals = {
  count: 0,
  qtyEntrees: 0,
  qtySorties: 0,
  montant: 0,
  byType: {
    vente: { count: 0, qty: 0, montant: 0 },
    achat: { count: 0, qty: 0, montant: 0 },
    perte: { count: 0, qty: 0, montant: 0 },
    reception: { count: 0, qty: 0, montant: 0 },
  },
};

const PAGE_SIZE = 200;

function formatWhen(iso: string): string {
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

export function JournalStockPage() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [site, setSite] = useState<SiteFilter>("tous");
  const [type, setType] = useState<TypeFilter>("tous");
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<JournalRow[]>([]);
  const [total, setTotal] = useState(0);
  const [balance, setBalance] = useState<JournalBalanceRow[]>([]);
  const [totals, setTotals] = useState<JournalTotals>(EMPTY_TOTALS);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ site, type, limit: String(PAGE_SIZE) });
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (offset > 0) params.set("offset", String(offset));

      const res = await fetch(`/api/journal-stock?${params}`, {
        cache: "no-store",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Erreur de chargement");
      setRows(body.rows ?? []);
      setTotal(body.total ?? 0);
      setBalance(body.balance ?? []);
      setTotals(body.totals ?? EMPTY_TOTALS);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [from, to, site, type, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  function applyFilters(nextFrom?: string, nextTo?: string) {
    setFrom(nextFrom ?? from);
    setTo(nextTo ?? to);
    setOffset(0);
  }

  async function exportFull() {
    if (exporting) return;
    setExporting(true);
    setError(null);
    try {
      const params = new URLSearchParams({ site, type, full: "1" });
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const res = await fetch(`/api/journal-stock?${params}`, {
        cache: "no-store",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Erreur d'export");
      exportJournalStockExcel({
        rows: body.rows ?? [],
        balance: body.balance ?? [],
        totals: body.totals ?? EMPTY_TOTALS,
        from: from || null,
        to: to || null,
        site,
        type,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur d'export");
    } finally {
      setExporting(false);
    }
  }

  return (
    <AppShell
      title="Journal stock"
      subtitle="Tous les mouvements de stock : ventes, achats, pertes et réceptions — export complet du début à aujourd'hui."
      actions={
        <>
          <ExportExcelButton
            onExport={() => void exportFull()}
            disabled={loading || exporting || total === 0}
          />
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setFrom("");
              setTo("");
              setSite("tous");
              setType("tous");
              setOffset(0);
            }}
            disabled={loading}
          >
            Réinitialiser
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void load()}
            disabled={loading}
          >
            Actualiser
          </button>
        </>
      }
    >
      <div className="hist-filters hist-ventes-filters">
        <label className="date-field">
          <span>Du</span>
          <input
            type="date"
            value={from}
            onChange={(e) => applyFilters(e.target.value, undefined)}
          />
        </label>
        <label className="date-field">
          <span>Au</span>
          <input
            type="date"
            value={to}
            onChange={(e) => applyFilters(undefined, e.target.value)}
          />
        </label>
        <label className="date-field">
          <span>Site</span>
          <select
            className="select-input"
            value={site}
            onChange={(e) => {
              setSite(e.target.value as SiteFilter);
              setOffset(0);
            }}
          >
            <option value="tous">Tous</option>
            <option value="zogbo">Zogbo</option>
            <option value="gbegamey">Gbégamey</option>
          </select>
        </label>
        <label className="date-field">
          <span>Mouvement</span>
          <select
            className="select-input"
            value={type}
            onChange={(e) => {
              setType(e.target.value as TypeFilter);
              setOffset(0);
            }}
          >
            <option value="tous">Tous</option>
            <option value="vente">Vente</option>
            <option value="achat">Achat</option>
            <option value="perte">Perte</option>
            <option value="reception">Réception</option>
          </select>
        </label>
      </div>

      <div className="dash-ca-final hist-ventes-totaux">
        <div className="dash-ca-final-main">
          <span className="dash-ca-final-label">
            {from || to
              ? "Mouvements de la période"
              : "Tous les mouvements depuis le début"}
          </span>
          <strong className="dash-ca-final-value mono">
            {formatFcfa(totals.montant)}
          </strong>
          <span className="dash-ca-final-hint">
            {totals.count} mouvement{totals.count > 1 ? "s" : ""} ·{" "}
            {totals.qtyEntrees} entrées · {totals.qtySorties} sorties
          </span>
        </div>
        <div className="dash-ca-final-side">
          <div>
            <span>Ventes (CA)</span>
            <strong className="mono">{formatFcfa(totals.byType.vente.montant)}</strong>
          </div>
          <div>
            <span>Achats (coût)</span>
            <strong className="mono">{formatFcfa(totals.byType.achat.montant)}</strong>
          </div>
          <div>
            <span>Pertes (coût)</span>
            <strong className="mono">{formatFcfa(totals.byType.perte.montant)}</strong>
          </div>
          <div>
            <span>Réceptions</span>
            <strong className="mono">{totals.byType.reception.qty}</strong>
          </div>
        </div>
      </div>

      {error ? (
        <p className="error-banner" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? <BrandLoader variant="ligne" label="Chargement du journal…" /> : null}

      {!loading && !rows.length ? (
        <p className="muted">Aucun mouvement pour ces filtres.</p>
      ) : null}

      {!loading && rows.length > 0 ? (
        <div className="panel panel-wide">
          <div className="table-scroll">
            <table className="data-table journal-table">
              <thead>
                <tr>
                  <th scope="col">Quand</th>
                  <th scope="col">Site</th>
                  <th scope="col">Type</th>
                  <th scope="col">Produit</th>
                  <th scope="col" className="col-money">
                    Qté
                  </th>
                  <th scope="col" className="col-money">
                    PU
                  </th>
                  <th scope="col" className="col-money">
                    Montant
                  </th>
                  <th scope="col">Statut</th>
                  <th scope="col">Détail</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{formatWhen(r.at)}</td>
                    <td>{r.site === "zogbo" ? "Zogbo" : "Gbégamey"}</td>
                    <td>
                      <span className={`hist-badge hist-badge-type-${r.type}`}>
                        {TYPE_LABELS[r.type]}
                      </span>
                    </td>
                    <td className="cell-name">
                      <strong>{r.name}</strong>
                      <span className="cell-sub">{kindLabel(r.kind)}</span>
                    </td>
                    <td
                      className={`mono col-money journal-qty ${r.direction > 0 ? "journal-in" : "journal-out"}`}
                    >
                      {r.direction > 0 ? "+" : "−"}
                      {r.qty}
                    </td>
                    <td className="mono col-money">
                      {r.unitPrice > 0 ? formatFcfa(r.unitPrice) : "—"}
                    </td>
                    <td className="mono col-money">
                      {r.montant > 0 ? formatFcfa(r.montant) : "—"}
                    </td>
                    <td>
                      {r.annule ? (
                        <span className="hist-statut hist-statut-annule">Annulé</span>
                      ) : (
                        <span className="hist-statut hist-statut-valide">Validé</span>
                      )}
                    </td>
                    <td className="cell-sub">{r.detail || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pager">
            <button
              type="button"
              className="btn btn-ghost"
              disabled={offset <= 0 || loading}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              ← Précédent
            </button>
            <span className="muted">
              {total === 0
                ? ""
                : `${offset + 1}–${Math.min(offset + PAGE_SIZE, total)} sur ${total}`}
            </span>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={offset + PAGE_SIZE >= total || loading}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Suivant →
            </button>
          </div>
        </div>
      ) : null}

      {!loading && balance.length > 0 ? (
        <div className="panel panel-wide">
          <h2 className="panel-title">Solde par produit</h2>
          <p className="muted">
            Entrées − sorties des mouvements non annulés de la période
            sélectionnée (hors stock initial et comptages manuels).
          </p>
          <div className="table-scroll">
            <table className="data-table journal-table">
              <thead>
                <tr>
                  <th scope="col">Site</th>
                  <th scope="col">Produit</th>
                  <th scope="col" className="col-money">
                    Entrées
                  </th>
                  <th scope="col" className="col-money">
                    Sorties
                  </th>
                  <th scope="col" className="col-money">
                    Solde
                  </th>
                  <th scope="col" className="col-money">
                    Montant
                  </th>
                </tr>
              </thead>
              <tbody>
                {balance.map((b) => (
                  <tr key={`${b.site}|${b.kind}|${b.productId}|${b.name}`}>
                    <td>{b.site === "zogbo" ? "Zogbo" : "Gbégamey"}</td>
                    <td className="cell-name">
                      <strong>{b.name}</strong>
                      <span className="cell-sub">{kindLabel(b.kind)}</span>
                    </td>
                    <td className="mono col-money">{b.entrees}</td>
                    <td className="mono col-money">{b.sorties}</td>
                    <td
                      className={`mono col-money journal-qty ${b.solde >= 0 ? "journal-in" : "journal-out"}`}
                    >
                      {b.solde >= 0 ? "+" : "−"}
                      {Math.abs(b.solde)}
                    </td>
                    <td className="mono col-money">
                      {b.montant > 0 ? formatFcfa(b.montant) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}