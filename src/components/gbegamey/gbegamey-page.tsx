"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ContextBar } from "@/components/context-bar";
import { ExportExcelButton } from "@/components/export-excel-button";
import { ProductIcon } from "@/components/product-icon";
import { QtyInput } from "@/components/qty-input";
import {
  CataloguePaginationBar,
  CatalogueSkeleton,
} from "@/components/parametres/catalogue-view";
import { ParametresEditor } from "@/components/parametres/parametres-editor";
import { ZoneBoissonsPanel } from "@/components/zone/zone-boissons-panel";
import { ZoneVentesPanel } from "@/components/zone/zone-ventes-panel";
import "@/components/parametres/parametres-catalogue.css";
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
  GbegameyReceiptMovement,
  GbegameyTransferLine,
  LocalDish,
  VenteLogEntry,
  VentesDaySummary,
} from "@/lib/types";
import { formatDisplayDate, todayIsoDate } from "@/lib/zogbo-calc";

type Payload = {
  day: GbegameyDay;
  baseDishes: BaseDish[];
  localDishes: LocalDish[];
  sentByProductId: Record<string, number>;
  openingEditable: boolean;
  caJournal?: number;
  ventes?: VenteLogEntry[];
  ventesSummary?: VentesDaySummary;
};

type SectionKey = "transfer" | "local" | "boissons" | "ventes" | "parametres";

function parseSection(raw: string | null): SectionKey {
  if (
    raw === "local" ||
    raw === "boissons" ||
    raw === "ventes" ||
    raw === "parametres"
  ) {
    return raw;
  }
  return "transfer";
}

const PAGE_SIZE = 6;

function useDebouncedValue<T>(value: T, delayMs = 280): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

function normalizeSearch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function matchesSearch(name: string, query: string): boolean {
  if (!query) return true;
  return normalizeSearch(name).includes(normalizeSearch(query));
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

function StockSearch({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="catalogue-search-wrap">
      <span className="catalogue-search-icon" aria-hidden>
        ⌕
      </span>
      <input
        type="search"
        className="catalogue-search"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function StockErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="catalogue-alert catalogue-alert-danger" role="alert">
      <span className="catalogue-alert-icon" aria-hidden>
        !
      </span>
      <span>
        {message}
        {onRetry ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm catalogue-retry"
            onClick={onRetry}
          >
            Réessayer
          </button>
        ) : null}
      </span>
    </div>
  );
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
  const [ventes, setVentes] = useState<VenteLogEntry[]>([]);
  const [ventesSummary, setVentesSummary] = useState<VentesDaySummary | null>(
    null,
  );
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [backdate, setBackdate] = useState(false);
  const [receiveQty, setReceiveQty] = useState<Record<string, string>>({});
  const [receiveNote, setReceiveNote] = useState<Record<string, string>>({});
  const [receiveBusy, setReceiveBusy] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [platSearch, setPlatSearch] = useState("");
  const [accSearch, setAccSearch] = useState("");
  const [platPage, setPlatPage] = useState(1);
  const [accPage, setAccPage] = useState(1);
  const debouncedPlatSearch = useDebouncedValue(platSearch);
  const debouncedAccSearch = useDebouncedValue(accSearch);

  function applyPayload(body: Payload) {
    setDay(body.day);
    setBaseDishes(body.baseDishes);
    setLocalDishes(body.localDishes);
    setSentByProductId(body.sentByProductId);
    setOpeningEditable(!!body.openingEditable);
    if (body.caJournal != null) setCaJournal(Number(body.caJournal) || 0);
    if (body.ventes) setVentes(body.ventes);
    if (body.ventesSummary) setVentesSummary(body.ventesSummary);
    setDirty(false);
  }

  async function confirmReceive(productId: string, sent: number, name: string) {
    const raw = receiveQty[productId];
    const qty =
      raw === undefined || raw === ""
        ? sent
        : Math.round(Number(String(raw).replace(",", ".")) || 0);
    const note = receiveNote[productId] ?? "";
    setReceiveBusy(productId);
    setError(null);
    try {
      const res = await fetch("/api/gbegamey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "receive",
          date,
          productId,
          qty,
          note,
        }),
      });
      const body = (await res.json()) as Payload & { error?: string };
      if (!res.ok) throw new Error(body.error || "Réception impossible");
      applyPayload(body);
      setReceiveQty((prev) => {
        const next = { ...prev };
        delete next[productId];
        return next;
      });
      setReceiveNote((prev) => {
        const next = { ...prev };
        delete next[productId];
        return next;
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : `Réception impossible pour ${name}`,
      );
    } finally {
      setReceiveBusy(null);
    }
  }

  async function cancelReceive(receipt: GbegameyReceiptMovement) {
    if (
      !window.confirm(
        `Annuler la réception de ${receipt.qty} × ${receipt.name} ?`,
      )
    ) {
      return;
    }
    setReceiveBusy(receipt.id);
    setError(null);
    try {
      const res = await fetch("/api/gbegamey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "cancel-receive",
          date,
          receiptId: receipt.id,
        }),
      });
      const body = (await res.json()) as Payload & { error?: string };
      if (!res.ok) throw new Error(body.error || "Annulation impossible");
      applyPayload(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Annulation impossible");
    } finally {
      setReceiveBusy(null);
    }
  }

  function setSection(next: SectionKey) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "transfer") params.delete("tab");
    else params.set("tab", next);
    params.delete("section");
    const q = params.toString();
    router.replace(q ? `/stock-gbegamey?${q}` : "/stock-gbegamey");
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
        const body = (await res.json()) as Payload & {
          error?: string;
          backdate?: boolean;
        };
        if (!res.ok) throw new Error(body.error || "Erreur de chargement");
        if (!cancelled) {
          applyPayload(body);
          setCaJournal(Number(body.caJournal) || 0);
          setVentes(body.ventes ?? []);
          setVentesSummary(body.ventesSummary ?? null);
          setBackdate(!!body.backdate);
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
          setVentes([]);
          setVentesSummary(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [date, reloadTick]);

  const sentMap = useMemo(
    () => new Map(Object.entries(sentByProductId)),
    [sentByProductId],
  );

  const computed = useMemo(() => {
    if (!day) return null;
    return computeGbegameyDay(day, baseDishes, localDishes, sentMap);
  }, [day, baseDishes, localDishes, sentMap]);

  const filteredTransfers = useMemo(() => {
    if (!computed) return [];
    return computed.transfers.filter((l) =>
      matchesSearch(l.name, debouncedPlatSearch),
    );
  }, [computed, debouncedPlatSearch]);

  const filteredLocals = useMemo(() => {
    if (!computed) return [];
    return computed.locals.filter((l) =>
      matchesSearch(l.name, debouncedAccSearch),
    );
  }, [computed, debouncedAccSearch]);

  const pagedTransfers = useMemo(
    () => paginate(filteredTransfers, platPage, PAGE_SIZE),
    [filteredTransfers, platPage],
  );

  const pagedLocals = useMemo(
    () => paginate(filteredLocals, accPage, PAGE_SIZE),
    [filteredLocals, accPage],
  );

  useEffect(() => {
    setPlatPage(1);
  }, [debouncedPlatSearch]);

  useEffect(() => {
    setAccPage(1);
  }, [debouncedAccSearch]);

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
      title={
        section === "parametres" ? "Catalogue & paramètres" : "Stock Gbégamey"
      }
      subtitle={
        section === "parametres"
          ? "Gérez vos produits, matières et recettes."
          : "Saisie du stock — plats reçus de Zogbo, accompagnements et boissons."
      }
      mainClassName={
        section === "parametres" ? "main-catalogue" : "main-gbegamey"
      }
    >
      <div className="stock-zogbo-page catalogue-view">
        {section !== "parametres" ? (
          <ContextBar
            date={date}
            onDateChange={handleDateChange}
            siteLabel="Gbégamey"
          >
            <ExportExcelButton
              onExport={() => exportGbegameyExcel(date)}
              disabled={loading}
            />
          </ContextBar>
        ) : null}

        {backdate && section !== "parametres" ? (
          <div className="catalogue-info" role="status">
            <span className="catalogue-info-mark" aria-hidden>
              i
            </span>
            <p>
              Correction d&apos;un jour passé — stock et mouvements
              enregistrables sur cette date.
            </p>
          </div>
        ) : null}

        <div
          className="section-tabs catalogue-stock-tabs"
          role="tablist"
          aria-label="Sections Stock Gbégamey"
        >
          <button
            type="button"
            role="tab"
            aria-selected={section === "transfer"}
            className={`section-tab${section === "transfer" ? " is-active" : ""}`}
            onClick={() => setSection("transfer")}
          >
            Plats
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
            Accompagnements
            <span className="section-count">{day?.localLines.length ?? 0}</span>
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
          <button
            type="button"
            role="tab"
            aria-selected={section === "ventes"}
            className={`section-tab${section === "ventes" ? " is-active" : ""}`}
            onClick={() => setSection("ventes")}
          >
            Ventes
            {ventesSummary?.lignes ? (
              <span className="section-count">{ventesSummary.lignes}</span>
            ) : null}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={section === "parametres"}
            className={`section-tab${section === "parametres" ? " is-active" : ""}`}
            onClick={() => setSection("parametres")}
          >
            Catalogue
          </button>
        </div>

        {error && section !== "parametres" ? (
          <StockErrorBanner
            message={error}
            onRetry={() => setReloadTick((n) => n + 1)}
          />
        ) : null}

        {section === "parametres" ? (
          <ParametresEditor mode="catalogue" />
        ) : null}

        {section === "boissons" ? (
          <ZoneBoissonsPanel date={date} site="gbegamey" premium />
        ) : null}
        {section === "ventes" ? (
          <ZoneVentesPanel
            date={date}
            site="gbegamey"
            ventes={ventes}
            summary={ventesSummary}
            loading={loading}
            premium
          />
        ) : null}

        {platsSection && loading ? <CatalogueSkeleton /> : null}

        {platsSection && !loading && computed ? (
          <>
            <div className="catalogue-kpi-grid" aria-label="Totaux du jour">
              <div className="catalogue-kpi">
                <span className="catalogue-kpi-label">Stock du jour</span>
                <strong className="catalogue-kpi-value">
                  {computed.totals.available}
                </strong>
              </div>
              <div className="catalogue-kpi">
                <span className="catalogue-kpi-label">Vendu (plats)</span>
                <strong className="catalogue-kpi-value">
                  {computed.totals.transferSold}
                </strong>
              </div>
              <div className="catalogue-kpi">
                <span className="catalogue-kpi-label">Vendu (acc.)</span>
                <strong className="catalogue-kpi-value">
                  {computed.totals.localSold}
                </strong>
              </div>
              <div className="catalogue-kpi catalogue-kpi-accent">
                <span className="catalogue-kpi-label">CA journal</span>
                <strong className="catalogue-kpi-value">
                  {formatFcfa(caJournal)}
                </strong>
              </div>
            </div>

            <p className="catalogue-meta">
              <span className="catalogue-meta-icon" aria-hidden>
                📅
              </span>
              <strong>{formatDisplayDate(date)}</strong>
              {" · "}
              Dernière sauvegarde :{" "}
              <strong>{formatUpdatedAt(day?.updatedAt ?? null)}</strong>
              {computed.totals.varianceCount > 0 ? (
                <>
                  {" · "}
                  <span className="warn-inline">
                    {computed.totals.varianceCount} écart
                    {computed.totals.varianceCount > 1 ? "s" : ""}
                  </span>
                </>
              ) : null}
            </p>

            {openingEditable ? (
              <div className="catalogue-info" role="note">
                <span className="catalogue-info-mark" aria-hidden>
                  i
                </span>
                <p>
                  Première mise en service : saisissez vous-même le stock
                  initial de chaque plat, puis enregistrez. Dès le lendemain,
                  ce stock est reporté automatiquement du reste de la veille
                  et la colonne disparaît — vous ne saisirez plus que le stock
                  actuel (comptage).
                </p>
              </div>
            ) : null}

            <div className="catalogue-info" role="note">
              <span className="catalogue-info-mark" aria-hidden>
                i
              </span>
              <p>
                {section === "transfer"
                  ? "Stock = quantités (solde, vendu, reste). Le CA affiché est la somme du journal des ventes (prix figés), pas qty × catalogue."
                  : "Stock = quantités (préparé, vendu, reste). Le CA du jour vient du journal des ventes."}
              </p>
            </div>

            {section === "transfer" ? (
              <div className="stock-zogbo-layout-premium">
                <section className="catalogue-panel stock-zogbo-main">
                  <div className="catalogue-toolbar">
                    <StockSearch
                      value={platSearch}
                      onChange={setPlatSearch}
                      placeholder="Rechercher un plat…"
                    />
                    <button
                      type="button"
                      className={`btn btn-primary${savedFlash && !dirty ? " btn-saved" : ""}`}
                      onClick={() => void handleSave()}
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
                  </div>

                  {filteredTransfers.length === 0 ? (
                    <div className="catalogue-empty">
                      <p className="catalogue-empty-title">
                        {computed.transfers.length === 0
                          ? "Aucun plat dans Paramètres."
                          : "Aucun plat trouvé"}
                      </p>
                      <p className="catalogue-empty-hint">
                        {computed.transfers.length === 0
                          ? "Ajoutez des plats au catalogue."
                          : "Modifiez votre recherche."}
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="catalogue-table-wrap stock-zogbo-desktop-table">
                        <table className="catalogue-table stock-zogbo-table">
                          <thead>
                            <tr>
                              <th scope="col">Plat</th>
                              {openingEditable ? (
                                <th scope="col">Stock initial</th>
                              ) : null}
                              <th scope="col">Reçu constaté</th>
                              <th scope="col">Solde</th>
                              <th scope="col">Vendu</th>
                              <th scope="col">Stock actuel</th>
                            </tr>
                          </thead>
                          <tbody>
                            {pagedTransfers.items.map((line) => {
                              const hasVariance =
                                line.variance !== null && line.variance !== 0;
                              return (
                                <tr
                                  key={line.productId}
                                  className={
                                    hasVariance ? "row-warn" : undefined
                                  }
                                >
                                  <td>
                                    <div className="catalogue-product-cell">
                                      <ProductIcon
                                        kind="plat"
                                        name={line.name}
                                      />
                                      <span>
                                        <span className="catalogue-product-name">
                                          {line.name}
                                        </span>
                                        <span className="cell-sub">
                                          Initial{" "}
                                          {line.counted ?? line.initialStock}
                                          {line.counted !== null
                                            ? " (compté)"
                                            : ""}
                                        </span>
                                        <span className="cell-sub mono">
                                          Catalogue{" "}
                                          {formatFcfa(line.unitPrice)}
                                        </span>
                                      </span>
                                    </div>
                                  </td>
                                  {openingEditable ? (
                                    <td>
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
                                  <td>
                                    <QtyInput
                                      value={line.received}
                                      allowEmpty
                                      placeholder={String(line.sentFromZogbo)}
                                      ariaLabel={`Reçu constaté ${line.name}`}
                                      onChange={(received) =>
                                        patchTransfer(line.productId, {
                                          received,
                                        })
                                      }
                                    />
                                    <span className="cell-sub muted">
                                      envoyé {line.sentFromZogbo}
                                    </span>
                                    {line.transportVariance ? (
                                      <span className="cell-sub text-amber-700">
                                        écart transport{" "}
                                        {line.transportVariance > 0
                                          ? "-"
                                          : "+"}
                                        {Math.abs(line.transportVariance)}
                                      </span>
                                    ) : null}
                                  </td>
                                  <td>
                                    <span className="catalogue-qty-badge">
                                      {line.available}
                                    </span>
                                  </td>
                                  <td>
                                    <span className="catalogue-qty-badge">
                                      {line.sold}
                                    </span>
                                  </td>
                                  <td>
                                    <QtyInput
                                      value={line.counted}
                                      allowEmpty
                                      placeholder={String(
                                        line.theoreticalRemaining,
                                      )}
                                      ariaLabel={`Stock actuel ${line.name}`}
                                      onChange={(counted) =>
                                        patchTransfer(line.productId, {
                                          counted,
                                        })
                                      }
                                    />
                                    {line.counted !== null ? (
                                      <span className="cell-sub muted">
                                        théo. {line.theoreticalRemaining}
                                      </span>
                                    ) : null}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                          {filteredTransfers.length > 0 ? (
                            <tfoot>
                              <tr>
                                <th scope="row">TOTAL</th>
                                {openingEditable ? (
                                  <td>
                                    <span className="catalogue-qty-badge">
                                      {computed.totals.initialStock}
                                    </span>
                                  </td>
                                ) : null}
                                <td>
                                  <span className="catalogue-qty-badge">
                                    {computed.totals.received}
                                  </span>
                                </td>
                                <td>
                                  <span className="catalogue-qty-badge">
                                    {computed.totals.initialStock +
                                      computed.totals.received}
                                  </span>
                                </td>
                                <td>
                                  <span className="catalogue-qty-badge">
                                    {computed.totals.transferSold}
                                  </span>
                                </td>
                                <td />
                              </tr>
                            </tfoot>
                          ) : null}
                        </table>
                      </div>

                      <div className="stock-zogbo-mobile-list">
                        {pagedTransfers.items.map((line) => (
                          <article
                            key={line.productId}
                            className={`stock-mobile-card${
                              line.variance ? " is-warn" : ""
                            }`}
                          >
                            <div className="stock-mobile-card-head">
                              <ProductIcon
                                kind="plat"
                                name={line.name}
                                size="lg"
                              />
                              <span className="catalogue-product-name">
                                {line.name}
                              </span>
                            </div>
                            <div className="stock-mobile-metrics">
                              <div className="stock-mobile-metric">
                                <span className="stock-mobile-metric-label">
                                  Solde
                                </span>
                                <strong>{line.available}</strong>
                              </div>
                              <div className="stock-mobile-metric">
                                <span className="stock-mobile-metric-label">
                                  Vendu
                                </span>
                                <strong>{line.sold}</strong>
                              </div>
                              <div className="stock-mobile-metric">
                                <span className="stock-mobile-metric-label">
                                  Envoyé
                                </span>
                                <strong>{line.sentFromZogbo}</strong>
                              </div>
                            </div>
                            <div className="stock-mobile-card-prices catalogue-mobile-card-prices">
                              {openingEditable ? (
                                <div>
                                  <span className="catalogue-mobile-price-label">
                                    Stock initial
                                  </span>
                                  <QtyInput
                                    value={line.initialStock}
                                    ariaLabel={`Stock initial ${line.name}`}
                                    onChange={(initialStock) =>
                                      patchTransfer(line.productId, {
                                        initialStock: initialStock ?? 0,
                                      })
                                    }
                                  />
                                </div>
                              ) : null}
                              <div>
                                <span className="catalogue-mobile-price-label">
                                  Reçu constaté
                                </span>
                                <QtyInput
                                  value={line.received}
                                  allowEmpty
                                  placeholder={String(line.sentFromZogbo)}
                                  ariaLabel={`Reçu constaté ${line.name}`}
                                  onChange={(received) =>
                                    patchTransfer(line.productId, {
                                      received,
                                    })
                                  }
                                />
                              </div>
                              <div>
                                <span className="catalogue-mobile-price-label">
                                  Stock actuel
                                </span>
                                <QtyInput
                                  value={line.counted}
                                  allowEmpty
                                  placeholder={String(
                                    line.theoreticalRemaining,
                                  )}
                                  ariaLabel={`Stock actuel ${line.name}`}
                                  onChange={(counted) =>
                                    patchTransfer(line.productId, { counted })
                                  }
                                />
                              </div>
                            </div>
                          </article>
                        ))}
                      </div>

                      <CataloguePaginationBar
                        from={pagedTransfers.from}
                        to={pagedTransfers.to}
                        total={pagedTransfers.total}
                        page={pagedTransfers.page}
                        totalPages={pagedTransfers.totalPages}
                        onPage={setPlatPage}
                      />
                    </>
                  )}
                </section>

                <aside className="catalogue-panel stock-aside-premium">
                  <h2 className="panel-title">Réceptions Zogbo → Gbégamey</h2>
                  <p className="section-hint">
                    Confirmez chaque envoi. Un écart (envoyé ≠ reçu) exige une
                    justification.
                  </p>
                  <ul className="site-rank-list">
                    {computed.transfers
                      .filter(
                        (l) => l.sentFromZogbo > 0 || l.received !== null,
                      )
                      .map((line) => {
                        const pending =
                          line.received === null && line.sentFromZogbo > 0;
                        const qtyStr =
                          receiveQty[line.productId] ??
                          (pending ? String(line.sentFromZogbo) : "");
                        const noteStr = receiveNote[line.productId] ?? "";
                        const previewQty =
                          qtyStr === ""
                            ? line.sentFromZogbo
                            : Math.round(
                                Number(qtyStr.replace(",", ".")) || 0,
                              );
                        const previewVar = line.sentFromZogbo - previewQty;
                        return (
                          <li
                            key={`recv-${line.productId}`}
                            className={`site-rank-card${
                              line.transportVariance ? " is-warn" : ""
                            }`}
                          >
                            <div className="site-rank-top">
                              <div className="site-rank-main">
                                <strong className="site-rank-name">
                                  {line.name}
                                </strong>
                                <span className="site-rank-qty muted">
                                  {pending
                                    ? "En attente de confirmation"
                                    : `Reçu ${line.received} · envoyé ${line.sentFromZogbo}`}
                                  {line.transportVariance
                                    ? ` · écart ${
                                        line.transportVariance > 0 ? "-" : "+"
                                      }${Math.abs(line.transportVariance)}`
                                    : ""}
                                </span>
                              </div>
                              <span
                                className={`rank-badge ${
                                  pending
                                    ? "rank-badge-worst"
                                    : "rank-badge-best"
                                }`}
                              >
                                {pending ? "À recevoir" : "Reçu"}
                              </span>
                            </div>
                            {pending ? (
                              <div className="receipt-form">
                                <label>
                                  Qté reçue
                                  <input
                                    type="number"
                                    inputMode="numeric"
                                    min={0}
                                    step={1}
                                    value={qtyStr}
                                    onChange={(e) =>
                                      setReceiveQty((prev) => ({
                                        ...prev,
                                        [line.productId]: e.target.value,
                                      }))
                                    }
                                  />
                                </label>
                                {previewVar !== 0 ? (
                                  <label>
                                    Motif de l’écart
                                    <input
                                      type="text"
                                      value={noteStr}
                                      placeholder="Ex. 2 cassés en route"
                                      onChange={(e) =>
                                        setReceiveNote((prev) => ({
                                          ...prev,
                                          [line.productId]: e.target.value,
                                        }))
                                      }
                                    />
                                  </label>
                                ) : null}
                                <button
                                  type="button"
                                  className="btn btn-primary"
                                  disabled={receiveBusy === line.productId}
                                  onClick={() =>
                                    void confirmReceive(
                                      line.productId,
                                      line.sentFromZogbo,
                                      line.name,
                                    )
                                  }
                                >
                                  {receiveBusy === line.productId
                                    ? "…"
                                    : "Confirmer la réception"}
                                </button>
                              </div>
                            ) : null}
                          </li>
                        );
                      })}
                  </ul>
                  {(day?.receipts ?? []).some((r) => !r.cancelledAt) ? (
                    <div className="receipt-history">
                      <h3 className="panel-title">Historique du jour</h3>
                      <ul className="rank-list">
                        {(day?.receipts ?? [])
                          .filter((r) => !r.cancelledAt)
                          .slice()
                          .reverse()
                          .map((r) => (
                            <li key={r.id} className="rank-row">
                              <div className="rank-body">
                                <div className="rank-meta">
                                  <strong className="rank-name">{r.name}</strong>
                                  <span className="rank-kind">
                                    reçu {r.qty} / envoyé {r.sentFromZogbo}
                                  </span>
                                </div>
                                <div className="rank-stats">
                                  <span className="muted">
                                    {r.actorName ?? "—"}
                                    {r.note ? ` · ${r.note}` : ""}
                                  </span>
                                  <button
                                    type="button"
                                    className="btn-link"
                                    disabled={receiveBusy === r.id}
                                    onClick={() => void cancelReceive(r)}
                                  >
                                    Annuler
                                  </button>
                                </div>
                              </div>
                            </li>
                          ))}
                      </ul>
                    </div>
                  ) : null}
                </aside>
              </div>
            ) : (
              <section className="catalogue-panel">
                <div className="catalogue-toolbar">
                  <StockSearch
                    value={accSearch}
                    onChange={setAccSearch}
                    placeholder="Rechercher un accompagnement…"
                  />
                  <button
                    type="button"
                    className={`btn btn-primary${savedFlash && !dirty ? " btn-saved" : ""}`}
                    onClick={() => void handleSave()}
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
                </div>

                {filteredLocals.length === 0 ? (
                  <div className="catalogue-empty">
                    <p className="catalogue-empty-title">
                      {computed.locals.length === 0
                        ? "Aucun accompagnement dans Paramètres."
                        : "Aucun accompagnement trouvé"}
                    </p>
                    <p className="catalogue-empty-hint">
                      {computed.locals.length === 0
                        ? "Ajoutez des accompagnements au catalogue."
                        : "Modifiez votre recherche."}
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="catalogue-table-wrap stock-zogbo-desktop-table">
                      <table className="catalogue-table">
                        <thead>
                          <tr>
                            <th scope="col">Accompagnement</th>
                            {openingEditable ? (
                              <th scope="col">Stock initial</th>
                            ) : null}
                            <th scope="col">Dispo</th>
                            <th scope="col">Préparé</th>
                            <th scope="col">Vendu</th>
                            <th scope="col">Stock actuel</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pagedLocals.items.map((line) => {
                            const hasVariance =
                              line.variance !== null && line.variance !== 0;
                            return (
                              <tr
                                key={line.productId}
                                className={
                                  hasVariance ? "row-warn" : undefined
                                }
                              >
                                <td>
                                  <div className="catalogue-product-cell">
                                    <ProductIcon
                                      kind="local"
                                      name={line.name}
                                    />
                                    <span>
                                      <span className="catalogue-product-name">
                                        {line.name}
                                      </span>
                                      <span className="cell-sub">
                                        Initial{" "}
                                        {line.counted ?? line.initialStock}
                                        {line.counted !== null
                                          ? " (compté)"
                                          : ""}
                                      </span>
                                      <span className="cell-sub mono">
                                        Catalogue {formatFcfa(line.unitPrice)}
                                      </span>
                                    </span>
                                  </div>
                                </td>
                                {openingEditable ? (
                                  <td>
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
                                <td>
                                  <span className="catalogue-qty-badge">
                                    {line.available}
                                  </span>
                                </td>
                                <td>
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
                                <td>
                                  <span className="catalogue-qty-badge">
                                    {line.sold}
                                  </span>
                                </td>
                                <td>
                                  <QtyInput
                                    value={line.counted}
                                    allowEmpty
                                    placeholder={String(
                                      line.theoreticalRemaining,
                                    )}
                                    ariaLabel={`Stock actuel ${line.name}`}
                                    onChange={(counted) =>
                                      patchLocal(line.productId, { counted })
                                    }
                                  />
                                  {line.counted !== null ? (
                                    <span className="cell-sub muted">
                                      théo. {line.theoreticalRemaining}
                                    </span>
                                  ) : null}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        {filteredLocals.length > 0 ? (
                          <tfoot>
                            <tr>
                              <th scope="row">TOTAL</th>
                              {openingEditable ? <td /> : null}
                              <td />
                              <td>
                                <span className="catalogue-qty-badge">
                                  {computed.totals.localPrepared}
                                </span>
                              </td>
                              <td>
                                <span className="catalogue-qty-badge">
                                  {computed.totals.localSold}
                                </span>
                              </td>
                              <td />
                            </tr>
                          </tfoot>
                        ) : null}
                      </table>
                    </div>

                    <div className="stock-zogbo-mobile-list">
                      {pagedLocals.items.map((line) => (
                        <article
                          key={line.productId}
                          className={`stock-mobile-card${
                            line.variance ? " is-warn" : ""
                          }`}
                        >
                          <div className="stock-mobile-card-head">
                            <ProductIcon
                              kind="local"
                              name={line.name}
                              size="lg"
                            />
                            <span className="catalogue-product-name">
                              {line.name}
                            </span>
                          </div>
                          <div className="stock-mobile-metrics">
                            <div className="stock-mobile-metric">
                              <span className="stock-mobile-metric-label">
                                Dispo
                              </span>
                              <strong>{line.available}</strong>
                            </div>
                            <div className="stock-mobile-metric">
                              <span className="stock-mobile-metric-label">
                                Vendu
                              </span>
                              <strong>{line.sold}</strong>
                            </div>
                            <div className="stock-mobile-metric">
                              <span className="stock-mobile-metric-label">
                                Reste
                              </span>
                              <strong>{line.theoreticalRemaining}</strong>
                            </div>
                          </div>
                          <div className="stock-mobile-card-prices catalogue-mobile-card-prices">
                            {openingEditable ? (
                              <div>
                                <span className="catalogue-mobile-price-label">
                                  Stock initial
                                </span>
                                <QtyInput
                                  value={line.initialStock}
                                  ariaLabel={`Stock initial ${line.name}`}
                                  onChange={(initialStock) =>
                                    patchLocal(line.productId, {
                                      initialStock: initialStock ?? 0,
                                    })
                                  }
                                />
                              </div>
                            ) : null}
                            <div>
                              <span className="catalogue-mobile-price-label">
                                Préparé
                              </span>
                              <QtyInput
                                value={line.prepared}
                                ariaLabel={`Préparé ${line.name}`}
                                onChange={(prepared) =>
                                  patchLocal(line.productId, {
                                    prepared: prepared ?? 0,
                                  })
                                }
                              />
                            </div>
                            <div>
                              <span className="catalogue-mobile-price-label">
                                Comptage
                              </span>
                              <QtyInput
                                value={line.counted}
                                allowEmpty
                                placeholder={String(
                                  line.theoreticalRemaining,
                                )}
                                ariaLabel={`Stock actuel ${line.name}`}
                                onChange={(counted) =>
                                  patchLocal(line.productId, { counted })
                                }
                              />
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>

                    <CataloguePaginationBar
                      from={pagedLocals.from}
                      to={pagedLocals.to}
                      total={pagedLocals.total}
                      page={pagedLocals.page}
                      totalPages={pagedLocals.totalPages}
                      onPage={setAccPage}
                    />
                  </>
                )}
              </section>
            )}
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
