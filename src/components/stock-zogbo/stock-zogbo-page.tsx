"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ContextBar } from "@/components/context-bar";
import { ProductIcon } from "@/components/product-icon";
import { QtyInput } from "@/components/qty-input";
import { ZoneBoissonsPanel } from "@/components/zone/zone-boissons-panel";
import {
  CataloguePaginationBar,
  CatalogueSkeleton,
} from "@/components/parametres/catalogue-view";
import { QrScanner } from "@/components/stock-zogbo/qr-scanner";
import { ParametresEditor } from "@/components/parametres/parametres-editor";
import { useSession } from "@/components/session-provider";
import "@/components/parametres/parametres-catalogue.css";
import { formatStickerCode, parseQrIdFromScan } from "@/lib/parse-qr-id";
import { canWriteStock } from "@/lib/auth-types";
import type { GbegameyLocalLine, LocalDish, VenteSite } from "@/lib/types";
import type {
  PlatUnitStats,
  StockUnit,
  StockUnitKind,
  StockZogboPayload,
} from "@/lib/stock-unit-types";
import { STOCK_UNIT_STATUS_LABELS } from "@/lib/stock-unit-types";
import { downloadQrSheet } from "@/lib/download-qr-sheet";
import { computeLocalLine } from "@/lib/gbegamey-calc";
import { formatDisplayDate, todayIsoDate } from "@/lib/zogbo-calc";

type TabKey = "plats" | "acc" | "boissons" | "parametres";

const PAGE_SIZE = 6;

function parseTab(raw: string | null): TabKey {
  if (raw === "acc" || raw === "boissons" || raw === "parametres") return raw;
  return "plats";
}

function sumPlats(plats: PlatUnitStats[], key: keyof PlatUnitStats): number {
  return plats.reduce((s, p) => s + (Number(p[key]) || 0), 0);
}

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

function QrQtyControls({
  productId,
  productName,
  kind,
  draftQr,
  onDraft,
  busy,
  onGenerate,
}: {
  productId: string;
  productName: string;
  kind: StockUnitKind;
  draftQr: Record<string, string>;
  onDraft: (key: string, value: string) => void;
  busy: string | null;
  onGenerate: (
    productId: string,
    productName: string,
    kind: StockUnitKind,
  ) => void;
}) {
  const draftKey = kind === "plat" ? productId : `${kind}:${productId}`;
  const busyKey = `qr-${kind}-${productId}`;
  return (
    <div className="catalogue-inline-qr">
      <input
        type="number"
        min={1}
        className="input input-qty"
        placeholder="Qté"
        aria-label={`Quantité de QR — ${productName}`}
        value={draftQr[draftKey] ?? ""}
        onChange={(e) => onDraft(draftKey, e.target.value)}
      />
      <button
        type="button"
        className="btn btn-sm btn-primary"
        disabled={busy === busyKey}
        onClick={() => onGenerate(productId, productName, kind)}
      >
        {busy === busyKey ? "…" : "PDF"}
      </button>
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

export function StockZogboPage({
  site = "zogbo",
}: {
  site?: VenteSite;
}) {
  const isGbegamey = site === "gbegamey";
  const apiBase = isGbegamey ? "/api/stock-gbegamey" : "/api/stock-zogbo";
  const scanWorkflow = isGbegamey ? "gbegamey-receive" : "zogbo-send";
  const siteTitle = isGbegamey ? "Stock Gbégamey" : "Stock Zogbo";
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user } = useSession();
  const readOnly = Boolean(user && !canWriteStock(user.role));
  const requestedTab = parseTab(searchParams.get("tab"));
  const tab =
    readOnly && requestedTab === "parametres" ? "plats" : requestedTab;
  const dateFromUrl = searchParams.get("date");
  const [date, setDate] = useState(() => {
    if (dateFromUrl && /^\d{4}-\d{2}-\d{2}$/.test(dateFromUrl)) return dateFromUrl;
    return todayIsoDate();
  });
  const [payload, setPayload] = useState<StockZogboPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [draftQr, setDraftQr] = useState<Record<string, string>>({});
  const [scanInput, setScanInput] = useState("");
  const [scanResult, setScanResult] = useState<{
    qrId: string;
    productName: string;
    status: string;
    message: string | null;
    canSend: boolean;
  } | null>(null);
  const [selectedQr, setSelectedQr] = useState<Set<string>>(new Set());
  const [expandedProductId, setExpandedProductId] = useState<string | null>(
    null,
  );
  const [expandedUnits, setExpandedUnits] = useState<StockUnit[]>([]);
  const [accLines, setAccLines] = useState<GbegameyLocalLine[]>([]);
  const [accDirty, setAccDirty] = useState(false);
  const [localDishes, setLocalDishes] = useState<LocalDish[]>([]);
  const [cameraOn, setCameraOn] = useState(false);
  const [platSearch, setPlatSearch] = useState("");
  const [platPage, setPlatPage] = useState(1);
  const [accSearch, setAccSearch] = useState("");
  const [accPage, setAccPage] = useState(1);

  const debouncedPlatSearch = useDebouncedValue(platSearch);
  const debouncedAccSearch = useDebouncedValue(accSearch);

  const plats = payload?.plats ?? [];
  const accStats = payload?.accStats ?? [];

  const totals = useMemo(
    () => ({
      prepared: sumPlats(plats, "prepared"),
      qrGenerated: sumPlats(plats, "qrGenerated"),
      qrSent: sumPlats(plats, "qrSent"),
      remaining: sumPlats(plats, "qrRemainingZogbo"),
      sold: sumPlats(plats, "soldAggregate"),
    }),
    [plats],
  );

  function setTab(next: TabKey) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "plats") params.delete("tab");
    else params.set("tab", next);
    const q = params.toString();
    const path = isGbegamey ? "/stock-gbegamey" : "/stock-zogbo";
    router.replace(q ? `${path}?${q}` : path);
  }

  const load = useCallback(async (nextDate = date) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/${isGbegamey ? "stock-gbegamey" : "stock-zogbo"}?date=${encodeURIComponent(nextDate)}`,
        { cache: "no-store" },
      );
      const body = (await res.json()) as StockZogboPayload & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Chargement impossible.");
      setPayload(body);
      setAccLines(body.accompanimentLines ?? []);
      setLocalDishes(body.localDishes ?? []);
      setAccDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur réseau.");
    } finally {
      setLoading(false);
    }
  }, [date, apiBase]);

  useEffect(() => {
    if (tab === "parametres") return;
    void load(date);
  }, [date, load, tab]);

  async function postAction(
    action: string,
    data: Record<string, unknown>,
  ): Promise<StockZogboPayload | null> {
    const res = await fetch(apiBase, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, action, ...data }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? "Opération refusée.");
    const next = body.payload as StockZogboPayload;
    if (next) {
      setPayload(next);
      setAccLines(next.accompanimentLines ?? []);
    }
    return next;
  }

  async function handleGenerateQr(
    productId: string,
    productName: string,
    kind: StockUnitKind = "plat",
  ) {
    if (readOnly) return;
    const draftKey = kind === "plat" ? productId : `${kind}:${productId}`;
    const qty = Math.round(Number(draftQr[draftKey]) || 0);
    if (qty <= 0) return;
    setBusy(`qr-${kind}-${productId}`);
    setError(null);
    try {
      const res = await fetch(apiBase, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          action: "generate-qr",
          productId,
          qty,
          kind,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Opération refusée.");
      if (body.payload) {
        setPayload(body.payload as StockZogboPayload);
        setAccLines(body.payload.accompanimentLines ?? []);
      }
      const units = (body.units ?? []) as StockUnit[];
      if (!units.length) {
        throw new Error("Aucun QR généré.");
      }
      await downloadQrSheet({
        qrIds: units.map((u) => u.qrId),
        productName,
        date,
      });
      setDraftQr((d) => ({ ...d, [draftKey]: "" }));
      if (expandedProductId === productId) {
        await loadUnits(productId, false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur génération QR.");
    } finally {
      setBusy(null);
    }
  }

  async function handleSendSelected() {
    if (readOnly || !selectedQr.size) return;
    setBusy("send");
    setError(null);
    try {
      const res = await fetch(apiBase, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          action: "send",
          qrIds: [...selectedQr],
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Envoi refusé.");
      setPayload(body.payload);
      setSelectedQr(new Set());
      if (expandedProductId) {
        await loadUnits(expandedProductId, false);
      }
      if (body.skipped?.length) {
        setError(
          `${body.sent?.length ?? 0} envoyé(s), ${body.skipped.length} ignoré(s).`,
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur envoi.");
    } finally {
      setBusy(null);
    }
  }

  async function lookupQr(raw: string) {
    if (readOnly) return;
    const id = parseQrIdFromScan(raw);
    if (!id) {
      setError("Identifiant QR invalide.");
      return;
    }
    setBusy("scan");
    setError(null);
    try {
      const res = await fetch(
        `/api/stock-units?qrId=${encodeURIComponent(id)}&date=${encodeURIComponent(date)}&workflow=${encodeURIComponent(scanWorkflow)}`,
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "QR introuvable.");
      setScanResult({
        qrId: body.unit.qrId,
        productName: body.unit.productName,
        status:
          STOCK_UNIT_STATUS_LABELS[
            body.unit.status as keyof typeof STOCK_UNIT_STATUS_LABELS
          ] ?? body.unit.status,
        message: body.message,
        canSend: body.allowedActions?.includes("send") ?? false,
      });
      if (body.allowedActions?.includes("send")) {
        setSelectedQr((prev) => new Set([...prev, body.unit.qrId]));
      }
    } catch (e) {
      setScanResult(null);
      setError(e instanceof Error ? e.message : "Scan invalide.");
    } finally {
      setBusy(null);
      setScanInput("");
    }
  }

  async function loadUnits(productId: string, toggle = true) {
    if (toggle && expandedProductId === productId) {
      setExpandedProductId(null);
      setExpandedUnits([]);
      return;
    }
    setBusy(`units-${productId}`);
    setExpandedProductId(productId);
    try {
      const res = await fetch(
        `${apiBase}?date=${encodeURIComponent(date)}&units=1&productId=${encodeURIComponent(productId)}`,
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setExpandedUnits(body.units ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible de charger les unités.");
      setExpandedProductId(null);
      setExpandedUnits([]);
    } finally {
      setBusy(null);
    }
  }

  const handleQrDetected = useCallback(
    (qrId: string) => {
      void lookupQr(qrId);
    },
    // lookupQr dépend de date — recréé à chaque rendu ; acceptable pour le scan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [date, scanWorkflow],
  );

  async function saveAcc() {
    if (readOnly) return;
    setBusy("acc");
    setError(null);
    try {
      const res = await fetch(apiBase, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, accompanimentLines: accLines }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setPayload(body.payload);
      setAccDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur enregistrement.");
    } finally {
      setBusy(null);
    }
  }

  const accComputed = useMemo(() => {
    const priceById = new Map(localDishes.map((d) => [d.id, d.unitPrice]));
    return accLines.map((l) =>
      computeLocalLine(l, priceById.get(l.productId) ?? 0),
    );
  }, [accLines, localDishes]);

  const filteredPlats = useMemo(
    () =>
      plats.filter((p) => matchesSearch(p.productName, debouncedPlatSearch)),
    [plats, debouncedPlatSearch],
  );

  const pagedPlats = useMemo(
    () => paginate(filteredPlats, platPage, PAGE_SIZE),
    [filteredPlats, platPage],
  );

  const filteredAcc = useMemo(
    () => accComputed.filter((r) => matchesSearch(r.name, debouncedAccSearch)),
    [accComputed, debouncedAccSearch],
  );

  const pagedAcc = useMemo(
    () => paginate(filteredAcc, accPage, PAGE_SIZE),
    [filteredAcc, accPage],
  );

  const accQrByProduct = useMemo(
    () => new Map(accStats.map((s) => [s.productId, s])),
    [accStats],
  );

  const patchDraftQr = (key: string, value: string) => {
    setDraftQr((d) => ({ ...d, [key]: value }));
  };

  useEffect(() => {
    setPlatPage(1);
  }, [debouncedPlatSearch]);

  useEffect(() => {
    setAccPage(1);
  }, [debouncedAccSearch]);

  function patchAcc(productId: string, patch: Partial<GbegameyLocalLine>) {
    setAccLines((lines) =>
      lines.map((l) => (l.productId === productId ? { ...l, ...patch } : l)),
    );
    setAccDirty(true);
  }

  function toggleSelect(qrId: string) {
    setSelectedQr((prev) => {
      const next = new Set(prev);
      if (next.has(qrId)) next.delete(qrId);
      else next.add(qrId);
      return next;
    });
  }

  return (
    <AppShell
      title={tab === "parametres" ? "Catalogue & paramètres" : siteTitle}
      subtitle={
        tab === "parametres"
          ? "Gérez vos produits, matières et recettes."
          : readOnly
            ? "Consultation du stock — aucune saisie."
            : "Saisie du stock — plats tracés par QR, accompagnements et boissons."
      }
      mainClassName={
        tab === "parametres" ? "main-catalogue" : "main-stock-zogbo"
      }
    >
      <div className="stock-zogbo-page catalogue-view">
        {tab !== "parametres" ? (
          <ContextBar
            date={date}
            onDateChange={setDate}
            siteLabel={isGbegamey ? "Gbégamey" : "Zogbo"}
          />
        ) : null}

        <div
          className="section-tabs catalogue-stock-tabs"
          role="tablist"
          aria-label={`Sections ${siteTitle}`}
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === "plats"}
            className={`section-tab${tab === "plats" ? " is-active" : ""}`}
            onClick={() => setTab("plats")}
          >
            Plats
            <span className="section-count">{plats.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "acc"}
            className={`section-tab${tab === "acc" ? " is-active" : ""}`}
            onClick={() => setTab("acc")}
          >
            Accompagnements
            <span className="section-count">{accLines.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "boissons"}
            className={`section-tab${tab === "boissons" ? " is-active" : ""}`}
            onClick={() => setTab("boissons")}
          >
            Boissons
          </button>
          {readOnly ? null : (
            <button
              type="button"
              role="tab"
              aria-selected={tab === "parametres"}
              className={`section-tab${tab === "parametres" ? " is-active" : ""}`}
              onClick={() => setTab("parametres")}
            >
              Catalogue
            </button>
          )}
        </div>

        {error && tab !== "parametres" ? (
          <StockErrorBanner message={error} onRetry={() => void load(date)} />
        ) : null}

        {readOnly && tab !== "parametres" ? (
          <div className="catalogue-info" role="note">
            <span className="catalogue-info-mark" aria-hidden>
              i
            </span>
            <p>
              Consultation uniquement — vous ne pouvez ni saisir, ni générer de
              QR, ni scanner.
            </p>
          </div>
        ) : null}

        {tab === "parametres" ? (
          <ParametresEditor mode="catalogue" />
        ) : loading ? (
          <CatalogueSkeleton />
        ) : tab === "plats" ? (
          <>
            <div className="catalogue-kpi-grid" aria-label="Totaux du jour">
              <div className="catalogue-kpi">
                <span className="catalogue-kpi-label">Préparé</span>
                <strong className="catalogue-kpi-value">{totals.prepared}</strong>
              </div>
              <div className="catalogue-kpi">
                <span className="catalogue-kpi-label">QR générés</span>
                <strong className="catalogue-kpi-value">{totals.qrGenerated}</strong>
              </div>
              <div className="catalogue-kpi">
                <span className="catalogue-kpi-label">
                  {isGbegamey ? "Reçu Zogbo" : "Envoyé Gbé"}
                </span>
                <strong className="catalogue-kpi-value">{totals.qrSent}</strong>
              </div>
              <div className="catalogue-kpi catalogue-kpi-accent">
                <span className="catalogue-kpi-label">
                  {isGbegamey ? "Reste Gbégamey" : "Reste Zogbo"}
                </span>
                <strong className="catalogue-kpi-value">{totals.remaining}</strong>
              </div>
              <div className="catalogue-kpi">
                <span className="catalogue-kpi-label">Vendu</span>
                <strong className="catalogue-kpi-value">{totals.sold}</strong>
              </div>
            </div>

            <p className="catalogue-meta">
              <span className="catalogue-meta-icon" aria-hidden>
                📅
              </span>
              <strong>{formatDisplayDate(date)}</strong>
              {" · "}
              {isGbegamey
                ? "Générez les QR sur place, recevez les plats de Zogbo par scan, puis vendez-les à la caisse."
                : "Préparez et générez les QR, puis envoyez vers Gbégamey."}
            </p>

            <div className="catalogue-info" role="note">
              <span className="catalogue-info-mark" aria-hidden>
                i
              </span>
              <p>
                {readOnly
                  ? "Les plats du jour, les QR générés et les ventes s’affichent ici."
                  : "Indiquez une quantité : les QR et le code collé sont générés en PDF à imprimer. Le compteur « Préparé » est mis à jour automatiquement."}
              </p>
            </div>

            <div
              className={`stock-zogbo-layout-premium${readOnly ? " is-readonly" : ""}`}
            >
              <section className="catalogue-panel stock-zogbo-main">
                <div className="catalogue-toolbar">
                  <StockSearch
                    value={platSearch}
                    onChange={setPlatSearch}
                    placeholder="Rechercher un plat…"
                  />
                </div>

                {filteredPlats.length === 0 ? (
                  <div className="catalogue-empty">
                    <p className="catalogue-empty-title">Aucun plat trouvé</p>
                    <p className="catalogue-empty-hint">
                      Modifiez votre recherche.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="catalogue-table-wrap stock-zogbo-desktop-table">
                      <table className="catalogue-table stock-zogbo-table">
                    <thead>
                      <tr>
                        <th scope="col">Plat</th>
                        <th scope="col" className="col-qty">
                          Préparé
                        </th>
                        <th scope="col" className="col-qty">
                          QR
                        </th>
                        <th scope="col" className="col-qty">
                          {isGbegamey ? "Reçu" : "Envoyé"}
                        </th>
                        <th scope="col" className="col-qty">
                          Reste
                        </th>
                        <th scope="col" className="col-qty">
                          Vendu
                        </th>
                        {readOnly ? null : (
                          <th scope="col" className="col-action">
                            Générer QR
                          </th>
                        )}
                        <th scope="col" className="col-actions">
                          <span className="sr-only">Détail</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedPlats.items.map((row) => {
                        const expanded = expandedProductId === row.productId;
                        return (
                          <Fragment key={row.productId}>
                            <tr
                              className={expanded ? "is-expanded" : undefined}
                            >
                              <td>
                                <div className="catalogue-product-cell">
                                  <ProductIcon
                                    kind="plat"
                                    name={row.productName}
                                  />
                                  <span className="catalogue-product-name">
                                    {row.productName}
                                  </span>
                                </div>
                              </td>
                              <td>
                                <span className="catalogue-qty-badge">
                                  {row.prepared}
                                </span>
                              </td>
                              <td>
                                <span className="catalogue-qty-badge">
                                  {row.qrGenerated}
                                  {row.qrToGenerate > 0 ? (
                                    <span className="stock-zogbo-pending">
                                      +{row.qrToGenerate}
                                    </span>
                                  ) : null}
                                </span>
                              </td>
                              <td>
                                <span className="catalogue-qty-badge">
                                  {row.qrSent}
                                </span>
                              </td>
                              <td>
                                <span className="catalogue-qty-badge catalogue-qty-badge-accent">
                                  {row.qrRemainingZogbo}
                                </span>
                              </td>
                              <td>
                                <span className="catalogue-qty-badge">
                                  {row.soldAggregate}
                                </span>
                              </td>
                              {readOnly ? null : (
                                <td className="col-action">
                                  <div className="catalogue-inline-qr">
                                    <input
                                      type="number"
                                      min={1}
                                      className="input input-qty"
                                      placeholder="Qté"
                                      aria-label={`Quantité de QR — ${row.productName}`}
                                      value={draftQr[row.productId] ?? ""}
                                      onChange={(e) =>
                                        setDraftQr((d) => ({
                                          ...d,
                                          [row.productId]: e.target.value,
                                        }))
                                      }
                                    />
                                    <button
                                      type="button"
                                      className="btn btn-sm btn-primary"
                                      disabled={busy === `qr-plat-${row.productId}`}
                                      onClick={() =>
                                        void handleGenerateQr(
                                          row.productId,
                                          row.productName,
                                          "plat",
                                        )
                                      }
                                    >
                                      {busy === `qr-plat-${row.productId}`
                                        ? "…"
                                        : "PDF"}
                                    </button>
                                  </div>
                                </td>
                              )}
                              <td className="col-actions">
                                <button
                                  type="button"
                                  className={`btn btn-sm btn-ghost${expanded ? " is-active" : ""}`}
                                  aria-expanded={expanded}
                                  onClick={() => void loadUnits(row.productId)}
                                >
                                  {expanded ? "Masquer" : "Unités"}
                                </button>
                              </td>
                            </tr>
                            {expanded ? (
                              <tr
                                key={`${row.productId}-units`}
                                className="stock-zogbo-units-row"
                              >
                                <td colSpan={readOnly ? 7 : 8}>
                                  <UnitsBlock
                                    units={expandedUnits}
                                    selectedQr={selectedQr}
                                    onToggleSelect={toggleSelect}
                                    loading={busy === `units-${row.productId}`}
                                    selectableSite={site}
                                    readOnly={readOnly}
                                  />
                                </td>
                              </tr>
                            ) : null}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                    <div className="stock-zogbo-mobile-list">
                      {pagedPlats.items.map((row) => {
                        const expanded = expandedProductId === row.productId;
                        return (
                          <article key={row.productId} className="stock-mobile-card">
                            <div className="stock-mobile-card-head">
                              <ProductIcon
                                kind="plat"
                                name={row.productName}
                                size="lg"
                              />
                              <span className="catalogue-product-name">
                                {row.productName}
                              </span>
                            </div>
                            <div className="stock-mobile-metrics">
                              <div className="stock-mobile-metric">
                                <span className="stock-mobile-metric-label">
                                  Préparé
                                </span>
                                <strong>{row.prepared}</strong>
                              </div>
                              <div className="stock-mobile-metric">
                                <span className="stock-mobile-metric-label">
                                  Reste
                                </span>
                                <strong>{row.qrRemainingZogbo}</strong>
                              </div>
                              <div className="stock-mobile-metric">
                                <span className="stock-mobile-metric-label">
                                  Vendu
                                </span>
                                <strong>{row.soldAggregate}</strong>
                              </div>
                            </div>
                            <div className="stock-mobile-actions">
                              {readOnly ? null : (
                                <>
                                  <input
                                    type="number"
                                    min={1}
                                    className="input input-qty"
                                    placeholder="Qté QR"
                                    aria-label={`Quantité QR ${row.productName}`}
                                    value={draftQr[row.productId] ?? ""}
                                    onChange={(e) =>
                                      setDraftQr((d) => ({
                                        ...d,
                                        [row.productId]: e.target.value,
                                      }))
                                    }
                                  />
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-primary"
                                    disabled={busy === `qr-plat-${row.productId}`}
                                    onClick={() =>
                                      void handleGenerateQr(
                                        row.productId,
                                        row.productName,
                                        "plat",
                                      )
                                    }
                                  >
                                    {busy === `qr-plat-${row.productId}`
                                      ? "…"
                                      : "PDF"}
                                  </button>
                                </>
                              )}
                              <button
                                type="button"
                                className={`btn btn-sm btn-ghost${expanded ? " is-active" : ""}`}
                                onClick={() => void loadUnits(row.productId)}
                              >
                                {expanded ? "−" : "Unités"}
                              </button>
                            </div>
                            {expanded ? (
                              <UnitsBlock
                                units={expandedUnits}
                                selectedQr={selectedQr}
                                onToggleSelect={toggleSelect}
                                loading={busy === `units-${row.productId}`}
                                selectableSite={site}
                                readOnly={readOnly}
                              />
                            ) : null}
                          </article>
                        );
                      })}
                    </div>

                    <CataloguePaginationBar
                      from={pagedPlats.from}
                      to={pagedPlats.to}
                      total={pagedPlats.total}
                      page={pagedPlats.page}
                      totalPages={pagedPlats.totalPages}
                      onPage={setPlatPage}
                    />
                  </>
                )}
              </section>

              {readOnly ? null : (
              <aside className="catalogue-panel stock-aside-premium">
                <h2 className="panel-title">
                  {isGbegamey ? "Réception Zogbo" : "Envoi Gbégamey"}
                </h2>
                <p className="section-hint">
                  {isGbegamey
                    ? "Scannez ou saisissez un QR préparé à Zogbo pour le recevoir ici."
                    : "Scannez ou saisissez un QR pour l'ajouter au lot d'envoi."}
                </p>

                <span className="stock-zogbo-field-label">Identifiant QR</span>
                <div className="stock-zogbo-scan-row">
                  <input
                    id="stock-zogbo-scan"
                    type="text"
                    className="input"
                    placeholder="KF-…"
                    value={scanInput}
                    onChange={(e) => setScanInput(e.target.value)}
                    onKeyDown={(e) =>
                      e.key === "Enter" && void lookupQr(scanInput)
                    }
                  />
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy === "scan"}
                    onClick={() => void lookupQr(scanInput)}
                  >
                    OK
                  </button>
                </div>

                <button
                  type="button"
                  className={`btn btn-block${cameraOn ? " is-active" : ""}`}
                  onClick={() => setCameraOn((v) => !v)}
                >
                  {cameraOn ? "Arrêter la caméra" : "Scanner avec la caméra"}
                </button>

                <QrScanner active={cameraOn} onDetected={handleQrDetected} />

                {scanResult ? (
                  <div
                    className={`scan-result${scanResult.canSend ? " scan-result-ok" : " scan-result-warn"}`}
                  >
                    <strong>{scanResult.productName}</strong>
                    <span className="mono">{scanResult.qrId}</span>
                    <span className="badge">{scanResult.status}</span>
                    {scanResult.message ? (
                      <p className="scan-result-msg">{scanResult.message}</p>
                    ) : null}
                  </div>
                ) : null}

                <div className="stock-zogbo-send-queue">
                  <div className="stock-zogbo-send-head">
                    <span className="stock-zogbo-send-title">
                      {isGbegamey ? "Lot de réception" : "Lot d'envoi"}
                    </span>
                    <span className="section-count">{selectedQr.size}</span>
                  </div>
                  {selectedQr.size === 0 ? (
                    <p className="section-hint">
                      Aucune unité sélectionnée. Cochez des unités ou scannez des QR.
                    </p>
                  ) : (
                    <ul className="stock-zogbo-send-list">
                      {[...selectedQr].map((id) => (
                        <li key={id}>
                          <span className="mono">{id}</span>
                          <button
                            type="button"
                            className="btn-icon"
                            aria-label={`Retirer ${id}`}
                            onClick={() => toggleSelect(id)}
                          >
                            ×
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <button
                    type="button"
                    className="btn btn-primary btn-block"
                    disabled={selectedQr.size === 0 || busy === "send"}
                    onClick={() => void handleSendSelected()}
                  >
                    {isGbegamey
                      ? `Recevoir ${selectedQr.size > 0 ? selectedQr.size : ""} depuis Zogbo`
                      : `Envoyer ${selectedQr.size > 0 ? selectedQr.size : ""} vers Gbégamey`}
                  </button>
                </div>
              </aside>
              )}
            </div>
          </>
        ) : tab === "acc" ? (
          <>
            <p className="catalogue-meta">
              <span className="catalogue-meta-icon" aria-hidden>
                📅
              </span>
              <strong>{formatDisplayDate(date)}</strong>
              {" · "}
              Stock local {isGbegamey ? "Gbégamey" : "Zogbo"}
              {isGbegamey
                ? " — plats reçus ou préparés sur place."
                : " — pas de transfert vers Gbégamey."}
            </p>

            <div className="catalogue-info" role="note">
              <span className="catalogue-info-mark" aria-hidden>
                i
              </span>
              <p>
                {readOnly
                  ? "Stock des accompagnements — consultation uniquement."
                  : "Saisissez le préparé et le comptage (stock initial du jour). Les ventes sont mises à jour par la caisse."}
              </p>
            </div>

            <section className="catalogue-panel">
              <div className="catalogue-toolbar">
                <StockSearch
                  value={accSearch}
                  onChange={setAccSearch}
                  placeholder="Rechercher un accompagnement…"
                />
                {readOnly ? null : (
                  <button
                    type="button"
                    className={`btn btn-primary${!accDirty ? " btn-saved" : ""}`}
                    disabled={!accDirty || busy === "acc"}
                    onClick={() => void saveAcc()}
                  >
                    {busy === "acc" ? "Enregistrement…" : "Enregistrer"}
                  </button>
                )}
              </div>

              {filteredAcc.length === 0 ? (
                <div className="catalogue-empty">
                  <p className="catalogue-empty-title">
                    Aucun accompagnement trouvé
                  </p>
                  <p className="catalogue-empty-hint">
                    Modifiez votre recherche.
                  </p>
                </div>
              ) : (
                <>
                  <div className="catalogue-table-wrap stock-zogbo-desktop-table">
                    <table className="catalogue-table">
                      <thead>
                        <tr>
                          <th scope="col">Accompagnement</th>
                          <th scope="col">Dispo</th>
                          <th scope="col">Préparé</th>
                          <th scope="col">Comptage</th>
                          <th scope="col">Vendu</th>
                          <th scope="col">Reste</th>
                          <th scope="col">QR</th>
                          {readOnly ? null : (
                            <th scope="col" className="col-action">
                              Générer QR
                            </th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {pagedAcc.items.map((row) => (
                          <tr key={row.productId}>
                            <td>
                              <div className="catalogue-product-cell">
                                <ProductIcon kind="local" name={row.name} />
                                <span className="catalogue-product-name">
                                  {row.name}
                                </span>
                              </div>
                            </td>
                            <td>
                              <span className="catalogue-qty-badge">
                                {row.available}
                              </span>
                            </td>
                            <td>
                              {readOnly ? (
                                <span className="catalogue-qty-badge">
                                  {row.prepared}
                                </span>
                              ) : (
                                <QtyInput
                                  value={row.prepared}
                                  ariaLabel={`Préparé ${row.name}`}
                                  onChange={(prepared) =>
                                    patchAcc(row.productId, {
                                      prepared: prepared ?? 0,
                                    })
                                  }
                                />
                              )}
                            </td>
                            <td>
                              {readOnly ? (
                                <span className="catalogue-qty-badge">
                                  {row.counted ?? "—"}
                                </span>
                              ) : (
                                <QtyInput
                                  value={row.counted}
                                  allowEmpty
                                  ariaLabel={`Comptage ${row.name}`}
                                  onChange={(counted) =>
                                    patchAcc(row.productId, { counted })
                                  }
                                />
                              )}
                            </td>
                            <td>
                              <span className="catalogue-qty-badge">
                                {row.sold}
                              </span>
                            </td>
                            <td>
                              <span className="catalogue-qty-badge catalogue-qty-badge-accent">
                                {row.theoreticalRemaining}
                              </span>
                            </td>
                            <td>
                              <span className="catalogue-qty-badge">
                                {accQrByProduct.get(row.productId)?.qrGenerated ?? 0}
                              </span>
                            </td>
                            {readOnly ? null : (
                              <td className="col-action">
                                <QrQtyControls
                                  productId={row.productId}
                                  productName={row.name}
                                  kind="local"
                                  draftQr={draftQr}
                                  onDraft={patchDraftQr}
                                  busy={busy}
                                  onGenerate={(id, name, kind) =>
                                    void handleGenerateQr(id, name, kind)
                                  }
                                />
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="stock-zogbo-mobile-list">
                    {pagedAcc.items.map((row) => (
                      <article
                        key={row.productId}
                        className="stock-mobile-card"
                      >
                        <div className="stock-mobile-card-head">
                          <ProductIcon kind="local" name={row.name} size="lg" />
                          <span className="catalogue-product-name">
                            {row.name}
                          </span>
                        </div>
                        <div className="stock-mobile-metrics">
                          <div className="stock-mobile-metric">
                            <span className="stock-mobile-metric-label">
                              Dispo
                            </span>
                            <strong>{row.available}</strong>
                          </div>
                          <div className="stock-mobile-metric">
                            <span className="stock-mobile-metric-label">
                              Vendu
                            </span>
                            <strong>{row.sold}</strong>
                          </div>
                          <div className="stock-mobile-metric">
                            <span className="stock-mobile-metric-label">
                              Reste
                            </span>
                            <strong>{row.theoreticalRemaining}</strong>
                          </div>
                        </div>
                        <div className="stock-mobile-card-prices catalogue-mobile-card-prices">
                          <div>
                            <span className="catalogue-mobile-price-label">
                              Préparé
                            </span>
                            {readOnly ? (
                              <strong>{row.prepared}</strong>
                            ) : (
                              <QtyInput
                                value={row.prepared}
                                ariaLabel={`Préparé ${row.name}`}
                                onChange={(prepared) =>
                                  patchAcc(row.productId, {
                                    prepared: prepared ?? 0,
                                  })
                                }
                              />
                            )}
                          </div>
                          <div>
                            <span className="catalogue-mobile-price-label">
                              Comptage
                            </span>
                            {readOnly ? (
                              <strong>{row.counted ?? "—"}</strong>
                            ) : (
                              <QtyInput
                                value={row.counted}
                                allowEmpty
                                ariaLabel={`Comptage ${row.name}`}
                                onChange={(counted) =>
                                  patchAcc(row.productId, { counted })
                                }
                              />
                            )}
                          </div>
                        </div>
                        {readOnly ? null : (
                          <div className="stock-mobile-actions">
                            <QrQtyControls
                              productId={row.productId}
                              productName={row.name}
                              kind="local"
                              draftQr={draftQr}
                              onDraft={patchDraftQr}
                              busy={busy}
                              onGenerate={(id, name, kind) =>
                                void handleGenerateQr(id, name, kind)
                              }
                            />
                          </div>
                        )}
                      </article>
                    ))}
                  </div>

                  <CataloguePaginationBar
                    from={pagedAcc.from}
                    to={pagedAcc.to}
                    total={pagedAcc.total}
                    page={pagedAcc.page}
                    totalPages={pagedAcc.totalPages}
                    onPage={setAccPage}
                  />
                </>
              )}
            </section>
          </>
        ) : (
          <ZoneBoissonsPanel
            date={date}
            site={site}
            premium
            readOnly={readOnly}
          />
        )}
      </div>
    </AppShell>
  );
}

function UnitsBlock({
  units,
  selectedQr,
  onToggleSelect,
  loading,
  selectableSite = "zogbo",
  readOnly = false,
}: {
  units: StockUnit[];
  selectedQr: Set<string>;
  onToggleSelect: (qrId: string) => void;
  loading: boolean;
  selectableSite?: VenteSite;
  readOnly?: boolean;
}) {
  if (loading) {
    return <p className="section-hint">Chargement des unités…</p>;
  }
  if (!units.length) {
    return <p className="section-hint">Aucune unité QR pour ce plat aujourd&apos;hui.</p>;
  }

  return (
    <div className="catalogue-units-block">
      <p className="stock-zogbo-units-title">
        {readOnly
          ? `${units.length} unité(s)`
          : `${units.length} unité(s) — cochez pour ${selectableSite === "gbegamey" ? "la réception" : "l'envoi"}`}
      </p>
      <ul className="catalogue-units-grid">
        {units.map((u) => {
          const selectable =
            !readOnly && u.status === "prepare" && u.site === "zogbo";
          return (
            <li
              key={u.qrId}
              className={`catalogue-unit-card${selectedQr.has(u.qrId) ? " is-selected" : ""}`}
            >
              <label className="stock-zogbo-unit-check">
                {readOnly ? null : (
                  <input
                    type="checkbox"
                    checked={selectedQr.has(u.qrId)}
                    disabled={!selectable}
                    onChange={() => onToggleSelect(u.qrId)}
                  />
                )}
                <span className="mono">
                  {formatStickerCode(u.stickerCode || u.qrId)}
                </span>
              </label>
              <span className="badge">{STOCK_UNIT_STATUS_LABELS[u.status]}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
