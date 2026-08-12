"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ContextBar } from "@/components/context-bar";
import { formatFcfa } from "@/lib/format";
import type {
  BoissonsLine,
  CombosLine,
  GbegameyLocalLine,
  GbegameyTransferLine,
  VenteKind,
  ZogboLine,
} from "@/lib/types";
import type {
  RepriseCatalogItem,
  RepriseVenteZogboExistante,
  RepriseVenteZogboLine,
} from "@/lib/reprise-repo";

type Zone = "journal" | "zogbo" | "gbegamey" | "boissons" | "combos";

type SourceTotal = { source: string; lignes: number; montant: number };

type Payload = {
  date: string;
  editable: boolean;
  catalog: RepriseCatalogItem[];
  ventesZogbo: RepriseVenteZogboLine[];
  ventesAutresZogbo: RepriseVenteZogboExistante[];
  zogbo: ZogboLine[];
  gbegameyTransfer: GbegameyTransferLine[];
  gbegameyLocal: GbegameyLocalLine[];
  boissons: BoissonsLine[];
  combos: CombosLine[];
  ventesExistantes: SourceTotal[];
};

type SaveResult = {
  date: string;
  ventesGenerees: number;
  ventesSupprimees: number;
  caZogbo: number;
  caGbegamey: number;
};

const ZONES: { key: Zone; label: string }[] = [
  { key: "journal", label: "Journal ventes Zogbo" },
  { key: "zogbo", label: "Stock plats" },
  { key: "boissons", label: "Stock boissons" },
  { key: "combos", label: "Stock combos" },
  { key: "gbegamey", label: "Gbégamey" },
];

const KIND_OPTIONS: { value: VenteKind; label: string }[] = [
  { value: "extra", label: "Vente libre / combo menu" },
  { value: "plat", label: "Plat" },
  { value: "boisson", label: "Boisson" },
  { value: "combo", label: "Combo catalogue" },
];

const ZOGBO_REPRISE_FROM = "2026-08-07";

const SOURCE_LABELS: Record<string, string> = {
  reprise: "Reprise d’historique",
  aquapro: "AquaPro",
  "inventaire-marco": "Inventaire Excel",
  "carnet-zogbo": "Carnet manuscrit",
  caisse: "Caisse de l’application",
};

function num(value: unknown): number {
  return Math.max(0, Number(value) || 0);
}

/**
 * Champ quantité. La valeur vide est conservée telle quelle pendant la frappe
 * (sinon un « 0 » colle au curseur dès qu’on efface) et n’est convertie qu’à
 * la sortie du champ.
 */
function QtyInput({
  value,
  onChange,
  nullable,
}: {
  value: number | null;
  onChange: (next: number | null) => void;
  nullable?: boolean;
}) {
  const [draft, setDraft] = useState<string>(value === null ? "" : String(value));

  useEffect(() => {
    setDraft(value === null ? "" : String(value));
  }, [value]);

  return (
    <input
      type="number"
      min={0}
      step="any"
      inputMode="decimal"
      className="input-num"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft.trim() === "") {
          onChange(nullable ? null : 0);
          setDraft(nullable ? "" : "0");
          return;
        }
        onChange(num(draft));
      }}
    />
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <input
      type="text"
      className={className ?? "input-text"}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function newVenteLine(
  partial?: Partial<RepriseVenteZogboLine>,
): RepriseVenteZogboLine {
  return {
    id: `new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    kind: partial?.kind ?? "extra",
    productId: partial?.productId ?? "",
    name: partial?.name ?? "",
    qty: partial?.qty ?? 1,
    unitPrice: partial?.unitPrice ?? 0,
  };
}

export function ReprisePage() {
  const [date, setDate] = useState(ZOGBO_REPRISE_FROM);
  const [data, setData] = useState<Payload | null>(null);
  const [zone, setZone] = useState<Zone>("journal");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SaveResult | null>(null);
  const [genererVentes, setGenererVentes] = useState(true);
  const [utiliserJournalDetaille, setUtiliserJournalDetaille] = useState(true);
  const [cloturer, setCloturer] = useState(true);

  const load = useCallback(async (target: string) => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/reprise?date=${encodeURIComponent(target)}`, {
        cache: "no-store",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || "Chargement impossible");
      setData(body as Payload);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : "Chargement impossible");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(date);
  }, [date, load]);

  // Une reprise déjà enregistrée est sa propre origine : la resignaler comme
  // doublon potentiel ferait crier au loup à chaque nouvelle sauvegarde.
  const autresSources = useMemo(
    () => (data?.ventesExistantes ?? []).filter((s) => s.source !== "reprise"),
    [data],
  );

  const totaux = useMemo(() => {
    if (!data) {
      return {
        zogbo: 0,
        gbegamey: 0,
        journal: 0,
        journalLignes: 0,
        autres: 0,
        autresLignes: 0,
        totalZogbo: 0,
      };
    }
    let journal = 0;
    let journalLignes = 0;
    for (const l of data.ventesZogbo) {
      const q = num(l.qty);
      const p = num(l.unitPrice);
      if (l.name.trim() && q > 0) {
        journal += q * p;
        journalLignes += 1;
      }
    }
    let autres = 0;
    let autresLignes = 0;
    for (const l of data.ventesAutresZogbo) {
      autres += num(l.qty) * num(l.unitPrice);
      autresLignes += 1;
    }
    let zogboCompteurs = 0;
    if (!utiliserJournalDetaille || journalLignes === 0) {
      for (const l of data.zogbo) zogboCompteurs += num(l.sold);
      for (const l of data.combos) zogboCompteurs += num(l.soldZogbo);
      for (const l of data.boissons) zogboCompteurs += num(l.soldZogbo);
    }
    const zogboReprise =
      utiliserJournalDetaille && journalLignes > 0 ? journal : zogboCompteurs;
    let gbegamey = 0;
    for (const l of data.combos) gbegamey += num(l.soldGbegamey);
    for (const l of data.boissons) gbegamey += num(l.soldGbegamey);
    for (const l of data.gbegameyTransfer) gbegamey += num(l.sold);
    for (const l of data.gbegameyLocal) gbegamey += num(l.sold);
    return {
      zogbo: zogboReprise,
      gbegamey,
      journal,
      journalLignes,
      autres,
      autresLignes,
      totalZogbo: autres + zogboReprise,
    };
  }, [data, utiliserJournalDetaille]);

  function patchRow(
    key: keyof Payload,
    index: number,
    changes: Record<string, number | null | string>,
  ) {
    setData((prev) => {
      if (!prev) return prev;
      const rows = [...(prev[key] as unknown as Record<string, unknown>[])];
      rows[index] = { ...rows[index], ...changes };
      return { ...prev, [key]: rows } as Payload;
    });
    setResult(null);
  }

  function patchVente(index: number, changes: Partial<RepriseVenteZogboLine>) {
    setData((prev) => {
      if (!prev) return prev;
      const ventesZogbo = [...prev.ventesZogbo];
      ventesZogbo[index] = { ...ventesZogbo[index]!, ...changes };
      return { ...prev, ventesZogbo };
    });
    setResult(null);
  }

  function addVenteFromCatalog(item: RepriseCatalogItem) {
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        ventesZogbo: [
          ...prev.ventesZogbo,
          newVenteLine({
            kind: item.kind,
            productId: item.id,
            name: item.name,
            unitPrice: item.unitPrice,
            qty: 1,
          }),
        ],
      };
    });
    setResult(null);
  }

  function addVenteVide() {
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        ventesZogbo: [...prev.ventesZogbo, newVenteLine()],
      };
    });
    setResult(null);
  }

  function removeVente(index: number) {
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        ventesZogbo: prev.ventesZogbo.filter((_, i) => i !== index),
      };
    });
    setResult(null);
  }

  function patch<K extends keyof Payload>(
    key: K,
    index: number,
    changes: Record<string, number | null>,
  ) {
    patchRow(key, index, changes);
  }

  async function save() {
    if (!data) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/reprise", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: data.date,
          ventesZogbo: data.ventesZogbo,
          utiliserJournalDetaille,
          zogbo: data.zogbo,
          gbegameyTransfer: data.gbegameyTransfer,
          gbegameyLocal: data.gbegameyLocal,
          boissons: data.boissons,
          combos: data.combos,
          genererVentes,
          cloturer,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || "Enregistrement impossible");
      setResult(body as SaveResult);
      await load(data.date);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell
      title="Reprise historique"
      subtitle="Enregistrement admin — ventes et stock Zogbo (sans suppression des données existantes)"
    >
      <ContextBar date={date} onDateChange={setDate} siteLabel="Reprise">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void save()}
          disabled={saving || loading || !data?.editable}
        >
          {saving ? "Enregistrement…" : "Enregistrer la journée"}
        </button>
      </ContextBar>

      {error ? <p className="error-banner">{error}</p> : null}

      <section className="panel">
        <h2 className="panel-title">Enregistrement historique Zogbo</h2>
        <p className="ui-info">
          Ajoutez ou corrigez les ventes et le stock sans effacer le carnet,
          AquaPro ni la caisse déjà enregistrés. Dans{" "}
          <strong>Journal ventes</strong>, saisissez vos lignes (nom du plat,
          combo, boisson, quantité, prix). Les ventes déjà présentes restent
          visibles en lecture seule.
        </p>

        {data && !data.editable ? (
          <p className="error-banner">
            Cette date n’est pas passée. La reprise ne s’applique qu’aux
            journées révolues ; pour aujourd’hui, utilisez les écrans du
            quotidien.
          </p>
        ) : null}

        {autresSources.length ? (
          <p className="ui-info">
            Ventes déjà en base pour cette date (conservées) :{" "}
            {autresSources
              .map(
                (s) =>
                  `${SOURCE_LABELS[s.source] ?? s.source} (${s.lignes} ligne(s), ${formatFcfa(s.montant)})`,
              )
              .join(" · ")}
          </p>
        ) : null}

        <div className="reprise-options">
          <label className="check-field">
            <input
              type="checkbox"
              checked={utiliserJournalDetaille}
              onChange={(e) => setUtiliserJournalDetaille(e.target.checked)}
            />
            <span>
              CA Reprise depuis le journal saisi ({totaux.journalLignes}{" "}
              ligne(s), {formatFcfa(totaux.journal)})
            </span>
          </label>
          <label className="check-field">
            <input
              type="checkbox"
              checked={genererVentes}
              onChange={(e) => setGenererVentes(e.target.checked)}
            />
            <span>
              Enregistrer · CA Zogbo total {formatFcfa(totaux.totalZogbo)} (dont{" "}
              {formatFcfa(totaux.autres)} déjà en base) · Gbé{" "}
              {formatFcfa(totaux.gbegamey)}
            </span>
          </label>
          <label className="check-field">
            <input
              type="checkbox"
              checked={cloturer}
              onChange={(e) => setCloturer(e.target.checked)}
            />
            <span>Clôturer la journée</span>
          </label>
        </div>

        {result ? (
          <p className="ui-info">
            Journée du {result.date} enregistrée · {result.ventesGenerees} vente(s)
            générée(s)
            {result.ventesSupprimees
              ? ` (${result.ventesSupprimees} ancienne(s) ligne(s) reprise remplacée(s))`
              : ""}{" "}
            · CA Reprise Zogbo {formatFcfa(result.caZogbo)} · CA Gbégamey{" "}
            {formatFcfa(result.caGbegamey)}
          </p>
        ) : null}
      </section>

      <div className="section-tabs" role="tablist" aria-label="Zones à reprendre">
        {ZONES.map((z) => (
          <button
            key={z.key}
            type="button"
            role="tab"
            aria-selected={zone === z.key}
            className={`section-tab${zone === z.key ? " is-active" : ""}`}
            onClick={() => setZone(z.key)}
          >
            {z.label}
          </button>
        ))}
      </div>

      {loading ? <p className="muted">Chargement…</p> : null}

      {!loading && data && zone === "journal" ? (
        <section className="panel panel-wide">
          <h2 className="panel-title">Votre saisie — journal Reprise</h2>
          <p className="ui-info">
            Lignes que vous ajoutez ou modifiez ici (source Reprise). Nom libre
            ou depuis le catalogue — quantité et prix réel du jour.
          </p>

          <div className="toolbar-row">
            <label className="reprise-catalog-add">
              <span className="muted">Catalogue</span>
              <select
                className="input-select"
                defaultValue=""
                onChange={(e) => {
                  const id = e.target.value;
                  e.target.value = "";
                  const item = data.catalog.find((c) => c.id === id);
                  if (item) addVenteFromCatalog(item);
                }}
              >
                <option value="">+ Plat, combo ou boisson…</option>
                <optgroup label="Plats">
                  {data.catalog
                    .filter((c) => c.kind === "plat")
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({formatFcfa(c.unitPrice)})
                      </option>
                    ))}
                </optgroup>
                <optgroup label="Combos">
                  {data.catalog
                    .filter((c) => c.kind === "combo")
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({formatFcfa(c.unitPrice)})
                      </option>
                    ))}
                </optgroup>
                <optgroup label="Boissons">
                  {data.catalog
                    .filter((c) => c.kind === "boisson")
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({formatFcfa(c.unitPrice)})
                      </option>
                    ))}
                </optgroup>
              </select>
            </label>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => addVenteVide()}
            >
              + Ligne libre
            </button>
          </div>

          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Nom du produit / menu</th>
                  <th className="col-num">Qté</th>
                  <th className="col-num">P.U. (FCFA)</th>
                  <th className="col-num">Montant</th>
                  <th className="col-num">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.ventesZogbo.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="muted">
                      Aucune ligne — ajoutez les ventes du carnet ou du
                      catalogue.
                    </td>
                  </tr>
                ) : (
                  data.ventesZogbo.map((l, i) => {
                    const montant = num(l.qty) * num(l.unitPrice);
                    return (
                      <tr key={l.id}>
                        <td>
                          <select
                            className="input-select"
                            value={l.kind}
                            onChange={(e) =>
                              patchVente(i, {
                                kind: e.target.value as VenteKind,
                              })
                            }
                          >
                            {KIND_OPTIONS.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <TextInput
                            value={l.name}
                            placeholder="Ex. Sauce d'arachide + Riz"
                            onChange={(name) => patchVente(i, { name })}
                          />
                        </td>
                        <td className="col-num">
                          <QtyInput
                            value={l.qty}
                            onChange={(qty) =>
                              patchVente(i, { qty: qty ?? 0 })
                            }
                          />
                        </td>
                        <td className="col-num">
                          <QtyInput
                            value={l.unitPrice}
                            onChange={(unitPrice) =>
                              patchVente(i, { unitPrice: unitPrice ?? 0 })
                            }
                          />
                        </td>
                        <td className="col-num mono">{formatFcfa(montant)}</td>
                        <td className="col-num">
                          <button
                            type="button"
                            className="btn-link"
                            onClick={() => removeVente(i)}
                          >
                            Retirer
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              {data.ventesZogbo.length > 0 ? (
                <tfoot>
                  <tr>
                    <th colSpan={4} scope="row">
                      Total journal ({totaux.journalLignes} ligne
                      {totaux.journalLignes > 1 ? "s" : ""})
                    </th>
                    <td className="col-num mono">
                      {formatFcfa(totaux.journal)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>

          {data.ventesAutresZogbo.length > 0 ? (
            <>
              <h3 className="panel-title" style={{ marginTop: "1.5rem" }}>
                Ventes déjà enregistrées (conservées)
              </h3>
              <p className="ui-info">
                Carnet, AquaPro, caisse… — lecture seule, jamais effacées par
                l&apos;enregistrement Reprise.
              </p>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th>Type</th>
                      <th>Nom</th>
                      <th className="col-num">Qté</th>
                      <th className="col-num">P.U.</th>
                      <th className="col-num">Montant</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.ventesAutresZogbo.map((l) => (
                      <tr key={l.id}>
                        <td>{SOURCE_LABELS[l.source] ?? l.source}</td>
                        <td>{l.kind}</td>
                        <td>{l.name}</td>
                        <td className="col-num mono">{l.qty}</td>
                        <td className="col-num mono">
                          {formatFcfa(l.unitPrice)}
                        </td>
                        <td className="col-num mono">
                          {formatFcfa(num(l.qty) * num(l.unitPrice))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th colSpan={5} scope="row">
                        Total déjà en base ({totaux.autresLignes} ligne
                        {totaux.autresLignes > 1 ? "s" : ""})
                      </th>
                      <td className="col-num mono">
                        {formatFcfa(totaux.autres)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          ) : null}
        </section>
      ) : null}

      {!loading && data && zone === "zogbo" ? (
        <section className="panel">
          <h2 className="panel-title">Zogbo · stock plats</h2>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Plat</th>
                  <th className="col-num">Stock</th>
                  <th className="col-num">Préparé</th>
                  <th className="col-num">Envoyé</th>
                  <th className="col-num">Vendu</th>
                  <th className="col-num">Compté</th>
                </tr>
              </thead>
              <tbody>
                {data.zogbo.map((l, i) => (
                  <tr key={l.productId}>
                    <td>{l.name}</td>
                    <td className="col-num">
                      <QtyInput
                        value={l.stock}
                        onChange={(v) => patch("zogbo", i, { stock: v ?? 0 })}
                      />
                    </td>
                    <td className="col-num">
                      <QtyInput
                        value={l.prepared}
                        onChange={(v) => patch("zogbo", i, { prepared: v ?? 0 })}
                      />
                    </td>
                    <td className="col-num">
                      <QtyInput
                        value={l.sentToGbegamey}
                        onChange={(v) =>
                          patch("zogbo", i, { sentToGbegamey: v ?? 0 })
                        }
                      />
                    </td>
                    <td className="col-num">
                      <QtyInput
                        value={l.sold}
                        onChange={(v) => patch("zogbo", i, { sold: v ?? 0 })}
                      />
                    </td>
                    <td className="col-num">
                      <QtyInput
                        nullable
                        value={l.counted}
                        onChange={(v) => patch("zogbo", i, { counted: v })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {!loading && data && zone === "gbegamey" ? (
        <>
          <section className="panel">
            <h2 className="panel-title">Gbégamey · plats reçus de Zogbo</h2>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Plat</th>
                    <th className="col-num">Reste veille</th>
                    <th className="col-num">Reçu</th>
                    <th className="col-num">Vendu</th>
                    <th className="col-num">Compté</th>
                  </tr>
                </thead>
                <tbody>
                  {data.gbegameyTransfer.map((l, i) => (
                    <tr key={l.productId}>
                      <td>{l.name}</td>
                      <td className="col-num">
                        <QtyInput
                          value={l.initialStock}
                          onChange={(v) =>
                            patch("gbegameyTransfer", i, { initialStock: v ?? 0 })
                          }
                        />
                      </td>
                      <td className="col-num">
                        <QtyInput
                          nullable
                          value={l.received}
                          onChange={(v) =>
                            patch("gbegameyTransfer", i, { received: v })
                          }
                        />
                      </td>
                      <td className="col-num">
                        <QtyInput
                          value={l.sold}
                          onChange={(v) =>
                            patch("gbegameyTransfer", i, { sold: v ?? 0 })
                          }
                        />
                      </td>
                      <td className="col-num">
                        <QtyInput
                          nullable
                          value={l.counted}
                          onChange={(v) =>
                            patch("gbegameyTransfer", i, { counted: v })
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel">
            <h2 className="panel-title">Gbégamey · plats préparés sur place</h2>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Plat</th>
                    <th className="col-num">Reste veille</th>
                    <th className="col-num">Préparé</th>
                    <th className="col-num">Vendu</th>
                    <th className="col-num">Compté</th>
                  </tr>
                </thead>
                <tbody>
                  {data.gbegameyLocal.map((l, i) => (
                    <tr key={l.productId}>
                      <td>{l.name}</td>
                      <td className="col-num">
                        <QtyInput
                          value={l.initialStock}
                          onChange={(v) =>
                            patch("gbegameyLocal", i, { initialStock: v ?? 0 })
                          }
                        />
                      </td>
                      <td className="col-num">
                        <QtyInput
                          value={l.prepared}
                          onChange={(v) =>
                            patch("gbegameyLocal", i, { prepared: v ?? 0 })
                          }
                        />
                      </td>
                      <td className="col-num">
                        <QtyInput
                          value={l.sold}
                          onChange={(v) =>
                            patch("gbegameyLocal", i, { sold: v ?? 0 })
                          }
                        />
                      </td>
                      <td className="col-num">
                        <QtyInput
                          nullable
                          value={l.counted}
                          onChange={(v) =>
                            patch("gbegameyLocal", i, { counted: v })
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}

      {!loading && data && zone === "boissons" ? (
        <section className="panel">
          <h2 className="panel-title">Boissons · stock Zogbo</h2>
          <p className="ui-info">
            Stock et achats en casiers ; vendu Zogbo en bouteilles (compteurs
            stock — le CA vient du journal si activé).
          </p>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Boisson</th>
                  <th className="col-num">Initial</th>
                  <th className="col-num">Achats</th>
                  <th className="col-num">Vendu Zogbo</th>
                  <th className="col-num">Vendu Gbégamey</th>
                  <th className="col-num">Compté</th>
                </tr>
              </thead>
              <tbody>
                {data.boissons.map((l, i) => (
                  <tr key={l.productId}>
                    <td>
                      <strong>{l.name}</strong>
                    </td>
                    <td className="col-num">
                      <QtyInput
                        value={l.initialStock}
                        onChange={(v) =>
                          patch("boissons", i, { initialStock: v ?? 0 })
                        }
                      />
                    </td>
                    <td className="col-num">
                      <QtyInput
                        value={l.purchases}
                        onChange={(v) =>
                          patch("boissons", i, { purchases: v ?? 0 })
                        }
                      />
                    </td>
                    <td className="col-num">
                      <QtyInput
                        value={l.soldZogbo}
                        onChange={(v) =>
                          patch("boissons", i, { soldZogbo: v ?? 0 })
                        }
                      />
                    </td>
                    <td className="col-num">
                      <QtyInput
                        value={l.soldGbegamey}
                        onChange={(v) =>
                          patch("boissons", i, { soldGbegamey: v ?? 0 })
                        }
                      />
                    </td>
                    <td className="col-num">
                      <QtyInput
                        nullable
                        value={l.counted}
                        onChange={(v) => patch("boissons", i, { counted: v })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {!loading && data && zone === "combos" ? (
        <section className="panel">
          <h2 className="panel-title">Combos · stock Zogbo</h2>
          {data.combos.length === 0 ? (
            <p className="ui-info">
              Aucun combo au catalogue — saisissez les menus dans le{" "}
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setZone("journal")}
              >
                journal ventes
              </button>{" "}
              (type « Vente libre ») ou ajoutez les combos dans Paramètres.
            </p>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Combo</th>
                    <th className="col-num">Préparé</th>
                    <th className="col-num">Envoyé</th>
                    <th className="col-num">Vendu Zogbo</th>
                    <th className="col-num">Vendu Gbégamey</th>
                    <th className="col-num">Compté Zogbo</th>
                  </tr>
                </thead>
                <tbody>
                  {data.combos.map((l, i) => (
                    <tr key={l.productId}>
                      <td>
                        <strong>{l.name}</strong>
                        {l.baseDishName ? (
                          <span className="cell-sub"> · {l.baseDishName}</span>
                        ) : null}
                      </td>
                      <td className="col-num">
                        <QtyInput
                          value={l.prepared}
                          onChange={(v) =>
                            patch("combos", i, { prepared: v ?? 0 })
                          }
                        />
                      </td>
                      <td className="col-num">
                        <QtyInput
                          value={l.sentToGbegamey}
                          onChange={(v) =>
                            patch("combos", i, { sentToGbegamey: v ?? 0 })
                          }
                        />
                      </td>
                      <td className="col-num">
                        <QtyInput
                          value={l.soldZogbo}
                          onChange={(v) =>
                            patch("combos", i, { soldZogbo: v ?? 0 })
                          }
                        />
                      </td>
                      <td className="col-num">
                        <QtyInput
                          value={l.soldGbegamey}
                          onChange={(v) =>
                            patch("combos", i, { soldGbegamey: v ?? 0 })
                          }
                        />
                      </td>
                      <td className="col-num">
                        <QtyInput
                          nullable
                          value={l.countedZogbo}
                          onChange={(v) =>
                            patch("combos", i, { countedZogbo: v })
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </AppShell>
  );
}
