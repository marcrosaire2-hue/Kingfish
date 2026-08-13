"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ExportExcelButton } from "@/components/export-excel-button";
import type {
  CaDayRow,
  ControlePayload,
  OpeningRow,
} from "@/lib/controle-repo";
import { formatFcfa } from "@/lib/format";
import { exportControleExcel } from "@/lib/page-exports";
import { formatDisplayDate, shiftIsoDate, todayIsoDate } from "@/lib/zogbo-calc";
import { BrandLoader } from "@/components/brand-loader";

function monthStartIso(d = todayIsoDate()): string {
  return `${d.slice(0, 7)}-01`;
}

const SOURCE_LABELS: Record<string, string> = {
  caisse: "Caisse",
  aquapro: "Importé",
  "carnet-zogbo": "Carnet Zogbo",
  reprise: "Reprise historique",
  "inventaire-marco": "Inventaire",
};

function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

function ecartClass(ecart: number): string {
  if (ecart === 0) return "text-emerald-700";
  if (Math.abs(ecart) < 500) return "text-amber-700";
  return "text-red-700";
}

function extraColumns(row: OpeningRow): { label: string; value: string }[] {
  const e = row.extra ?? {};
  switch (row.zone) {
    case "zogbo-plats":
      return [
        { label: "Préparé", value: String(e.prepared ?? "—") },
        { label: "Envoyé Gbé", value: String(e.sent ?? "—") },
        { label: "Vendu", value: String(e.sold ?? "—") },
        { label: "Reste th.", value: String(e.reste ?? "—") },
      ];
    case "gbegamey-recu":
      return [
        { label: "Reçu", value: String(e.received ?? "—") },
        { label: "Vendu", value: String(e.sold ?? "—") },
        { label: "Reste th.", value: String(e.reste ?? "—") },
      ];
    case "gbegamey-local":
      return [
        { label: "Préparé", value: String(e.prepared ?? "—") },
        { label: "Vendu", value: String(e.sold ?? "—") },
        { label: "Reste th.", value: String(e.reste ?? "—") },
      ];
    case "combos":
      return [{ label: "Vendu", value: String(e.sold ?? e.soldZogbo ?? e.soldGbegamey ?? "—") }];
    case "boissons":
      return [
        { label: "Vendu Zogbo (bt)", value: String(e.soldZogbo ?? "—") },
        { label: "Vendu Gbé (bt)", value: String(e.soldGbegamey ?? "—") },
        { label: "Reste (bt)", value: String(e.resteBt ?? "—") },
      ];
    case "matieres":
      return [
        { label: "Achats", value: String(e.purchases ?? "—") },
        { label: "Consommé", value: String(e.consumed ?? "—") },
        { label: "Reste th.", value: String(e.reste ?? "—") },
      ];
    default:
      return [];
  }
}

function zoneLink(row: OpeningRow, date: string): string | null {
  if (row.zone === "zogbo-plats") return `/zogbo?date=${date}`;
  if (row.zone.startsWith("gbegamey")) return `/gbegamey?date=${date}`;
  // Combos : plus d'écran de saisie dédié, seul l'historique (CA) subsiste
  // et se lit déjà sur cette même ligne — pas de lien à afficher.
  if (row.zone === "combos") return null;
  if (row.zone === "boissons") return `/boissons?date=${date}`;
  // Le comptage détaillé (seuils, compté, observations) vivait dans l'onglet
  // Matières, supprimé : la même matière se gère désormais depuis Stock.
  if (row.zone === "matieres") return `/appro?tab=stock&date=${date}`;
  return null;
}

export function ControlePage() {
  const [openingDate, setOpeningDate] = useState(() => todayIsoDate());
  const [from, setFrom] = useState(() => monthStartIso());
  const [to, setTo] = useState(() => todayIsoDate());
  const [data, setData] = useState<ControlePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoneFilter, setZoneFilter] = useState<string>("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ date: openingDate, from, to });
      const res = await fetch(`/api/controle?${params}`, { cache: "no-store" });
      const body = (await res.json()) as ControlePayload & { error?: string };
      if (!res.ok) throw new Error(body.error || "Erreur de chargement");
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [openingDate, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const zoneOptions = useMemo(() => {
    if (!data) return [];
    const labels = new Map<string, string>();
    for (const row of data.openings) {
      labels.set(row.zone, row.zoneLabel);
    }
    return [...labels.entries()].sort((a, b) => a[1].localeCompare(b[1], "fr"));
  }, [data]);

  const filteredOpenings = useMemo(() => {
    if (!data) return [];
    if (zoneFilter === "all") return data.openings;
    return data.openings.filter((r) => r.zone === zoneFilter);
  }, [data, zoneFilter]);

  const caDaysVisible = useMemo(() => {
    if (!data) return [];
    return data.caDays.filter(
      (d) => d.hasJournal || d.hasCompteur || d.journalTotal > 0,
    );
  }, [data]);

  const scopeLabel = useMemo(() => {
    if (!data?.scopeSite) return "Tous les sites";
    return data.scopeSite === "zogbo" ? "Zogbo" : "Gbégamey";
  }, [data]);

  return (
    <AppShell
      title="Contrôle"
      subtitle="Points initiaux et vérification du chiffre d'affaires journalier"
      actions={
        data ? (
          <ExportExcelButton
            label="Exporter Excel"
            onExport={() => exportControleExcel(data)}
          />
        ) : undefined
      }
    >
      <div className="space-y-8">
        <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6">
          <h2 className="text-lg font-semibold text-stone-900">
            Filtres
          </h2>
          <p className="mt-1 text-sm text-stone-600">
            Zone : {scopeLabel}. Le journal de ventes fait foi pour le CA (prix
            figés). L&apos;estimation catalogue (qty × tarif actuel) est
            indicative après un changement de prix.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <label className="block text-sm">
              <span className="font-medium text-stone-700">Date des points initiaux</span>
              <input
                type="date"
                className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2"
                value={openingDate}
                onChange={(e) => setOpeningDate(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-stone-700">CA — du</span>
              <input
                type="date"
                className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-stone-700">CA — au</span>
              <input
                type="date"
                className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-sm">
            <button
              type="button"
              className="rounded-lg border border-stone-300 px-3 py-1 hover:bg-stone-50"
              onClick={() => {
                const t = todayIsoDate();
                setFrom(monthStartIso(t));
                setTo(t);
              }}
            >
              Mois en cours
            </button>
            <button
              type="button"
              className="rounded-lg border border-stone-300 px-3 py-1 hover:bg-stone-50"
              onClick={() => {
                const t = todayIsoDate();
                const w = shiftIsoDate(t, -6) ?? t;
                setFrom(w);
                setTo(t);
              }}
            >
              7 derniers jours
            </button>
          </div>
        </section>

        {loading && (
          <BrandLoader variant="ligne" label="Chargement du contrôle…" />
        )}
        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </p>
        )}

        {data && !loading && (
          <>
            <section className="rounded-xl border border-stone-200 bg-white shadow-sm">
              <div className="border-b border-stone-100 px-4 py-4 sm:px-6">
                <h2 className="text-lg font-semibold text-stone-900">
                  Points initiaux — {formatDisplayDate(data.date)}
                </h2>
                <p className="mt-1 text-sm text-stone-600">
                  Ouverture enregistrée pour chaque zone. Les colonnes
                  complémentaires dépendent du type de stock.
                  {data.gbegameyOpeningEditable && (
                    <span className="ml-1 text-amber-700">
                      Jour d&apos;ouverture Gbégamey : les stocks initiaux restent modifiables.
                    </span>
                  )}
                </p>
                <div className="mt-3">
                  <label className="text-sm font-medium text-stone-700">
                    Zone{" "}
                    <select
                      className="ml-2 rounded-lg border border-stone-300 px-2 py-1"
                      value={zoneFilter}
                      onChange={(e) => setZoneFilter(e.target.value)}
                    >
                      <option value="all">Toutes</option>
                      {zoneOptions.map(([zone, label]) => (
                        <option key={zone} value={zone}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-stone-100 bg-stone-50 text-left text-stone-600">
                      <th className="px-4 py-2 font-medium">Zone</th>
                      <th className="px-4 py-2 font-medium">Produit</th>
                      <th className="px-4 py-2 font-medium text-right">Ouverture</th>
                      <th className="px-4 py-2 font-medium">Unité</th>
                      <th className="px-4 py-2 font-medium">Mouvements</th>
                      <th className="px-4 py-2 font-medium">Fiche</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOpenings.length === 0 ? (
                      <tr>
                        <td
                          colSpan={6}
                          className="px-4 py-6 text-center text-stone-500"
                        >
                          Aucun point initial enregistré pour cette date.
                        </td>
                      </tr>
                    ) : (
                      filteredOpenings.map((row) => {
                        const href = zoneLink(row, data.date);
                        const extras = extraColumns(row);
                        return (
                          <tr
                            key={`${row.zone}-${row.productId}`}
                            className="border-b border-stone-50 hover:bg-stone-50/50"
                          >
                            <td className="px-4 py-2 text-stone-700">{row.zoneLabel}</td>
                            <td className="px-4 py-2 font-medium text-stone-900">{row.name}</td>
                            <td className="px-4 py-2 text-right tabular-nums">{row.opening}</td>
                            <td className="px-4 py-2 text-stone-600">{row.unit}</td>
                            <td className="px-4 py-2 text-stone-600">
                              {extras.map((x) => (
                                <span key={x.label} className="mr-3 inline-block">
                                  {x.label} : {x.value}
                                </span>
                              ))}
                            </td>
                            <td className="px-4 py-2">
                              {href ? (
                                <Link
                                  href={href}
                                  className="text-sky-700 underline-offset-2 hover:underline"
                                >
                                  Ouvrir
                                </Link>
                              ) : (
                                "—"
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-xl border border-stone-200 bg-white shadow-sm">
              <div className="border-b border-stone-100 px-4 py-4 sm:px-6">
                <h2 className="text-lg font-semibold text-stone-900">
                  CA journalier (source de vérité)
                </h2>
                <p className="mt-1 text-sm text-stone-600">
                  Période {formatDisplayDate(data.from)} → {formatDisplayDate(data.to)}.
                  Le <strong>journal</strong> fait foi (prix figés à la vente).
                  L&apos;estimation catalogue (qty × prix actuel) est indicative
                  et peut différer après un changement de tarif.
                </p>
                <div className="mt-3 flex flex-wrap gap-4 text-sm">
                  <span>
                    Total journal :{" "}
                    <strong>{formatFcfa(data.caTotals.journal)}</strong>
                  </span>
                  <span>
                    Estimation catalogue :{" "}
                    <strong>{formatFcfa(data.caTotals.compteur)}</strong>
                  </span>
                  <span className={ecartClass(data.caTotals.ecart)}>
                    Écart tarif :{" "}
                    <strong>{formatFcfa(data.caTotals.ecart)}</strong>
                  </span>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-stone-100 bg-stone-50 text-left text-stone-600">
                      <th className="px-4 py-2 font-medium">Date</th>
                      {!data.scopeSite && (
                        <>
                          <th className="px-4 py-2 font-medium text-right">Journal Zogbo</th>
                          <th className="px-4 py-2 font-medium text-right">Journal Gbé</th>
                        </>
                      )}
                      <th className="px-4 py-2 font-medium text-right">Journal total</th>
                      {!data.scopeSite && (
                        <>
                          <th className="px-4 py-2 font-medium text-right">Estim. Zogbo</th>
                          <th className="px-4 py-2 font-medium text-right">Estim. Gbé</th>
                        </>
                      )}
                      <th className="px-4 py-2 font-medium text-right">Estim. catalogue</th>
                      <th className="px-4 py-2 font-medium text-right">Écart tarif</th>
                      <th className="px-4 py-2 font-medium">Sources journal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {caDaysVisible.length === 0 ? (
                      <tr>
                        <td
                          colSpan={data.scopeSite ? 5 : 9}
                          className="px-4 py-6 text-center text-stone-500"
                        >
                          Aucune vente ni fiche stock sur cette période.
                        </td>
                      </tr>
                    ) : (
                      caDaysVisible.map((day) => (
                        <CaDayTableRow
                          key={day.date}
                          day={day}
                          scopeSite={data.scopeSite}
                        />
                      ))
                    )}
                  </tbody>
                  {caDaysVisible.length > 0 && (
                    <tfoot>
                      <tr className="border-t border-stone-200 bg-stone-50 font-medium">
                        <td className="px-4 py-2">Total</td>
                        {!data.scopeSite && (
                          <>
                            <td className="px-4 py-2 text-right tabular-nums">
                              {formatFcfa(
                                data.caDays.reduce((s, d) => s + d.journalZogbo, 0),
                              )}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums">
                              {formatFcfa(
                                data.caDays.reduce((s, d) => s + d.journalGbegamey, 0),
                              )}
                            </td>
                          </>
                        )}
                        <td className="px-4 py-2 text-right tabular-nums">
                          {formatFcfa(data.caTotals.journal)}
                        </td>
                        {!data.scopeSite && (
                          <>
                            <td className="px-4 py-2 text-right tabular-nums">
                              {formatFcfa(
                                data.caDays.reduce((s, d) => s + d.compteurZogbo, 0),
                              )}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums">
                              {formatFcfa(
                                data.caDays.reduce((s, d) => s + d.compteurGbegamey, 0),
                              )}
                            </td>
                          </>
                        )}
                        <td className="px-4 py-2 text-right tabular-nums">
                          {formatFcfa(data.caTotals.compteur)}
                        </td>
                        <td
                          className={`px-4 py-2 text-right tabular-nums ${ecartClass(data.caTotals.ecart)}`}
                        >
                          {formatFcfa(data.caTotals.ecart)}
                        </td>
                        <td className="px-4 py-2" />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}

function CaDayTableRow({
  day,
  scopeSite,
}: {
  day: CaDayRow;
  scopeSite: "zogbo" | "gbegamey" | null;
}) {
  const sourcesText =
    day.sources.length === 0
      ? "—"
      : day.sources
          .map(
            (s) =>
              `${sourceLabel(s.source)} ${formatFcfa(s.montant)} (${s.lignes} lignes)`,
          )
          .join(" · ");

  return (
    <tr className="border-b border-stone-50 hover:bg-stone-50/50">
      <td className="px-4 py-2">
        <Link
          href={`/historique-ventes?date=${day.date}`}
          className="text-sky-700 underline-offset-2 hover:underline"
        >
          {formatDisplayDate(day.date)}
        </Link>
      </td>
      {!scopeSite && (
        <>
          <td className="px-4 py-2 text-right tabular-nums">
            {day.journalZogbo > 0 ? formatFcfa(day.journalZogbo) : "—"}
          </td>
          <td className="px-4 py-2 text-right tabular-nums">
            {day.journalGbegamey > 0 ? formatFcfa(day.journalGbegamey) : "—"}
          </td>
        </>
      )}
      <td className="px-4 py-2 text-right tabular-nums font-medium">
        {day.journalTotal > 0 ? formatFcfa(day.journalTotal) : "—"}
      </td>
      {!scopeSite && (
        <>
          <td className="px-4 py-2 text-right tabular-nums">
            {day.compteurZogbo > 0 ? formatFcfa(day.compteurZogbo) : "—"}
          </td>
          <td className="px-4 py-2 text-right tabular-nums">
            {day.compteurGbegamey > 0 ? formatFcfa(day.compteurGbegamey) : "—"}
          </td>
        </>
      )}
      <td className="px-4 py-2 text-right tabular-nums">
        {day.compteurTotal > 0 ? formatFcfa(day.compteurTotal) : "—"}
      </td>
      <td
        className={`px-4 py-2 text-right tabular-nums ${ecartClass(day.ecart)}`}
      >
        {day.journalTotal > 0 || day.compteurTotal > 0
          ? formatFcfa(day.ecart)
          : "—"}
      </td>
      <td className="max-w-xs px-4 py-2 text-xs text-stone-600">{sourcesText}</td>
    </tr>
  );
}
