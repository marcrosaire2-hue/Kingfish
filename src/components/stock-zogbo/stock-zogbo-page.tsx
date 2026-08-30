"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ContextBar } from "@/components/context-bar";
import { ProductIcon } from "@/components/product-icon";
import { QtyInput } from "@/components/qty-input";
import { ZoneBoissonsPanel } from "@/components/zone/zone-boissons-panel";
import { BrandLoader } from "@/components/brand-loader";
import { QrScanner } from "@/components/stock-zogbo/qr-scanner";
import { ParametresEditor } from "@/components/parametres/parametres-editor";
import { parseQrIdFromScan } from "@/lib/parse-qr-id";
import type { GbegameyLocalLine, LocalDish } from "@/lib/types";
import type {
  PlatUnitStats,
  StockUnit,
  StockZogboPayload,
} from "@/lib/stock-unit-types";
import { STOCK_UNIT_STATUS_LABELS } from "@/lib/stock-unit-types";
import { qrSheetFilename } from "@/lib/qr-print-sheet";
import { computeLocalLine } from "@/lib/gbegamey-calc";
import { formatDisplayDate, todayIsoDate } from "@/lib/zogbo-calc";

type TabKey = "plats" | "acc" | "boissons" | "parametres";

function parseTab(raw: string | null): TabKey {
  if (raw === "acc" || raw === "boissons" || raw === "parametres") return raw;
  return "plats";
}

function sumPlats(plats: PlatUnitStats[], key: keyof PlatUnitStats): number {
  return plats.reduce((s, p) => s + (Number(p[key]) || 0), 0);
}

export function StockZogboPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tab = parseTab(searchParams.get("tab"));
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

  const plats = payload?.plats ?? [];

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
    router.replace(q ? `/stock-zogbo?${q}` : "/stock-zogbo");
  }

  const load = useCallback(async (nextDate = date) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/stock-zogbo?date=${encodeURIComponent(nextDate)}`,
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
  }, [date]);

  useEffect(() => {
    if (tab === "parametres") return;
    void load(date);
  }, [date, load, tab]);

  async function postAction(
    action: string,
    data: Record<string, unknown>,
  ): Promise<StockZogboPayload | null> {
    const res = await fetch("/api/stock-zogbo", {
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

  async function downloadQrSheet(input: {
    qrIds: string[];
    productName: string;
  }) {
    const res = await fetch("/api/stock-units/sheet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        qrIds: input.qrIds,
        productName: input.productName,
        date,
        title: `${input.productName} · ${input.qrIds.length} QR · ${date}`,
      }),
    });
    if (!res.ok) {
      const body = (await res.json()) as { error?: string };
      throw new Error(body.error ?? "Téléchargement des QR impossible.");
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = qrSheetFilename({
      productName: input.productName,
      date,
    });
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function handleGenerateQr(productId: string, productName: string) {
    const qty = Math.round(Number(draftQr[productId]) || 0);
    if (qty <= 0) return;
    setBusy(`qr-${productId}`);
    setError(null);
    try {
      const res = await fetch("/api/stock-zogbo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, action: "generate-qr", productId, qty }),
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
      });
      setDraftQr((d) => ({ ...d, [productId]: "" }));
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
    if (!selectedQr.size) return;
    setBusy("send");
    setError(null);
    try {
      const res = await fetch("/api/stock-zogbo", {
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
    const id = parseQrIdFromScan(raw);
    if (!id) {
      setError("Identifiant QR invalide.");
      return;
    }
    setBusy("scan");
    setError(null);
    try {
      const res = await fetch(
        `/api/stock-units?qrId=${encodeURIComponent(id)}&date=${encodeURIComponent(date)}`,
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
        `/api/stock-zogbo?date=${encodeURIComponent(date)}&units=1&productId=${encodeURIComponent(productId)}`,
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
    [date],
  );

  async function saveAcc() {
    setBusy("acc");
    setError(null);
    try {
      const res = await fetch("/api/stock-zogbo", {
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
      title={tab === "parametres" ? "Catalogue & paramètres" : "Stock Zogbo"}
      subtitle={
        tab === "parametres"
          ? "Catalogue produits, matières et recettes."
          : "Saisie du stock — plats tracés par QR, accompagnements et boissons."
      }
    >
      <div className="stock-zogbo-page">
        {tab !== "parametres" ? (
          <ContextBar date={date} onDateChange={setDate} siteLabel="Zogbo" />
        ) : null}

        <div
          className="section-tabs zogbo-cats"
          role="tablist"
          aria-label="Sections Stock Zogbo"
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
          <button
            type="button"
            role="tab"
            aria-selected={tab === "parametres"}
            className={`section-tab${tab === "parametres" ? " is-active" : ""}`}
            onClick={() => setTab("parametres")}
          >
            Catalogue
          </button>
        </div>

        {error && tab !== "parametres" ? (
          <p className="error-banner" role="alert">
            {error}
          </p>
        ) : null}

        {tab === "parametres" ? (
          <ParametresEditor mode="catalogue" />
        ) : loading ? (
          <BrandLoader label="Chargement du stock Zogbo…" />
        ) : tab === "plats" ? (
          <>
            <div className="stock-zogbo-kpis" aria-label="Totaux du jour">
              <div className="stock-zogbo-kpi">
                <span className="stock-zogbo-kpi-label">Préparé</span>
                <strong className="stock-zogbo-kpi-value">{totals.prepared}</strong>
              </div>
              <div className="stock-zogbo-kpi">
                <span className="stock-zogbo-kpi-label">QR générés</span>
                <strong className="stock-zogbo-kpi-value">{totals.qrGenerated}</strong>
              </div>
              <div className="stock-zogbo-kpi">
                <span className="stock-zogbo-kpi-label">Envoyé Gbé</span>
                <strong className="stock-zogbo-kpi-value">{totals.qrSent}</strong>
              </div>
              <div className="stock-zogbo-kpi stock-zogbo-kpi-accent">
                <span className="stock-zogbo-kpi-label">Reste Zogbo</span>
                <strong className="stock-zogbo-kpi-value">{totals.remaining}</strong>
              </div>
              <div className="stock-zogbo-kpi">
                <span className="stock-zogbo-kpi-label">Vendu</span>
                <strong className="stock-zogbo-kpi-value">{totals.sold}</strong>
              </div>
            </div>

            <div className="stock-zogbo-layout">
              <section className="panel panel-wide stock-zogbo-main">
                <div className="param-meta zogbo-meta">
                  <p>
                    <strong>{formatDisplayDate(date)}</strong>
                    {" · "}
                    Préparez et générez les QR, puis envoyez unité par unité vers
                    Gbégamey.
                  </p>
                </div>

                <div className="ui-info" role="note">
                  <span className="ui-info-mark" aria-hidden>
                    i
                  </span>
                  <p>
                    Indiquez une <strong>quantité</strong> : les QR uniques sont
                    créés et téléchargés dans un fichier HTML (imprimable en PDF).
                    Le compteur « Préparé » est mis à jour automatiquement.
                  </p>
                </div>

                <div className="table-scroll">
                  <table className="data-table zogbo-table stock-zogbo-table">
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
                          Envoyé
                        </th>
                        <th scope="col" className="col-qty">
                          Reste
                        </th>
                        <th scope="col" className="col-qty">
                          Vendu
                        </th>
                        <th scope="col" className="col-action">
                          Générer QR
                        </th>
                        <th scope="col" className="col-actions">
                          <span className="sr-only">Détail</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {plats.map((row) => {
                        const expanded = expandedProductId === row.productId;
                        return (
                          <Fragment key={row.productId}>
                            <tr
                              className={expanded ? "is-expanded" : undefined}
                            >
                              <td className="stock-zogbo-name">
                                <ProductIcon kind="plat" name={row.productName} />
                                <span>{row.productName}</span>
                              </td>
                              <td className="col-qty num">{row.prepared}</td>
                              <td className="col-qty num">
                                {row.qrGenerated}
                                {row.qrToGenerate > 0 ? (
                                  <span className="stock-zogbo-pending">
                                    +{row.qrToGenerate}
                                  </span>
                                ) : null}
                              </td>
                              <td className="col-qty num">{row.qrSent}</td>
                              <td className="col-qty num stock-zogbo-remain">
                                {row.qrRemainingZogbo}
                              </td>
                              <td className="col-qty num">{row.soldAggregate}</td>
                              <td className="col-action">
                                <div className="stock-zogbo-inline-action">
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
                                    disabled={busy === `qr-${row.productId}`}
                                    onClick={() =>
                                      void handleGenerateQr(
                                        row.productId,
                                        row.productName,
                                      )
                                    }
                                  >
                                    {busy === `qr-${row.productId}`
                                      ? "…"
                                      : "Fichier"}
                                  </button>
                                </div>
                              </td>
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
                                <td colSpan={8}>
                                  <UnitsBlock
                                    units={expandedUnits}
                                    selectedQr={selectedQr}
                                    onToggleSelect={toggleSelect}
                                    loading={busy === `units-${row.productId}`}
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
              </section>

              <aside className="panel stock-zogbo-aside">
                <h2 className="panel-title">Envoi Gbégamey</h2>
                <p className="section-hint">
                  Scannez ou saisissez un QR pour l&apos;ajouter au lot d&apos;envoi.
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
                    <span className="stock-zogbo-send-title">Lot d&apos;envoi</span>
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
                    Envoyer {selectedQr.size > 0 ? selectedQr.size : ""} vers Gbégamey
                  </button>
                </div>
              </aside>
            </div>
          </>
        ) : tab === "acc" ? (
          <section className="panel panel-wide">
            <div className="param-meta zogbo-meta">
              <p>
                <strong>{formatDisplayDate(date)}</strong>
                {" · "}
                Stock local Zogbo — pas de transfert vers Gbégamey.
              </p>
            </div>

            <div className="ui-info" role="note">
              <span className="ui-info-mark" aria-hidden>
                i
              </span>
              <p>
                Saisissez le <strong>préparé</strong> et le{" "}
                <strong>comptage</strong> (stock initial du jour). Les ventes
                sont mises à jour par la caisse.
              </p>
            </div>

            <div className="table-scroll">
              <table className="data-table zogbo-table">
                <thead>
                  <tr>
                    <th scope="col">Accompagnement</th>
                    <th scope="col" className="col-qty">
                      Dispo
                    </th>
                    <th scope="col" className="col-qty">
                      Préparé
                    </th>
                    <th scope="col" className="col-qty">
                      Comptage
                    </th>
                    <th scope="col" className="col-qty">
                      Vendu
                    </th>
                    <th scope="col" className="col-qty">
                      Reste
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {accComputed.map((row) => (
                    <tr key={row.productId}>
                      <td className="stock-zogbo-name">
                        <ProductIcon kind="local" name={row.name} />
                        <span>{row.name}</span>
                      </td>
                      <td className="col-qty num">{row.available}</td>
                      <td className="col-qty">
                        <QtyInput
                          value={row.prepared}
                          ariaLabel={`Préparé ${row.name}`}
                          onChange={(prepared) =>
                            patchAcc(row.productId, {
                              prepared: prepared ?? 0,
                            })
                          }
                        />
                      </td>
                      <td className="col-qty">
                        <QtyInput
                          value={row.counted}
                          allowEmpty
                          ariaLabel={`Comptage ${row.name}`}
                          onChange={(counted) =>
                            patchAcc(row.productId, { counted })
                          }
                        />
                      </td>
                      <td className="col-qty num">{row.sold}</td>
                      <td className="col-qty num">{row.theoreticalRemaining}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="stock-zogbo-footer-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={!accDirty || busy === "acc"}
                onClick={() => void saveAcc()}
              >
                {busy === "acc" ? "Enregistrement…" : "Enregistrer"}
              </button>
            </div>
          </section>
        ) : (
          <ZoneBoissonsPanel date={date} site="zogbo" />
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
}: {
  units: StockUnit[];
  selectedQr: Set<string>;
  onToggleSelect: (qrId: string) => void;
  loading: boolean;
}) {
  if (loading) {
    return <p className="section-hint">Chargement des unités…</p>;
  }
  if (!units.length) {
    return <p className="section-hint">Aucune unité QR pour ce plat aujourd&apos;hui.</p>;
  }

  return (
    <div className="stock-zogbo-units-block">
      <p className="stock-zogbo-units-title">
        {units.length} unité(s) — cochez pour l&apos;envoi
      </p>
      <ul className="stock-zogbo-units-grid">
        {units.map((u) => {
          const selectable = u.status === "prepare" && u.site === "zogbo";
          return (
            <li
              key={u.qrId}
              className={`stock-zogbo-unit-card${selectedQr.has(u.qrId) ? " is-selected" : ""}`}
            >
              <label className="stock-zogbo-unit-check">
                <input
                  type="checkbox"
                  checked={selectedQr.has(u.qrId)}
                  disabled={!selectable}
                  onChange={() => onToggleSelect(u.qrId)}
                />
                <span className="mono">{u.qrId}</span>
              </label>
              <span className="badge">{STOCK_UNIT_STATUS_LABELS[u.status]}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
