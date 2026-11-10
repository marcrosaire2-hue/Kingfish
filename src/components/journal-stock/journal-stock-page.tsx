"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { BrandLoader } from "@/components/brand-loader";
import { DashboardShell, DashboardToolbar } from "@/components/dashboard/dashboard-layout";
import { ExportExcelButton } from "@/components/export-excel-button";
import { downloadExcel, excelFilename } from "@/lib/export-excel";
import type { JournalFamille, JournalStockJour } from "@/lib/journal-stock-jours";
import type { VenteSite } from "@/lib/types";
import { shiftIsoDate, todayIsoDate } from "@/lib/zogbo-calc";

type FamilleFiltre = "toutes" | JournalFamille;

const FAMILLE_LABELS: Record<JournalFamille, string> = {
  plat: "Plat",
  local: "Accompagnement",
  boisson: "Boisson (bt)",
};

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function Ecart({ value }: { value: number | null }) {
  if (value === null) return <span className="muted">—</span>;
  const cls = value < 0 ? "js-ecart is-neg" : value > 0 ? "js-ecart is-pos" : "js-ecart";
  return <span className={cls}>{value > 0 ? `+${value}` : value}</span>;
}

export function JournalStockPage() {
  const [to, setTo] = useState(todayIsoDate);
  const [from, setFrom] = useState(() => shiftIsoDate(todayIsoDate(), -6) ?? todayIsoDate());
  const [site, setSite] = useState<VenteSite>("gbegamey");
  const [famille, setFamille] = useState<FamilleFiltre>("toutes");
  const [q, setQ] = useState("");
  const [lockedSite, setLockedSite] = useState(false);
  const [rows, setRows] = useState<JournalStockJour[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ from, to, site, famille });
      const res = await fetch(`/api/journal-stock?${params}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Chargement impossible");
      setRows(body.rows as JournalStockJour[]);
      setLockedSite(Boolean(body.lockedSite));
      if (body.lockedSite && (body.site === "zogbo" || body.site === "gbegamey")) setSite(body.site);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }, [from, to, site, famille]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const visibles = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? rows.filter((r) => r.name.toLowerCase().includes(needle)) : rows;
  }, [rows, q]);

  const totaux = useMemo(
    () =>
      visibles.reduce(
        (t, r) => ({
          entrees: t.entrees + r.entrees,
          vendus: t.vendus + r.vendus,
          pertes: t.pertes + r.pertes,
          ecarts: t.ecarts + (r.ecart !== null && r.ecart !== 0 ? 1 : 0),
        }),
        { entrees: 0, vendus: 0, pertes: 0, ecarts: 0 },
      ),
    [visibles],
  );

  function exporter() {
    downloadExcel(excelFilename("journal-stock", site, `${from}_${to}`), [
      {
        name: "Journal de stock",
        subtitle: `${site === "zogbo" ? "Zogbo" : "Gbégamey"} · du ${formatDate(from)} au ${formatDate(to)}`,
        rows: visibles.map((r) => ({
          Date: formatDate(r.date),
          Famille: FAMILLE_LABELS[r.famille],
          Produit: r.name,
          "Stock initial": r.ouverture,
          Entrées: r.entrees,
          "Stock disponible": r.disponible,
          Vendus: r.vendus,
          Pertes: r.pertes,
          "Stock théorique": r.theorique,
          "Stock physique": r.physique ?? "",
          Écart: r.ecart ?? "",
        })),
      },
    ]);
    return Promise.resolve();
  }

  return (
    <AppShell
      title="Journal de stock"
      subtitle="Chaque jour, pour chaque produit : stock initial, entrées, ventes, pertes, théorique, comptage et écart."
      mainClassName="main-journal-stock"
      actions={
        <>
          <ExportExcelButton label="Excel" disabled={loading || visibles.length === 0} onExport={exporter} />
          <button type="button" className="btn btn-ghost" onClick={() => void load()} disabled={loading}>
            Actualiser
          </button>
        </>
      }
    >
      <DashboardShell>
        <DashboardToolbar
          showCurrency={false}
          filters={
            <>
              <label className="date-field date-field-pill">
                <span>Du</span>
                <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label className="date-field date-field-pill">
                <span>Au</span>
                <input type="date" value={to} min={from} max={todayIsoDate()} onChange={(e) => setTo(e.target.value)} />
              </label>
              <label className="date-field date-field-pill">
                <span>Site</span>
                <select
                  className="select-input"
                  value={site}
                  disabled={lockedSite}
                  onChange={(e) => setSite(e.target.value as VenteSite)}
                >
                  <option value="gbegamey">Gbégamey</option>
                  <option value="zogbo">Zogbo</option>
                </select>
              </label>
              <label className="date-field date-field-pill">
                <span>Famille</span>
                <select
                  className="select-input"
                  value={famille}
                  onChange={(e) => setFamille(e.target.value as FamilleFiltre)}
                >
                  <option value="toutes">Toutes</option>
                  <option value="plat">Plats</option>
                  <option value="local">Accompagnements</option>
                  <option value="boisson">Boissons</option>
                </select>
              </label>
              <label className="date-field date-field-pill">
                <span>Produit</span>
                <input
                  type="search"
                  className="select-input"
                  placeholder="Rechercher…"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </label>
            </>
          }
        />

        {error ? (
          <p className="error-banner" role="alert">
            {error}
          </p>
        ) : null}

        <p className="js-resume muted">
          {visibles.length} ligne(s) · entrées {totaux.entrees} · vendus {totaux.vendus} · pertes {totaux.pertes} ·{" "}
          <strong className={totaux.ecarts > 0 ? "js-warn" : undefined}>{totaux.ecarts} écart(s)</strong>
        </p>

        {loading && rows.length === 0 ? (
          <BrandLoader label="Chargement du journal…" />
        ) : visibles.length === 0 ? (
          <p className="ui-info">Aucun mouvement de stock sur cette période.</p>
        ) : (
          <div className="catalogue-table-wrap">
            <table className="catalogue-table stock-zogbo-table stock-modele-table js-table">
              <thead>
                <tr>
                  <th scope="col">Produit</th>
                  <th scope="col">Date</th>
                  <th scope="col">Stock initial</th>
                  <th scope="col">Entrées</th>
                  <th scope="col">Stock disponible</th>
                  <th scope="col">Vendus</th>
                  <th scope="col">Stock théorique</th>
                  <th scope="col">Stock physique</th>
                  <th scope="col">Écart</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((r) => (
                  <tr key={`${r.date}|${r.famille}|${r.productId}`}>
                    <td>
                      <span className="catalogue-product-name">{r.name}</span>
                      <span className="js-famille">{FAMILLE_LABELS[r.famille]}</span>
                    </td>
                    <td className="mono">{formatDate(r.date)}</td>
                    <td>{r.ouverture}</td>
                    <td>{r.entrees || "—"}</td>
                    <td>{r.disponible}</td>
                    <td>
                      {r.vendus || "—"}
                      {r.pertes ? <span className="js-pertes"> · perte {r.pertes}</span> : null}
                    </td>
                    <td>
                      <strong>{r.theorique}</strong>
                    </td>
                    <td>{r.physique ?? "—"}</td>
                    <td>
                      <Ecart value={r.ecart} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DashboardShell>
    </AppShell>
  );
}
