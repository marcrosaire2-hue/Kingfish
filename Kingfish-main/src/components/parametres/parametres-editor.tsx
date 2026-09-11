"use client";

import { useEffect, useMemo, useState } from "react";
import { ExportExcelButton } from "@/components/export-excel-button";
import { CatalogueView } from "@/components/parametres/catalogue-view";
import { PriceInput } from "@/components/parametres/price-input";
import { QtyInput } from "@/components/qty-input";
import { formatFcfa, formatUpdatedAt, newId } from "@/lib/format";
import { exportParametresExcel } from "@/lib/page-exports";
import { cloneSeed } from "@/lib/storage";
import type {
  BaseDish,
  Drink,
  LocalDish,
  Parametres,
  RawMaterial,
  Recipe,
} from "@/lib/types";

type ZoneKey = "zogbo" | "gbegamey" | "cuisine";
type ZogboSection = "base" | "accompagnements" | "drinks";
type GbegameySection = "accompagnements" | "drinks";
type CuisineSection = "matieres" | "composition";
type CatalogueSectionKey = "base" | "accompagnements" | "drinks";

export type ParametresEditorMode = "zones" | "catalogue";

const ZONE_TABS: { key: ZoneKey; label: string }[] = [
  { key: "zogbo", label: "Zogbo" },
  { key: "gbegamey", label: "Gbégamey" },
  { key: "cuisine", label: "Cuisine" },
];

const ZOGBO_SECTIONS: {
  key: ZogboSection;
  label: string;
  hint: string;
}[] = [
  {
    key: "base",
    label: "Plats de base",
    hint: "Production Zogbo — prix aussi utilisés pour les ventes à Gbégamey (transferts).",
  },
  {
    key: "accompagnements",
    label: "Accompagnements",
    hint: "Riz, telibo, piron… — catalogue partagé, vendus seuls ou avec un plat (Zogbo et Gbégamey).",
  },
  {
    key: "drinks",
    label: "Boissons",
    hint: "Catalogue boissons (partagé) — stock et ventes en bouteilles.",
  },
];

const GBEGAMEY_SECTIONS: {
  key: GbegameySection;
  label: string;
  hint: string;
}[] = [
  {
    key: "accompagnements",
    label: "Accompagnements",
    hint: "Même catalogue que Zogbo — vente à l’unité ou en complément d’un plat.",
  },
  {
    key: "drinks",
    label: "Boissons",
    hint: "Même catalogue — stock et ventes en bouteilles.",
  },
];

const CUISINE_SECTIONS: {
  key: CuisineSection;
  label: string;
  hint: string;
}[] = [
  {
    key: "matieres",
    label: "Matières",
    hint: "Aliments sources : unité, prix d’achat, seuil d’alerte, stock bloquant.",
  },
  {
    key: "composition",
    label: "Composition",
    hint: "Recettes : matières consommées par produit vendable (plats / accompagnements).",
  },
];

async function fetchParametres(): Promise<Parametres> {
  const res = await fetch("/api/parametres", { cache: "no-store" });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error || "Erreur de chargement");
  }
  return res.json() as Promise<Parametres>;
}

async function putParametres(data: Parametres): Promise<Parametres> {
  const res = await fetch("/api/parametres", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error || "Erreur d’enregistrement");
  }
  return res.json() as Promise<Parametres>;
}

async function resetParametresApi(): Promise<Parametres> {
  const res = await fetch("/api/parametres", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "reset" }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error || "Erreur de réinitialisation");
  }
  return res.json() as Promise<Parametres>;
}

export function ParametresEditor({
  mode = "zones",
}: {
  /** `catalogue` : sections plates sans onglets Zogbo / Gbégamey (page Stock). */
  mode?: ParametresEditorMode;
}) {
  const [data, setData] = useState<Parametres>(() => cloneSeed());
  const [zone, setZone] = useState<ZoneKey>("zogbo");
  const [zogboSection, setZogboSection] = useState<ZogboSection>("base");
  const [gbegameySection, setGbegameySection] =
    useState<GbegameySection>("accompagnements");
  const [cuisineSection, setCuisineSection] =
    useState<CuisineSection>("matieres");
  const [catalogueSection, setCatalogueSection] =
    useState<CatalogueSectionKey>("base");
  const [savedFlash, setSavedFlash] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const remote = await fetchParametres();
        if (!cancelled) {
          setData(remote);
          setError(null);
          setReady(true);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Erreur de chargement");
          setReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Une boisson sans prix de vente est refusée à la caisse : sa carte reste
   * grisée et la vente est rejetée côté serveur. On nomme les produits
   * concernés — un simple compteur passait inaperçu.
   */
  const drinksWithoutPrice = useMemo(
    () => data.drinks.filter((d) => d.salePrice === null).map((d) => d.name),
    [data],
  );

  function update(next: Parametres) {
    setData(next);
    setDirty(true);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const saved = await putParametres(data);
      setData(saved);
      setDirty(false);
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur d’enregistrement");
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    if (
      !window.confirm(
        "Réinitialiser tous les paramètres aux valeurs du fichier Excel d’origine ?",
      )
    ) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await resetParametresApi();
      setData(saved);
      setDirty(false);
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de réinitialisation");
    } finally {
      setSaving(false);
    }
  }

  const sectionHint =
    zone === "zogbo"
      ? ZOGBO_SECTIONS.find((s) => s.key === zogboSection)?.hint
      : zone === "gbegamey"
        ? GBEGAMEY_SECTIONS.find((s) => s.key === gbegameySection)?.hint
        : CUISINE_SECTIONS.find((s) => s.key === cuisineSection)?.hint;

  const rawMaterials = data.rawMaterials ?? [];
  const recipes = data.recipes ?? [];

  async function reload() {
    setSaving(true);
    setError(null);
    try {
      const remote = await fetchParametres();
      setData(remote);
      setDirty(false);
      setReady(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement");
    } finally {
      setSaving(false);
    }
  }

  if (mode === "catalogue") {
    return (
      <CatalogueView
        data={data}
        ready={ready}
        saving={saving}
        dirty={dirty}
        savedFlash={savedFlash}
        error={error}
        catalogueSection={catalogueSection}
        onCatalogueSectionChange={setCatalogueSection}
        onUpdate={update}
        onSave={() => void handleSave()}
        onReset={() => void handleReset()}
        drinksWithoutPrice={drinksWithoutPrice}
        onRetry={() => void reload()}
      />
    );
  }

  return (
  <div className="parametres-editor">
      <div className="parametres-editor-toolbar">
        <ExportExcelButton
          onExport={() => exportParametresExcel(data)}
          disabled={!ready}
        />
        <button
          type="button"
          className="btn btn-ghost"
          onClick={handleReset}
          disabled={saving}
        >
          Réinitialiser
        </button>
        <button
          type="button"
          className={`btn btn-primary${savedFlash && !dirty ? " btn-saved" : ""}`}
          onClick={handleSave}
          disabled={!dirty || saving}
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

      <div className="param-meta">
        <p>
          Dernière sauvegarde :{" "}
          <strong>{ready ? formatUpdatedAt(data.updatedAt) : "…"}</strong>
        </p>
      </div>

      {drinksWithoutPrice.length > 0 ? (
        <p className="error-banner" role="alert">
          <strong>
            {drinksWithoutPrice.length} boisson
            {drinksWithoutPrice.length > 1 ? "s" : ""} invendable
            {drinksWithoutPrice.length > 1 ? "s" : ""} en caisse
          </strong>{" "}
          — {drinksWithoutPrice.slice(0, 6).join(", ")}
          {drinksWithoutPrice.length > 6
            ? ` et ${drinksWithoutPrice.length - 6} autre${
                drinksWithoutPrice.length - 6 > 1 ? "s" : ""
              }`
            : ""}
          . Sans prix de vente, leur carte reste grisée sur la page Vente, même
          si le stock est là. Renseignez le prix dans l’onglet Boissons.
        </p>
      ) : null}

      {error ? (
        <p className="error-banner" role="alert">
          {error}
        </p>
      ) : null}

      <>
          <div className="section-tabs" role="tablist" aria-label="Point">
            {ZONE_TABS.map((z) => (
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

          {zone === "zogbo" ? (
            <div
              className="section-tabs"
              role="tablist"
              aria-label="Catalogue Zogbo"
            >
              {ZOGBO_SECTIONS.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  role="tab"
                  aria-selected={zogboSection === s.key}
                  className={`section-tab${zogboSection === s.key ? " is-active" : ""}`}
                  onClick={() => setZogboSection(s.key)}
                >
                  {s.label}
                  <span className="section-count">
                    {s.key === "base"
                      ? data.baseDishes.length
                      : s.key === "accompagnements"
                        ? data.localDishes.length
                        : data.drinks.length}
                  </span>
                </button>
              ))}
            </div>
          ) : zone === "gbegamey" ? (
            <div
              className="section-tabs"
              role="tablist"
              aria-label="Catalogue Gbégamey"
            >
              {GBEGAMEY_SECTIONS.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  role="tab"
                  aria-selected={gbegameySection === s.key}
                  className={`section-tab${gbegameySection === s.key ? " is-active" : ""}`}
                  onClick={() => setGbegameySection(s.key)}
                >
                  {s.label}
                  <span className="section-count">
                    {s.key === "accompagnements"
                      ? data.localDishes.length
                      : data.drinks.length}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div
              className="section-tabs"
              role="tablist"
              aria-label="Cuisine"
            >
              {CUISINE_SECTIONS.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  role="tab"
                  aria-selected={cuisineSection === s.key}
                  className={`section-tab${cuisineSection === s.key ? " is-active" : ""}`}
                  onClick={() => setCuisineSection(s.key)}
                >
                  {s.label}
                  <span className="section-count">
                    {s.key === "matieres"
                      ? rawMaterials.length
                      : recipes.length}
                  </span>
                </button>
              ))}
            </div>
          )}
      </>

      <div className="ui-info" role="note">
        <span className="ui-info-mark" aria-hidden>
          i
        </span>
        <p>{sectionHint}</p>
      </div>

      {zone === "zogbo" && zogboSection === "base" ? (
        <BaseDishesTable
          rows={data.baseDishes}
          onChange={(baseDishes) => update({ ...data, baseDishes })}
        />
      ) : null}

      {zone === "zogbo" && zogboSection === "accompagnements" ? (
        <LocalDishesTable
          rows={data.localDishes}
          onChange={(localDishes) => update({ ...data, localDishes })}
        />
      ) : null}

      {zone === "zogbo" && zogboSection === "drinks" ? (
        <DrinksTable
          rows={data.drinks}
          onChange={(drinks) => update({ ...data, drinks })}
        />
      ) : null}

      {zone === "gbegamey" &&
      gbegameySection === "accompagnements" ? (
        <LocalDishesTable
          rows={data.localDishes}
          onChange={(localDishes) => update({ ...data, localDishes })}
        />
      ) : null}

      {zone === "gbegamey" && gbegameySection === "drinks" ? (
        <DrinksTable
          rows={data.drinks}
          onChange={(drinks) => update({ ...data, drinks })}
        />
      ) : null}

      {zone === "cuisine" && cuisineSection === "matieres" ? (
        <RawMaterialsTable
          rows={rawMaterials}
          onChange={(next) => update({ ...data, rawMaterials: next })}
        />
      ) : null}

      {zone === "cuisine" && cuisineSection === "composition" ? (
        <RecipesTable
          recipes={recipes}
          materials={rawMaterials}
          products={[
            ...data.baseDishes.map((d) => ({ id: d.id, name: d.name })),
            ...data.localDishes.map((d) => ({ id: d.id, name: d.name })),
          ]}
          onChange={(next) => update({ ...data, recipes: next })}
        />
      ) : null}

      {zone === "gbegamey" &&
      gbegameySection === "accompagnements" ? (
        <p className="section-hint">
          Les plats reçus de Zogbo utilisent les prix de{" "}
          <strong>Zogbo → Plats de base</strong>.
        </p>
      ) : null}
  </div>
  );
}

function NameCell({
  value,
  onChange,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
}) {
  return (
    <input
      className="name-input"
      value={value}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function BaseDishesTable({
  rows,
  onChange,
}: {
  rows: BaseDish[];
  onChange: (rows: BaseDish[]) => void;
}) {
  return (
    <section className="panel">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Désignation</th>
            <th scope="col" className="col-price">
              Prix unitaire
            </th>
            <th scope="col" className="col-price">
              Prix de revient
            </th>
            <th scope="col" className="col-actions">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.id}>
              <td>
                <NameCell
                  value={row.name}
                  ariaLabel={`Nom plat de base ${index + 1}`}
                  onChange={(name) =>
                    onChange(
                      rows.map((r) => (r.id === row.id ? { ...r, name } : r)),
                    )
                  }
                />
              </td>
              <td className="col-price">
                <PriceInput
                  value={row.unitPrice}
                  ariaLabel={`Prix ${row.name}`}
                  onChange={(unitPrice) =>
                    onChange(
                      rows.map((r) =>
                        r.id === row.id
                          ? { ...r, unitPrice: unitPrice ?? 0 }
                          : r,
                      ),
                    )
                  }
                />
              </td>
              <td className="col-price">
                <PriceInput
                  value={row.costPrice ?? null}
                  allowEmpty
                  ariaLabel={`Revient ${row.name}`}
                  onChange={(costPrice) =>
                    onChange(
                      rows.map((r) =>
                        r.id === row.id
                          ? {
                              ...r,
                              costPrice:
                                costPrice === null ? undefined : costPrice,
                            }
                          : r,
                      ),
                    )
                  }
                />
              </td>
              <td className="col-actions">
                <button
                  type="button"
                  className="btn-icon"
                  aria-label={`Supprimer ${row.name}`}
                  onClick={() => onChange(rows.filter((r) => r.id !== row.id))}
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        className="btn btn-add"
        onClick={() =>
          onChange([
            ...rows,
            { id: newId("base"), name: "Nouveau plat", unitPrice: 1500 },
          ])
        }
      >
        + Ajouter un plat de base
      </button>
    </section>
  );
}

function DrinksTable({
  rows,
  onChange,
}: {
  rows: Drink[];
  onChange: (rows: Drink[]) => void;
}) {
  return (
    <section className="panel">
      <p className="section-hint">
        Le stock et les achats se comptent en <strong>bouteilles</strong>.
        Indiquez la contenance du carton de livraison pour les conversions.
      </p>
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Boisson</th>
            <th scope="col" className="col-qty">
              Contenance (bt)
            </th>
            <th scope="col" className="col-price">
              PA / bouteille
            </th>
            <th scope="col" className="col-price">
              PV / bouteille
            </th>
            <th scope="col" className="col-margin">
              Marge / bt
            </th>
            <th scope="col" className="col-qty">
              Seuil alerte
            </th>
            <th scope="col" className="col-actions">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const margin =
              row.salePrice === null ? null : row.salePrice - row.purchasePrice;
            return (
              <tr
                key={row.id}
                className={row.salePrice === null ? "row-warn" : undefined}
              >
                <td>
                  <NameCell
                    value={row.name}
                    ariaLabel={`Nom boisson ${index + 1}`}
                    onChange={(name) =>
                      onChange(
                        rows.map((r) => (r.id === row.id ? { ...r, name } : r)),
                      )
                    }
                  />
                </td>
                <td className="col-qty">
                  <input
                    className="qty-input"
                    inputMode="numeric"
                    aria-label={`Contenance en bouteilles ${row.name}`}
                    value={row.unitsPerCasier ?? 12}
                    onChange={(e) => {
                      const n = Math.max(
                        1,
                        Math.round(Number(e.target.value.replace(",", ".")) || 12),
                      );
                      onChange(
                        rows.map((r) =>
                          r.id === row.id ? { ...r, unitsPerCasier: n } : r,
                        ),
                      );
                    }}
                  />
                </td>
                <td className="col-price">
                  <PriceInput
                    value={row.purchasePrice}
                    ariaLabel={`Prix d'achat ${row.name}`}
                    onChange={(purchasePrice) =>
                      onChange(
                        rows.map((r) =>
                          r.id === row.id
                            ? { ...r, purchasePrice: purchasePrice ?? 0 }
                            : r,
                        ),
                      )
                    }
                  />
                </td>
                <td className="col-price">
                  <PriceInput
                    value={row.salePrice}
                    allowEmpty
                    placeholder="à saisir"
                    ariaLabel={`Prix de vente ${row.name}`}
                    onChange={(salePrice) =>
                      onChange(
                        rows.map((r) =>
                          r.id === row.id ? { ...r, salePrice } : r,
                        ),
                      )
                    }
                  />
                </td>
                <td className="col-margin mono">
                  {margin === null ? (
                    <span className="muted">—</span>
                  ) : (
                    formatFcfa(margin)
                  )}
                </td>
                <td className="col-qty">
                  <QtyInput
                    value={row.alertThreshold ?? null}
                    allowEmpty
                    placeholder="—"
                    ariaLabel={`Seuil d'alerte ${row.name} (bouteilles)`}
                    onChange={(alertThreshold) =>
                      onChange(
                        rows.map((r) =>
                          r.id === row.id
                            ? { ...r, alertThreshold: alertThreshold ?? 0 }
                            : r,
                        ),
                      )
                    }
                  />
                </td>
                <td className="col-actions">
                  <button
                    type="button"
                    className="btn-icon"
                    aria-label={`Supprimer ${row.name}`}
                    onClick={() =>
                      onChange(rows.filter((r) => r.id !== row.id))
                    }
                  >
                    ×
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button
        type="button"
        className="btn btn-add"
        onClick={() =>
          onChange([
            ...rows,
            {
              id: newId("drink"),
              name: "Nouvelle boisson",
              purchasePrice: 500,
              salePrice: null,
              unitsPerCasier: 12,
            },
          ])
        }
      >
        + Ajouter une boisson
      </button>
    </section>
  );
}

function LocalDishesTable({
  rows,
  onChange,
}: {
  rows: LocalDish[];
  onChange: (rows: LocalDish[]) => void;
}) {
  return (
    <section className="panel">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Désignation</th>
            <th scope="col" className="col-price">
              Prix unitaire
            </th>
            <th scope="col" className="col-price">
              Prix de revient
            </th>
            <th scope="col" className="col-actions">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.id}>
              <td>
                <NameCell
                  value={row.name}
                  ariaLabel={`Nom accompagnement ${index + 1}`}
                  onChange={(name) =>
                    onChange(
                      rows.map((r) => (r.id === row.id ? { ...r, name } : r)),
                    )
                  }
                />
              </td>
              <td className="col-price">
                <PriceInput
                  value={row.unitPrice}
                  ariaLabel={`Prix ${row.name}`}
                  onChange={(unitPrice) =>
                    onChange(
                      rows.map((r) =>
                        r.id === row.id
                          ? { ...r, unitPrice: unitPrice ?? 0 }
                          : r,
                      ),
                    )
                  }
                />
              </td>
              <td className="col-price">
                <PriceInput
                  value={row.costPrice ?? null}
                  allowEmpty
                  ariaLabel={`Revient ${row.name}`}
                  onChange={(costPrice) =>
                    onChange(
                      rows.map((r) =>
                        r.id === row.id
                          ? {
                              ...r,
                              costPrice:
                                costPrice === null ? undefined : costPrice,
                            }
                          : r,
                      ),
                    )
                  }
                />
              </td>
              <td className="col-actions">
                <button
                  type="button"
                  className="btn-icon"
                  aria-label={`Supprimer ${row.name}`}
                  onClick={() => onChange(rows.filter((r) => r.id !== row.id))}
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        className="btn btn-add"
        onClick={() =>
          onChange([
            ...rows,
            { id: newId("local"), name: "Nouvel accompagnement", unitPrice: 500 },
          ])
        }
      >
        + Ajouter un accompagnement
      </button>
    </section>
  );
}

function RawMaterialsTable({
  rows,
  onChange,
}: {
  rows: RawMaterial[];
  onChange: (rows: RawMaterial[]) => void;
}) {
  return (
    <section className="panel">
      <table className="data-table">
        <thead>
          <tr>
            <th>Désignation</th>
            <th>Unité</th>
            <th className="col-price">Prix achat</th>
            <th className="col-num">Seuil</th>
            <th>Bloquant</th>
            <th className="col-actions">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.id}>
              <td>
                <NameCell
                  value={row.name}
                  ariaLabel={`Matière ${index + 1}`}
                  onChange={(name) =>
                    onChange(
                      rows.map((r) => (r.id === row.id ? { ...r, name } : r)),
                    )
                  }
                />
              </td>
              <td>
                <input
                  className="name-input"
                  value={row.unit}
                  onChange={(e) =>
                    onChange(
                      rows.map((r) =>
                        r.id === row.id ? { ...r, unit: e.target.value } : r,
                      ),
                    )
                  }
                  aria-label={`Unité ${row.name}`}
                />
              </td>
              <td className="col-price">
                <PriceInput
                  value={row.purchasePrice}
                  ariaLabel={`Prix achat ${row.name}`}
                  onChange={(purchasePrice) =>
                    onChange(
                      rows.map((r) =>
                        r.id === row.id
                          ? { ...r, purchasePrice: purchasePrice ?? 0 }
                          : r,
                      ),
                    )
                  }
                />
              </td>
              <td className="col-num">
                <input
                  type="number"
                  min={0}
                  className="input-num"
                  value={row.threshold}
                  onChange={(e) =>
                    onChange(
                      rows.map((r) =>
                        r.id === row.id
                          ? { ...r, threshold: Number(e.target.value) || 0 }
                          : r,
                      ),
                    )
                  }
                  aria-label={`Seuil ${row.name}`}
                />
              </td>
              <td>
                <input
                  type="checkbox"
                  checked={row.stockBlocking}
                  onChange={(e) =>
                    onChange(
                      rows.map((r) =>
                        r.id === row.id
                          ? { ...r, stockBlocking: e.target.checked }
                          : r,
                      ),
                    )
                  }
                  aria-label={`Stock bloquant ${row.name}`}
                />
              </td>
              <td className="col-actions">
                <button
                  type="button"
                  className="btn-icon"
                  aria-label={`Supprimer ${row.name}`}
                  onClick={() => onChange(rows.filter((r) => r.id !== row.id))}
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        className="btn btn-add"
        onClick={() =>
          onChange([
            ...rows,
            {
              id: newId("mat"),
              name: "Nouvelle matière",
              unit: "Unité",
              purchasePrice: 0,
              threshold: 0,
              stockBlocking: false,
            },
          ])
        }
      >
        + Ajouter une matière
      </button>
    </section>
  );
}

function RecipesTable({
  recipes,
  materials,
  products,
  onChange,
}: {
  recipes: Recipe[];
  materials: RawMaterial[];
  products: { id: string; name: string }[];
  onChange: (recipes: Recipe[]) => void;
}) {
  function upsertRecipe(productId: string, lines: Recipe["lines"]) {
    const others = recipes.filter((r) => r.productId !== productId);
    if (!lines.length) {
      onChange(others);
      return;
    }
    onChange([...others, { productId, lines }]);
  }

  return (
    <section className="panel stack-form">
      {products.length === 0 ? (
        <p className="muted">Aucun produit catalogue.</p>
      ) : (
        products.map((p) => {
          const recipe = recipes.find((r) => r.productId === p.id);
          const lines = recipe?.lines ?? [];
          return (
            <div key={p.id} className="recipe-block">
              <h3 className="panel-title">{p.name}</h3>
              {lines.map((line, i) => (
                <div key={`${p.id}-${i}`} className="recipe-line">
                  <select
                    className="select-input"
                    value={line.rawMaterialId}
                    onChange={(e) => {
                      const next = lines.map((l, idx) =>
                        idx === i
                          ? { ...l, rawMaterialId: e.target.value }
                          : l,
                      );
                      upsertRecipe(p.id, next);
                    }}
                  >
                    <option value="">— Matière —</option>
                    {materials.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    className="input-num"
                    value={line.qty}
                    onChange={(e) => {
                      const next = lines.map((l, idx) =>
                        idx === i
                          ? { ...l, qty: Number(e.target.value) || 0 }
                          : l,
                      );
                      upsertRecipe(p.id, next);
                    }}
                    aria-label={`Qty ${p.name}`}
                  />
                  <button
                    type="button"
                    className="btn-icon"
                    aria-label="Retirer ligne"
                    onClick={() =>
                      upsertRecipe(
                        p.id,
                        lines.filter((_, idx) => idx !== i),
                      )
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="btn btn-add"
                disabled={materials.length === 0}
                onClick={() =>
                  upsertRecipe(p.id, [
                    ...lines,
                    {
                      rawMaterialId: materials[0]?.id ?? "",
                      qty: 1,
                    },
                  ])
                }
              >
                + Ligne matière
              </button>
            </div>
          );
        })
      )}
    </section>
  );
}
