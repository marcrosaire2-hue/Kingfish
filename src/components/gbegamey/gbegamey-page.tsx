"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ContextBar } from "@/components/context-bar";
import { ExportExcelButton } from "@/components/export-excel-button";
import { ProductIcon } from "@/components/product-icon";
import { QtyInput } from "@/components/qty-input";
import { ZoneBoissonsPanel } from "@/components/zone/zone-boissons-panel";
import { ZoneCombosPanel } from "@/components/zone/zone-combos-panel";
import { formatFcfa, formatUpdatedAt } from "@/lib/format";
import {
  computeGbegameyDay,
  createEmptyGbegameyDay,
} from "@/lib/gbegamey-calc";
import { exportGbegameyExcel } from "@/lib/page-exports";
import type {
  BaseDish,
  GbegameyDay,
  GbegameyLocalLine,
  GbegameyTransferLine,
  LocalDish,
} from "@/lib/types";
import { formatDisplayDate, todayIsoDate } from "@/lib/zogbo-calc";
import { BrandLoader } from "@/components/brand-loader";

type Payload = {
  day: GbegameyDay;
  baseDishes: BaseDish[];
  localDishes: LocalDish[];
  sentByProductId: Record<string, number>;
  openingEditable: boolean;
  caJournal?: number;
};

type SectionKey = "transfer" | "local" | "combos" | "boissons";

function parseSection(raw: string | null): SectionKey {
  if (raw === "local" || raw === "combos" || raw === "boissons") return raw;
  return "transfer";
}

export function GbegameyPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const section = parseSection(
    searchParams.get("tab") ?? searchParams.get("section"),
  );
  const [date, setDate] = useState(() => todayIsoDate());
  const [day, setDay] = useState<GbegameyDay | null>(null);
  const [baseDishes, setBaseDishes] = useState<BaseDish[]>([]);
  const [localDishes, setLocalDishes] = useState<LocalDish[]>([]);
  const [sentByProductId, setSentByProductId] = useState<
    Record<string, number>
  >({});
  /** Première mise en service : le stock de départ se saisit à la main. */
  const [openingEditable, setOpeningEditable] = useState(false);
  const [caJournal, setCaJournal] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function setSection(next: SectionKey) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "transfer") params.delete("tab");
    else params.set("tab", next);
    params.delete("section");
    const q = params.toString();
    router.replace(q ? `/gbegamey?${q}` : "/gbegamey");
  }

  const platsSection = section === "transfer" || section === "local";

  function handleDateChange(next: string) {
    if (
      dirty &&
      platsSection &&
      !window.confirm("Modifications non enregistrées. Changer de jour ?")
    ) {
      return;
    }
    setDate(next);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/gbegamey?date=${encodeURIComponent(date)}`,
          { cache: "no-store" },
        );
        const body = (await res.json()) as Payload & { error?: string };
        if (!res.ok) throw new Error(body.error || "Erreur de chargement");
        if (!cancelled) {
          setDay(body.day);
          setBaseDishes(body.baseDishes);
          setLocalDishes(body.localDishes);
          setCaJournal(Number(body.caJournal) || 0);
          setSentByProductId(body.sentByProductId);
          setOpeningEditable(!!body.openingEditable);
          setDirty(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Erreur de chargement");
          setDay(createEmptyGbegameyDay(date, [], []));
          setBaseDishes([]);
          setLocalDishes([]);
          setSentByProductId({});
          setOpeningEditable(false);
          setCaJournal(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [date]);

  const sentMap = useMemo(
    () => new Map(Object.entries(sentByProductId)),
    [sentByProductId],
  );

  const computed = useMemo(() => {
    if (!day) return null;
    return computeGbegameyDay(day, baseDishes, localDishes, sentMap);
  }, [day, baseDishes, localDishes, sentMap]);

  function patchTransfer(
    productId: string,
    patch: Partial<GbegameyTransferLine>,
  ) {
    if (!day) return;
    setDay({
      ...day,
      transferLines: day.transferLines.map((l) =>
        l.productId === productId ? { ...l, ...patch } : l,
      ),
    });
    setDirty(true);
  }

  function patchLocal(productId: string, patch: Partial<GbegameyLocalLine>) {
    if (!day) return;
    setDay({
      ...day,
      localLines: day.localLines.map((l) =>
        l.productId === productId ? { ...l, ...patch } : l,
      ),
    });
    setDirty(true);
  }

  async function handleSave() {
    if (!day) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/gbegamey", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: day.date,
          status: day.status,
          transferLines: day.transferLines,
          localLines: day.localLines,
        }),
      });
      const body = (await res.json()) as Payload & { error?: string };
      if (!res.ok) throw new Error(body.error || "Erreur d’enregistrement");
      setDay(body.day);
      setBaseDishes(body.baseDishes);
      setLocalDishes(body.localDishes);
      setSentByProductId(body.sentByProductId);
      setOpeningEditable(!!body.openingEditable);
      setDirty(false);
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur d’enregistrement");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell
      title="Gbégamey"
      subtitle="Stock init. et reçu auto ; saisissez vendu et compté. Montants en FCFA."
    >
      <ContextBar date={date} onDateChange={handleDateChange}>
        <ExportExcelButton
          onExport={() => exportGbegameyExcel(date)}
          disabled={loading}
        />
        {platsSection ? (
          <button
            type="button"
            className={`btn btn-primary${savedFlash && !dirty ? " btn-saved" : ""}`}
            onClick={handleSave}
            disabled={!dirty || saving || loading || !day}
          >
            {saving
              ? "Enregistrement…"
              : savedFlash
                ? "Enregistré"
                : dirty
                  ? "Enregistrer"
                  : "À jour"}
          </button>
        ) : null}
      </ContextBar>

      <div className="section-tabs" role="tablist" aria-label="Sections Gbégamey">
        <button
          type="button"
          role="tab"
          aria-selected={section === "transfer"}
          className={`section-tab${section === "transfer" ? " is-active" : ""}`}
          onClick={() => setSection("transfer")}
        >
          Reçu de Zogbo
          <span className="section-count">
            {day?.transferLines.length ?? 0}
          </span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={section === "local"}
          className={`section-tab${section === "local" ? " is-active" : ""}`}
          onClick={() => setSection("local")}
        >
          Sur place
          <span className="section-count">{day?.localLines.length ?? 0}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={section === "combos"}
          className={`section-tab${section === "combos" ? " is-active" : ""}`}
          onClick={() => setSection("combos")}
        >
          Combos
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={section === "boissons"}
          className={`section-tab${section === "boissons" ? " is-active" : ""}`}
          onClick={() => setSection("boissons")}
        >
          Boissons
        </button>
      </div>

      {section === "combos" ? (
        <ZoneCombosPanel date={date} site="gbegamey" />
      ) : null}
      {section === "boissons" ? (
        <ZoneBoissonsPanel date={date} site="gbegamey" />
      ) : null}

      {platsSection ? (
        <>
      <div className="param-meta">
        <p>
          <strong>{formatDisplayDate(date)}</strong>
          {" · "}
          Dernière sauvegarde :{" "}
          <strong>
            {loading ? "…" : formatUpdatedAt(day?.updatedAt ?? null)}
          </strong>
        </p>
        {computed && computed.totals.varianceCount > 0 ? (
          <p className="warn-inline">
            {computed.totals.varianceCount} écart
            {computed.totals.varianceCount > 1 ? "s" : ""}
          </p>
        ) : null}
      </div>

      {error ? (
        <p className="error-banner" role="alert">
          {error}
        </p>
      ) : null}

      {computed ? (
        <div className="stat-row">
          <div className="stat-chip">
            <span className="stat-label">Solde initial</span>
            <span className="stat-value mono">
              {computed.totals.initialStock}
            </span>
          </div>
          <div className="stat-chip">
            <span className="stat-label">Envoyé par Zogbo</span>
            <span className="stat-value mono">{computed.totals.sent}</span>
          </div>
          {computed.totals.transportVarianceCount > 0 ? (
            <div className="stat-chip">
              <span className="stat-label">Perte au transport</span>
              <span className="stat-value mono">
                {computed.totals.transportLost}
              </span>
            </div>
          ) : null}
          <div className="stat-chip">
            <span className="stat-label">Solde (init.+reçu)</span>
            <span className="stat-value mono">
              {computed.totals.initialStock + computed.totals.received}
            </span>
          </div>
          <div className="stat-chip">
            <span className="stat-label">Vendu (transferts)</span>
            <span className="stat-value mono">
              {computed.totals.transferSold}
            </span>
          </div>
          <div className="stat-chip">
            <span className="stat-label">Vendu (locaux)</span>
            <span className="stat-value mono">{computed.totals.localSold}</span>
          </div>
          <div className="stat-chip accent">
            <span className="stat-label">CA journal (FCFA)</span>
            <span className="stat-value mono">
              {formatFcfa(caJournal)}
            </span>
          </div>
        </div>
      ) : null}

      {openingEditable && platsSection ? (
        <div className="ui-info" role="note">
          <span className="ui-info-mark" aria-hidden>
            i
          </span>
          <p>
            Première mise en service : saisissez vous-même le stock initial de
            chaque plat, puis enregistrez. Dès le lendemain, ce stock est
            reporté automatiquement du reste de la veille et la colonne
            disparaît — vous ne saisirez plus que le reçu de Zogbo.
          </p>
        </div>
      ) : null}

      <div className="ui-info" role="note">
        <span className="ui-info-mark" aria-hidden>
          i
        </span>
        <p>
          {section === "transfer"
            ? "Stock = quantités (reçu, vendu, reste). Le CA affiché est la somme du journal des ventes (prix figés), pas qty × catalogue."
            : "Stock = quantités (préparé, vendu, reste). Le CA du jour vient du journal des ventes."}
        </p>
      </div>

      {section === "transfer" ? (
        <section className="panel panel-wide">
          <table className="data-table zogbo-table">
            <thead>
              <tr>
                <th scope="col">Plat</th>
                {openingEditable ? (
                  <th scope="col" className="col-qty">
                    Stock initial
                    <span className="col-auto-tag">1ʳᵉ saisie</span>
                  </th>
                ) : null}
                <th scope="col" className="col-qty">
                  Solde
                  <span className="col-auto-tag">init.+reçu</span>
                </th>
                <th scope="col" className="col-qty">
                  Reçu réel
                  <span className="col-auto-tag">si vérifié</span>
                </th>
                <th scope="col" className="col-qty">
                  Vendu
                  <span className="col-auto-tag">via Vente</span>
                </th>
                <th scope="col" className="col-qty">
                  Stock actuel
                  <span className="col-auto-tag">solde − vendu</span>
                </th>
                <th scope="col" className="col-qty">
                  Compté
                </th>
              </tr>
            </thead>
            <tbody>
              {loading || !computed ? (
                <tr>
                  <td colSpan={openingEditable ? 7 : 6}>
                    <BrandLoader variant="ligne" label="Chargement…" />
                  </td>
                </tr>
              ) : computed.transfers.length === 0 ? (
                <tr>
                  <td colSpan={openingEditable ? 7 : 6} className="muted">
                    Aucun plat de base. Configurez Paramètres puis saisissez
                    les envois dans Zogbo.
                  </td>
                </tr>
              ) : (
                computed.transfers.map((line) => {
                  const hasVariance =
                    line.variance !== null && line.variance !== 0;
                  const hasTransportLoss =
                    line.transportVariance !== null &&
                    line.transportVariance !== 0;
                  return (
                    <tr
                      key={line.productId}
                      className={
                        hasVariance || hasTransportLoss ? "row-warn" : undefined
                      }
                    >
                      <td className="cell-name">
                        <span className="plat-cell">
                          <ProductIcon kind="plat" name={line.name} size="sm" />
                          <span>
                            {line.name}
                            <span className="cell-sub">
                              Init {line.initialStock} · Reçu{" "}
                              {line.receivedFromZogbo}
                              {hasTransportLoss ? (
                                <span className="cell-variance">
                                  {" "}
                                  · Écart transp. {line.transportVariance}
                                </span>
                              ) : null}
                            </span>
                            <span className="cell-sub mono">
                              Catalogue {formatFcfa(line.unitPrice)}
                            </span>
                          </span>
                        </span>
                      </td>
                      {openingEditable ? (
                        <td className="col-qty">
                          <QtyInput
                            value={line.initialStock}
                            ariaLabel={`Stock initial ${line.name}`}
                            onChange={(initialStock) =>
                              patchTransfer(line.productId, {
                                initialStock: initialStock ?? 0,
                              })
                            }
                          />
                        </td>
                      ) : null}
                      <td className="col-qty mono cell-readonly cell-auto">
                        {line.available}
                      </td>
                      <td className="col-qty">
                        <QtyInput
                          value={line.received}
                          allowEmpty
                          placeholder="—"
                          ariaLabel={`Reçu réel ${line.name}`}
                          onChange={(received) =>
                            patchTransfer(line.productId, { received })
                          }
                        />
                      </td>
                      <td className="col-qty mono cell-readonly cell-auto">
                        {line.sold}
                      </td>
                      <td className="col-qty mono cell-readonly stock-actuel">
                        {line.theoreticalRemaining}
                      </td>
                      <td className="col-qty">
                        <QtyInput
                          value={line.counted}
                          allowEmpty
                          placeholder="—"
                          ariaLabel={`Compté ${line.name}`}
                          onChange={(counted) =>
                            patchTransfer(line.productId, { counted })
                          }
                        />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {computed && computed.transfers.length > 0 ? (
              <tfoot>
                <tr>
                  <th scope="row">TOTAL</th>
                  {openingEditable ? (
                    <td className="mono">{computed.totals.initialStock}</td>
                  ) : null}
                  <td className="mono">
                    {computed.totals.initialStock + computed.totals.received}
                  </td>
                  <td />
                  <td className="mono">{computed.totals.transferSold}</td>
                  <td />
                  <td />
                </tr>
              </tfoot>
            ) : null}
          </table>
        </section>
      ) : (
        <section className="panel panel-wide">
          <table className="data-table zogbo-table">
            <thead>
              <tr>
                <th scope="col">Plat</th>
                {openingEditable ? (
                  <th scope="col" className="col-qty">
                    Stock initial
                    <span className="col-auto-tag">1ʳᵉ saisie</span>
                  </th>
                ) : null}
                <th scope="col" className="col-qty">
                  Dispo
                  <span className="col-auto-tag">init.+préparé</span>
                </th>
                <th scope="col" className="col-qty">
                  Préparé
                </th>
                <th scope="col" className="col-qty">
                  Vendu
                  <span className="col-auto-tag">via Vente</span>
                </th>
                <th scope="col" className="col-qty">
                  Stock actuel
                  <span className="col-auto-tag">dispo − vendu</span>
                </th>
                <th scope="col" className="col-qty">
                  Compté
                </th>
              </tr>
            </thead>
            <tbody>
              {loading || !computed ? (
                <tr>
                  <td colSpan={openingEditable ? 7 : 6}>
                    <BrandLoader variant="ligne" label="Chargement…" />
                  </td>
                </tr>
              ) : computed.locals.length === 0 ? (
                <tr>
                  <td colSpan={openingEditable ? 7 : 6} className="muted">
                    Aucun plat local dans Paramètres.
                  </td>
                </tr>
              ) : (
                computed.locals.map((line) => {
                  const hasVariance =
                    line.variance !== null && line.variance !== 0;
                  return (
                    <tr
                      key={line.productId}
                      className={hasVariance ? "row-warn" : undefined}
                    >
                      <td className="cell-name">
                        <span className="plat-cell">
                          <ProductIcon kind="local" name={line.name} size="sm" />
                          <span>
                            {line.name}
                            <span className="cell-sub">
                              Init {line.initialStock}
                            </span>
                            <span className="cell-sub mono">
                              Catalogue {formatFcfa(line.unitPrice)}
                            </span>
                          </span>
                        </span>
                      </td>
                      {openingEditable ? (
                        <td className="col-qty">
                          <QtyInput
                            value={line.initialStock}
                            ariaLabel={`Stock initial ${line.name}`}
                            onChange={(initialStock) =>
                              patchLocal(line.productId, {
                                initialStock: initialStock ?? 0,
                              })
                            }
                          />
                        </td>
                      ) : null}
                      <td className="col-qty mono cell-readonly">
                        {line.available}
                      </td>
                      <td className="col-qty">
                        <QtyInput
                          value={line.prepared}
                          ariaLabel={`Préparé ${line.name}`}
                          onChange={(prepared) =>
                            patchLocal(line.productId, {
                              prepared: prepared ?? 0,
                            })
                          }
                        />
                      </td>
                      <td className="col-qty mono cell-readonly cell-auto">
                        {line.sold}
                      </td>
                      <td className="col-qty mono cell-readonly stock-actuel">
                        {line.theoreticalRemaining}
                      </td>
                      <td className="col-qty">
                        <QtyInput
                          value={line.counted}
                          allowEmpty
                          placeholder="—"
                          ariaLabel={`Compté ${line.name}`}
                          onChange={(counted) =>
                            patchLocal(line.productId, { counted })
                          }
                        />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {computed && computed.locals.length > 0 ? (
              <tfoot>
                <tr>
                  <th scope="row">TOTAL</th>
                  {openingEditable ? <td /> : null}
                  <td />
                  <td className="mono">{computed.totals.localPrepared}</td>
                  <td className="mono">{computed.totals.localSold}</td>
                  <td />
                  <td />
                </tr>
              </tfoot>
            ) : null}
          </table>
        </section>
      )}
        </>
      ) : null}
    </AppShell>
  );
}
