"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ExportExcelButton } from "@/components/export-excel-button";
import { formatDisplayDate, todayIsoDate } from "@/lib/zogbo-calc";
import { exportStockExcel } from "@/lib/page-exports";
import type { StockPayload, StockRow, StockZone } from "@/lib/stock-repo";

function zoneLink(row: StockRow, date: string): string | null {
  if (row.zone.startsWith("zogbo")) return `/zogbo?date=${date}`;
  if (row.zone.startsWith("gbegamey")) return `/gbegamey?date=${date}`;
  return null;
}

function ecartClass(ecart: number | null): string {
  if (ecart === null || ecart === 0) return "";
  if (Math.abs(ecart) <= 1) return "text-amber-700";
  return "text-red-700 font-medium";
}

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return String(n);
}

export function StockPage() {
  const [date, setDate] = useState(() => todayIsoDate());
  const [data, setData] = useState<StockPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoneFilter, setZoneFilter] = useState<StockZone | "all">("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ date });
      const res = await fetch(`/api/stock?${params}`, { cache: "no-store" });
      const body = (await res.json()) as StockPayload & { error?: string };
      if (!res.ok) throw new Error(body.error || "Erreur de chargement");
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    void load();
  }, [load]);

  const zoneOptions = useMemo(() => {
    if (!data) return [];
    const labels = new Map<StockZone, string>();
    for (const t of data.totalsByZone) {
      labels.set(t.zone, t.zoneLabel);
    }
    return [...labels.entries()].sort((a, b) =>
      a[1].localeCompare(b[1], "fr"),
    );
  }, [data]);

  const filteredRows = useMemo(() => {
    if (!data) return [];
    if (zoneFilter === "all") return data.rows;
    return data.rows.filter((r) => r.zone === zoneFilter);
  }, [data, zoneFilter]);

  const scopeLabel = useMemo(() => {
    if (!data?.scopeSite) return "Tous les sites";
    return data.scopeSite === "zogbo" ? "Zogbo" : "Gbégamey";
  }, [data]);

  const showEnvoye = useMemo(
    () =>
      zoneFilter === "all" ||
      zoneFilter === "zogbo-plats" ||
      filteredRows.some((r) => r.envoye > 0),
    [zoneFilter, filteredRows],
  );

  return (
    <AppShell
      title="Stock"
      subtitle="Stock final par plat et accompagnement, calculé depuis les inventaires du jour"
      actions={
        data ? (
          <ExportExcelButton
            label="Exporter Excel"
            onExport={() => exportStockExcel(data)}
          />
        ) : undefined
      }
    >
      <div className="space-y-8">
        <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6">
          <h2 className="text-lg font-semibold text-stone-900">Date</h2>
          <p className="mt-1 text-sm text-stone-600">
            Zone visible : {scopeLabel}. Les chiffres reprennent les fiches
            inventaire (Zogbo / Gbégamey) : ouverture, entrées, ventes, pertes
            et reste théorique.
          </p>
          <div className="mt-4 flex flex-wrap items-end gap-4">
            <label className="block text-sm">
              <span className="font-medium text-stone-700">Journée</span>
              <input
                type="date"
                className="mt-1 block rounded-lg border border-stone-300 px-3 py-2"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="rounded-lg border border-stone-300 px-3 py-2 text-sm hover:bg-stone-50"
              onClick={() => setDate(todayIsoDate())}
            >
              Aujourd&apos;hui
            </button>
          </div>
          {data ? (
            <p className="mt-3 text-sm text-stone-500">
              {formatDisplayDate(date)}
              {data.dayStatus.zogbo
                ? ` · Zogbo : ${data.dayStatus.zogbo}`
                : ""}
              {data.dayStatus.gbegamey
                ? ` · Gbégamey : ${data.dayStatus.gbegamey}`
                : ""}
            </p>
          ) : null}
        </section>

        {error ? (
          <p className="error-banner" role="alert">
            {error}
          </p>
        ) : null}

        {loading ? (
          <p className="text-sm text-stone-500">Chargement…</p>
        ) : data ? (
          <>
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {data.totalsByZone.map((t) => {
                const href =
                  t.zone.startsWith("zogbo")
                    ? `/zogbo?date=${date}`
                    : `/gbegamey?date=${date}`;
                return (
                  <article
                    key={t.zone}
                    className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"
                  >
                    <h3 className="text-sm font-semibold text-stone-800">
                      <Link
                        href={href}
                        className="hover:text-teal-800 hover:underline"
                      >
                        {t.zoneLabel}
                      </Link>
                    </h3>
                    <dl className="mt-3 space-y-1 text-sm">
                      <div className="flex justify-between">
                        <dt className="text-stone-500">Lignes actives</dt>
                        <dd className="mono font-medium">{t.lignes}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-stone-500">Stock final</dt>
                        <dd className="mono font-semibold text-teal-800">
                          {t.stockFinal}
                        </dd>
                      </div>
                      {t.stockVendable !== null ? (
                        <div className="flex justify-between">
                          <dt className="text-stone-500">Vendable</dt>
                          <dd className="mono">{t.stockVendable}</dd>
                        </div>
                      ) : null}
                      <div className="flex justify-between">
                        <dt className="text-stone-500">Vendu</dt>
                        <dd className="mono">{t.vendu}</dd>
                      </div>
                      {t.ecarts > 0 ? (
                        <div className="flex justify-between text-amber-700">
                          <dt>Écarts inventaire</dt>
                          <dd className="mono">{t.ecarts}</dd>
                        </div>
                      ) : null}
                    </dl>
                  </article>
                );
              })}
            </section>

            <section className="rounded-xl border border-stone-200 bg-white shadow-sm">
              <div className="flex flex-wrap items-center gap-2 border-b border-stone-100 p-4">
                <span className="text-sm font-medium text-stone-700">
                  Filtrer :
                </span>
                <button
                  type="button"
                  className={`rounded-full px-3 py-1 text-sm ${
                    zoneFilter === "all"
                      ? "bg-teal-800 text-white"
                      : "border border-stone-300 hover:bg-stone-50"
                  }`}
                  onClick={() => setZoneFilter("all")}
                >
                  Toutes les zones
                </button>
                {zoneOptions.map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className={`rounded-full px-3 py-1 text-sm ${
                      zoneFilter === key
                        ? "bg-teal-800 text-white"
                        : "border border-stone-300 hover:bg-stone-50"
                    }`}
                    onClick={() => setZoneFilter(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {filteredRows.length === 0 ? (
                <p className="p-6 text-sm text-stone-500">
                  Aucun mouvement de stock pour cette date
                  {zoneFilter !== "all" ? " dans cette zone" : ""}.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[880px] text-sm">
                    <thead>
                      <tr className="border-b border-stone-200 bg-stone-50 text-left text-stone-600">
                        <th className="px-4 py-3 font-medium">Zone</th>
                        <th className="px-4 py-3 font-medium">Produit</th>
                        <th className="px-4 py-3 font-medium text-right">
                          Ouverture
                        </th>
                        <th className="px-4 py-3 font-medium text-right">
                          Entrées
                        </th>
                        {showEnvoye ? (
                          <th className="px-4 py-3 font-medium text-right">
                            Envoyé Gbé
                          </th>
                        ) : null}
                        <th className="px-4 py-3 font-medium text-right">
                          Vendu
                        </th>
                        <th className="px-4 py-3 font-medium text-right">
                          Pertes
                        </th>
                        <th className="px-4 py-3 font-medium text-right">
                          Stock final
                        </th>
                        <th className="px-4 py-3 font-medium text-right">
                          Vendable
                        </th>
                        <th className="px-4 py-3 font-medium text-right">
                          Compté
                        </th>
                        <th className="px-4 py-3 font-medium text-right">
                          Écart
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRows.map((row) => {
                        const href = zoneLink(row, date);
                        return (
                          <tr
                            key={`${row.zone}:${row.productId}`}
                            className="border-b border-stone-100 hover:bg-stone-50/80"
                          >
                            <td className="px-4 py-2.5 text-stone-600">
                              {href ? (
                                <Link
                                  href={href}
                                  className="hover:text-teal-800 hover:underline"
                                >
                                  {row.zoneLabel}
                                </Link>
                              ) : (
                                row.zoneLabel
                              )}
                            </td>
                            <td className="px-4 py-2.5 font-medium text-stone-900">
                              {row.name}
                            </td>
                            <td className="mono px-4 py-2.5 text-right">
                              {fmt(row.opening)}
                            </td>
                            <td className="mono px-4 py-2.5 text-right">
                              {fmt(row.entrees)}
                            </td>
                            {showEnvoye ? (
                              <td className="mono px-4 py-2.5 text-right">
                                {row.zone === "zogbo-plats"
                                  ? fmt(row.envoye)
                                  : "—"}
                              </td>
                            ) : null}
                            <td className="mono px-4 py-2.5 text-right">
                              {fmt(row.vendu)}
                            </td>
                            <td className="mono px-4 py-2.5 text-right">
                              {fmt(row.pertes)}
                            </td>
                            <td className="mono px-4 py-2.5 text-right font-semibold text-teal-800">
                              {fmt(row.stockFinal)}
                            </td>
                            <td className="mono px-4 py-2.5 text-right">
                              {fmt(row.stockVendable)}
                            </td>
                            <td className="mono px-4 py-2.5 text-right">
                              {fmt(row.compte)}
                            </td>
                            <td
                              className={`mono px-4 py-2.5 text-right ${ecartClass(row.ecart)}`}
                            >
                              {fmt(row.ecart)}
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
