"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ExportExcelButton } from "@/components/export-excel-button";
import { PriceInput } from "@/components/parametres/price-input";
import { ProductIcon } from "@/components/product-icon";
import { QtyInput } from "@/components/qty-input";
import { useSession } from "@/components/session-provider";
import { roleSiteLabel } from "@/lib/auth-types";
import { formatFcfa, formatUpdatedAt, newId } from "@/lib/format";
import { exportParametresExcel } from "@/lib/page-exports";
import type { BaseDish, Drink, LocalDish, Parametres } from "@/lib/types";

import "./parametres-catalogue.css";

const PAGE_SIZE = 6;

const CATALOGUE_SECTIONS: {
  key: CatalogueSectionKey;
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
    hint: "Riz, telibo, piron… — catalogue partagé, vendus seuls ou avec un plat.",
  },
  {
    key: "drinks",
    label: "Boissons",
    hint: "Catalogue boissons (partagé) — stock et ventes en bouteilles.",
  },
];

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

export function CataloguePaginationBar({
  from,
  to,
  total,
  page,
  totalPages,
  onPage,
  itemLabel = "produit",
}: {
  from: number;
  to: number;
  total: number;
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
  itemLabel?: string;
}) {
  const pages = useMemo(() => {
    const max = 5;
    if (totalPages <= max) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    const start = Math.max(1, Math.min(page - 2, totalPages - max + 1));
    return Array.from({ length: max }, (_, i) => start + i);
  }, [page, totalPages]);

  if (total === 0) return null;

  return (
    <div className="catalogue-footer">
      <p className="catalogue-meta">
        Affichage de <strong>{from}</strong> à <strong>{to}</strong> sur{" "}
        <strong>{total}</strong> {itemLabel}
        {total > 1 ? "s" : ""}
      </p>
      <div className="catalogue-pagination" role="navigation" aria-label="Pagination">
        <button
          type="button"
          className="catalogue-page-btn"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          aria-label="Page précédente"
        >
          ‹
        </button>
        {pages.map((p) => (
          <button
            key={p}
            type="button"
            className={`catalogue-page-btn${p === page ? " is-active" : ""}`}
            onClick={() => onPage(p)}
            aria-current={p === page ? "page" : undefined}
          >
            {p}
          </button>
        ))}
        <button
          type="button"
          className="catalogue-page-btn"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
          aria-label="Page suivante"
        >
          ›
        </button>
      </div>
    </div>
  );
}

function IconEdit() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0 0-3L16.5 4.5a2.1 2.1 0 0 0-3 0L4 14v6Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <path d="m13.5 6.5 4 4" stroke="currentColor" strokeWidth="1.75" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0v12a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V7h10Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconSearch() {
  return <span className="catalogue-search-icon" aria-hidden>⌕</span>;
}

function IconFilter() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 6h16M7 12h10M10 18h4"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function CatalogueSkeleton() {
  return (
    <div className="catalogue-panel" aria-busy="true" aria-label="Chargement">
      <div className="catalogue-skeleton">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className={`catalogue-skeleton-line${i === 0 ? " short" : ""}`}
          />
        ))}
      </div>
    </div>
  );
}

function ProductPriceTable<T extends { id: string; name: string }>({
  rows,
  kind,
  ready,
  search,
  onSearchChange,
  page,
  onPageChange,
  renderPrices,
  renderMobilePrices,
  onEditName,
  onDelete,
  editingId,
  onEditingId,
  addLabel,
  onAdd,
}: {
  rows: T[];
  kind: "base" | "local";
  ready: boolean;
  search: string;
  onSearchChange: (v: string) => void;
  page: number;
  onPageChange: (p: number) => void;
  renderPrices: (row: T, editing: boolean) => ReactNode;
  renderMobilePrices: (row: T, editing: boolean) => ReactNode;
  onEditName: (row: T, name: string) => void;
  onDelete: (id: string) => void;
  editingId: string | null;
  onEditingId: (id: string | null) => void;
  addLabel: string;
  onAdd: () => void;
}) {
  const debouncedSearch = useDebouncedValue(search);
  const filtered = useMemo(
    () => rows.filter((r) => matchesSearch(r.name, debouncedSearch)),
    [rows, debouncedSearch],
  );
  const paged = paginate(filtered, page, PAGE_SIZE);

  useEffect(() => {
    onPageChange(1);
  }, [debouncedSearch, onPageChange]);

  if (!ready) return <CatalogueSkeleton />;

  return (
    <section className="catalogue-panel">
      <div className="catalogue-toolbar">
        <div className="catalogue-search-wrap">
          <IconSearch />
          <input
            type="search"
            className="catalogue-search"
            placeholder="Rechercher un produit…"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            aria-label="Rechercher un produit"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="catalogue-empty">
          <p className="catalogue-empty-title">Aucun produit trouvé</p>
          <p className="catalogue-empty-hint">
            Modifiez votre recherche ou ajoutez un produit.
          </p>
        </div>
      ) : (
        <>
          <div className="catalogue-table-wrap">
            <table className="catalogue-table">
              <thead>
                <tr>
                  <th scope="col">Désignation</th>
                  <th scope="col">Prix unitaire</th>
                  <th scope="col">Prix de revient</th>
                  <th scope="col" className="col-actions">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {paged.items.map((row) => {
                  const editing = editingId === row.id;
                  return (
                    <tr key={row.id}>
                      <td>
                        <div className="catalogue-product-cell">
                          <ProductIcon
                            kind={kind === "base" ? "base" : "local"}
                            name={row.name}
                            size="md"
                          />
                          <div className="catalogue-product-name">
                            {editing ? (
                              <input
                                className="name-input"
                                value={row.name}
                                aria-label={`Nom ${row.name}`}
                                onChange={(e) =>
                                  onEditName(row, e.target.value)
                                }
                                autoFocus
                              />
                            ) : (
                              row.name
                            )}
                          </div>
                        </div>
                      </td>
                      {renderPrices(row, editing)}
                      <td className="col-actions">
                        <div className="catalogue-row-actions">
                          <button
                            type="button"
                            className={`catalogue-action-btn${editing ? " is-active" : ""}`}
                            aria-label={`Modifier ${row.name}`}
                            onClick={() =>
                              onEditingId(editing ? null : row.id)
                            }
                          >
                            <IconEdit />
                          </button>
                          <button
                            type="button"
                            className="catalogue-action-btn is-danger"
                            aria-label={`Supprimer ${row.name}`}
                            onClick={() => onDelete(row.id)}
                          >
                            <IconTrash />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="catalogue-mobile-list">
            {paged.items.map((row) => {
              const editing = editingId === row.id;
              return (
                <article key={row.id} className="catalogue-mobile-card">
                  <div className="catalogue-mobile-card-head">
                    <ProductIcon
                      kind={kind === "base" ? "base" : "local"}
                      name={row.name}
                      size="lg"
                    />
                    <div className="catalogue-product-name" style={{ flex: 1 }}>
                      {editing ? (
                        <input
                          className="name-input"
                          value={row.name}
                          aria-label={`Nom ${row.name}`}
                          onChange={(e) => onEditName(row, e.target.value)}
                        />
                      ) : (
                        row.name
                      )}
                    </div>
                  </div>
                  <div className="catalogue-mobile-card-prices">
                    {renderMobilePrices(row, editing)}
                  </div>
                  <div className="catalogue-mobile-card-actions">
                    <button
                      type="button"
                      className={`catalogue-action-btn${editing ? " is-active" : ""}`}
                      aria-label={`Modifier ${row.name}`}
                      onClick={() => onEditingId(editing ? null : row.id)}
                    >
                      <IconEdit />
                    </button>
                    <button
                      type="button"
                      className="catalogue-action-btn is-danger"
                      aria-label={`Supprimer ${row.name}`}
                      onClick={() => onDelete(row.id)}
                    >
                      <IconTrash />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          <CataloguePaginationBar
            from={paged.from}
            to={paged.to}
            total={paged.total}
            page={paged.page}
            totalPages={paged.totalPages}
            onPage={onPageChange}
          />
        </>
      )}

      <div className="catalogue-add-row">
        <button type="button" className="btn btn-add" onClick={onAdd}>
          + {addLabel}
        </button>
      </div>
    </section>
  );
}

function BaseDishesCatalogue({
  rows,
  ready,
  onChange,
}: {
  rows: BaseDish[];
  ready: boolean;
  onChange: (rows: BaseDish[]) => void;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [editingId, setEditingId] = useState<string | null>(null);
  const onPageChange = useCallback((p: number) => setPage(p), []);

  const renderPriceCells = (row: BaseDish, editing: boolean) => (
    <>
      <td>
        {editing ? (
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
        ) : (
          <span className="catalogue-price-badge catalogue-price-badge-sale">
            {formatFcfa(row.unitPrice)}
          </span>
        )}
      </td>
      <td>
        {editing ? (
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
        ) : (
          <span className="catalogue-price-badge catalogue-price-badge-cost">
            {formatFcfa(row.costPrice ?? 0)}
          </span>
        )}
      </td>
    </>
  );

  const renderMobilePrices = (row: BaseDish, editing: boolean) => (
    <>
      <div>
        <span className="catalogue-mobile-price-label">Prix unitaire</span>
        {editing ? (
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
        ) : (
          <span className="catalogue-price-badge catalogue-price-badge-sale">
            {formatFcfa(row.unitPrice)}
          </span>
        )}
      </div>
      <div>
        <span className="catalogue-mobile-price-label">Prix de revient</span>
        {editing ? (
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
        ) : (
          <span className="catalogue-price-badge catalogue-price-badge-cost">
            {formatFcfa(row.costPrice ?? 0)}
          </span>
        )}
      </div>
    </>
  );

  return (
    <ProductPriceTable
      rows={rows}
      kind="base"
      ready={ready}
      search={search}
      onSearchChange={setSearch}
      page={page}
      onPageChange={onPageChange}
      renderPrices={renderPriceCells}
      renderMobilePrices={renderMobilePrices}
      onEditName={(row, name) =>
        onChange(rows.map((r) => (r.id === row.id ? { ...r, name } : r)))
      }
      onDelete={(id) => onChange(rows.filter((r) => r.id !== id))}
      editingId={editingId}
      onEditingId={setEditingId}
      addLabel="Ajouter un plat de base"
      onAdd={() =>
        onChange([
          ...rows,
          { id: newId("base"), name: "Nouveau plat", unitPrice: 1500 },
        ])
      }
    />
  );
}

function LocalDishesCatalogue({
  rows,
  ready,
  onChange,
}: {
  rows: LocalDish[];
  ready: boolean;
  onChange: (rows: LocalDish[]) => void;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [editingId, setEditingId] = useState<string | null>(null);
  const onPageChange = useCallback((p: number) => setPage(p), []);

  const renderPriceCells = (row: LocalDish, editing: boolean) => (
    <>
      <td>
        {editing ? (
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
        ) : (
          <span className="catalogue-price-badge catalogue-price-badge-sale">
            {formatFcfa(row.unitPrice)}
          </span>
        )}
      </td>
      <td>
        {editing ? (
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
        ) : (
          <span className="catalogue-price-badge catalogue-price-badge-cost">
            {formatFcfa(row.costPrice ?? 0)}
          </span>
        )}
      </td>
    </>
  );

  const renderMobilePrices = (row: LocalDish, editing: boolean) => (
    <>
      <div>
        <span className="catalogue-mobile-price-label">Prix unitaire</span>
        {editing ? (
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
        ) : (
          <span className="catalogue-price-badge catalogue-price-badge-sale">
            {formatFcfa(row.unitPrice)}
          </span>
        )}
      </div>
      <div>
        <span className="catalogue-mobile-price-label">Prix de revient</span>
        {editing ? (
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
        ) : (
          <span className="catalogue-price-badge catalogue-price-badge-cost">
            {formatFcfa(row.costPrice ?? 0)}
          </span>
        )}
      </div>
    </>
  );

  return (
    <ProductPriceTable
      rows={rows}
      kind="local"
      ready={ready}
      search={search}
      onSearchChange={setSearch}
      page={page}
      onPageChange={onPageChange}
      renderPrices={renderPriceCells}
      renderMobilePrices={renderMobilePrices}
      onEditName={(row, name) =>
        onChange(rows.map((r) => (r.id === row.id ? { ...r, name } : r)))
      }
      onDelete={(id) => onChange(rows.filter((r) => r.id !== id))}
      editingId={editingId}
      onEditingId={setEditingId}
      addLabel="Ajouter un accompagnement"
      onAdd={() =>
        onChange([
          ...rows,
          { id: newId("local"), name: "Nouvel accompagnement", unitPrice: 500 },
        ])
      }
    />
  );
}

function DrinksCatalogue({
  rows,
  ready,
  onChange,
}: {
  rows: Drink[];
  ready: boolean;
  onChange: (rows: Drink[]) => void;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [filterNoPrice, setFilterNoPrice] = useState(false);
  const debouncedSearch = useDebouncedValue(search);
  const onPageChange = useCallback((p: number) => setPage(p), []);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (filterNoPrice && r.salePrice !== null) return false;
      return matchesSearch(r.name, debouncedSearch);
    });
  }, [rows, debouncedSearch, filterNoPrice]);

  const paged = paginate(filtered, page, PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, filterNoPrice]);

  if (!ready) return <CatalogueSkeleton />;

  return (
    <section className="catalogue-panel">
      <p className="catalogue-drinks-hint">
        Le stock et les achats se comptent en <strong>bouteilles</strong>.
        Indiquez la contenance du carton de livraison pour les conversions.
      </p>

      <div className="catalogue-toolbar">
        <div className="catalogue-search-wrap">
          <IconSearch />
          <input
            type="search"
            className="catalogue-search"
            placeholder="Rechercher une boisson…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Rechercher une boisson"
          />
        </div>
        <button
          type="button"
          className={`catalogue-filter-btn${filterNoPrice ? " is-active" : ""}`}
          onClick={() => setFilterNoPrice((v) => !v)}
          aria-pressed={filterNoPrice}
        >
          <IconFilter />
          Sans prix de vente
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="catalogue-empty">
          <p className="catalogue-empty-title">Aucune boisson trouvée</p>
          <p className="catalogue-empty-hint">
            Modifiez votre recherche ou vos filtres.
          </p>
        </div>
      ) : (
        <>
          <div className="catalogue-table-wrap">
            <table className="catalogue-table">
              <thead>
                <tr>
                  <th scope="col">Boisson</th>
                  <th scope="col">Contenance (bt)</th>
                  <th scope="col">PA / bouteille</th>
                  <th scope="col">PV / bouteille</th>
                  <th scope="col">Marge / bt</th>
                  <th scope="col">Seuil alerte</th>
                  <th scope="col" className="col-actions">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {paged.items.map((row, index) => {
                  const editing = editingId === row.id;
                  const margin =
                    row.salePrice === null
                      ? null
                      : row.salePrice - row.purchasePrice;
                  return (
                    <tr
                      key={row.id}
                      className={row.salePrice === null ? "row-warn" : undefined}
                    >
                      <td>
                        <div className="catalogue-product-cell">
                          <ProductIcon kind="boisson" name={row.name} size="md" />
                          <div className="catalogue-product-name">
                            {editing ? (
                              <input
                                className="name-input"
                                value={row.name}
                                aria-label={`Nom boisson ${index + 1}`}
                                onChange={(e) =>
                                  onChange(
                                    rows.map((r) =>
                                      r.id === row.id
                                        ? { ...r, name: e.target.value }
                                        : r,
                                    ),
                                  )
                                }
                                autoFocus
                              />
                            ) : (
                              row.name
                            )}
                          </div>
                        </div>
                      </td>
                      <td>
                        {editing ? (
                          <input
                            className="qty-input"
                            inputMode="numeric"
                            aria-label={`Contenance ${row.name}`}
                            value={row.unitsPerCasier ?? 12}
                            onChange={(e) => {
                              const n = Math.max(
                                1,
                                Math.round(
                                  Number(e.target.value.replace(",", ".")) ||
                                    12,
                                ),
                              );
                              onChange(
                                rows.map((r) =>
                                  r.id === row.id
                                    ? { ...r, unitsPerCasier: n }
                                    : r,
                                ),
                              );
                            }}
                          />
                        ) : (
                          row.unitsPerCasier ?? 12
                        )}
                      </td>
                      <td>
                        {editing ? (
                          <PriceInput
                            value={row.purchasePrice}
                            ariaLabel={`Prix d'achat ${row.name}`}
                            onChange={(purchasePrice) =>
                              onChange(
                                rows.map((r) =>
                                  r.id === row.id
                                    ? {
                                        ...r,
                                        purchasePrice: purchasePrice ?? 0,
                                      }
                                    : r,
                                ),
                              )
                            }
                          />
                        ) : (
                          <span className="catalogue-price-badge catalogue-price-badge-cost">
                            {formatFcfa(row.purchasePrice)}
                          </span>
                        )}
                      </td>
                      <td>
                        {editing ? (
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
                        ) : row.salePrice === null ? (
                          <span className="catalogue-price-badge catalogue-price-badge-warn">
                            À saisir
                          </span>
                        ) : (
                          <span className="catalogue-price-badge catalogue-price-badge-sale">
                            {formatFcfa(row.salePrice)}
                          </span>
                        )}
                      </td>
                      <td className="mono">
                        {margin === null ? (
                          <span className="muted">—</span>
                        ) : (
                          formatFcfa(margin)
                        )}
                      </td>
                      <td>
                        {editing ? (
                          <QtyInput
                            value={row.alertThreshold ?? null}
                            allowEmpty
                            placeholder="—"
                            ariaLabel={`Seuil ${row.name}`}
                            onChange={(alertThreshold) =>
                              onChange(
                                rows.map((r) =>
                                  r.id === row.id
                                    ? {
                                        ...r,
                                        alertThreshold: alertThreshold ?? 0,
                                      }
                                    : r,
                                ),
                              )
                            }
                          />
                        ) : (
                          (row.alertThreshold ?? "—")
                        )}
                      </td>
                      <td className="col-actions">
                        <div className="catalogue-row-actions">
                          <button
                            type="button"
                            className={`catalogue-action-btn${editing ? " is-active" : ""}`}
                            aria-label={`Modifier ${row.name}`}
                            onClick={() =>
                              setEditingId(editing ? null : row.id)
                            }
                          >
                            <IconEdit />
                          </button>
                          <button
                            type="button"
                            className="catalogue-action-btn is-danger"
                            aria-label={`Supprimer ${row.name}`}
                            onClick={() =>
                              onChange(rows.filter((r) => r.id !== row.id))
                            }
                          >
                            <IconTrash />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="catalogue-mobile-list">
            {paged.items.map((row, index) => {
              const editing = editingId === row.id;
              const margin =
                row.salePrice === null
                  ? null
                  : row.salePrice - row.purchasePrice;
              return (
                <article
                  key={row.id}
                  className={`catalogue-mobile-card${row.salePrice === null ? " is-warn" : ""}`}
                >
                  <div className="catalogue-mobile-card-head">
                    <ProductIcon kind="boisson" name={row.name} size="lg" />
                    <div className="catalogue-product-name" style={{ flex: 1 }}>
                      {editing ? (
                        <input
                          className="name-input"
                          value={row.name}
                          aria-label={`Nom boisson ${index + 1}`}
                          onChange={(e) =>
                            onChange(
                              rows.map((r) =>
                                r.id === row.id
                                  ? { ...r, name: e.target.value }
                                  : r,
                              ),
                            )
                          }
                        />
                      ) : (
                        row.name
                      )}
                    </div>
                  </div>
                  <div className="catalogue-mobile-card-prices">
                    <div>
                      <span className="catalogue-mobile-price-label">PV</span>
                      {editing ? (
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
                      ) : row.salePrice === null ? (
                        <span className="catalogue-price-badge catalogue-price-badge-warn">
                          À saisir
                        </span>
                      ) : (
                        <span className="catalogue-price-badge catalogue-price-badge-sale">
                          {formatFcfa(row.salePrice)}
                        </span>
                      )}
                    </div>
                    <div>
                      <span className="catalogue-mobile-price-label">PA</span>
                      {editing ? (
                        <PriceInput
                          value={row.purchasePrice}
                          ariaLabel={`Prix d'achat ${row.name}`}
                          onChange={(purchasePrice) =>
                            onChange(
                              rows.map((r) =>
                                r.id === row.id
                                  ? {
                                      ...r,
                                      purchasePrice: purchasePrice ?? 0,
                                    }
                                  : r,
                              ),
                            )
                          }
                        />
                      ) : (
                        <span className="catalogue-price-badge catalogue-price-badge-cost">
                          {formatFcfa(row.purchasePrice)}
                        </span>
                      )}
                    </div>
                    <div>
                      <span className="catalogue-mobile-price-label">Marge</span>
                      <span className="mono">
                        {margin === null ? "—" : formatFcfa(margin)}
                      </span>
                    </div>
                    <div>
                      <span className="catalogue-mobile-price-label">
                        Contenance
                      </span>
                      <span>{row.unitsPerCasier ?? 12} bt</span>
                    </div>
                  </div>
                  <div className="catalogue-mobile-card-actions">
                    <button
                      type="button"
                      className={`catalogue-action-btn${editing ? " is-active" : ""}`}
                      aria-label={`Modifier ${row.name}`}
                      onClick={() => setEditingId(editing ? null : row.id)}
                    >
                      <IconEdit />
                    </button>
                    <button
                      type="button"
                      className="catalogue-action-btn is-danger"
                      aria-label={`Supprimer ${row.name}`}
                      onClick={() =>
                        onChange(rows.filter((r) => r.id !== row.id))
                      }
                    >
                      <IconTrash />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          <CataloguePaginationBar
            from={paged.from}
            to={paged.to}
            total={paged.total}
            page={paged.page}
            totalPages={paged.totalPages}
            onPage={onPageChange}
          />
        </>
      )}

      <div className="catalogue-add-row">
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
      </div>
    </section>
  );
}

export type CatalogueSectionKey = "base" | "accompagnements" | "drinks";

export function CatalogueView({
  data,
  ready,
  saving,
  dirty,
  savedFlash,
  error,
  catalogueSection,
  onCatalogueSectionChange,
  onUpdate,
  onSave,
  onReset,
  drinksWithoutPrice,
  onRetry,
}: {
  data: Parametres;
  ready: boolean;
  saving: boolean;
  dirty: boolean;
  savedFlash: boolean;
  error: string | null;
  catalogueSection: CatalogueSectionKey;
  onCatalogueSectionChange: (key: CatalogueSectionKey) => void;
  onUpdate: (next: Parametres) => void;
  onSave: () => void;
  onReset: () => void;
  drinksWithoutPrice: string[];
  onRetry?: () => void;
}) {
  const { user } = useSession();

  const sectionHint =
    CATALOGUE_SECTIONS.find((s) => s.key === catalogueSection)?.hint ?? "";

  const initials = user?.name
    ? user.name
        .split(/\s+/)
        .slice(0, 2)
        .map((p) => p[0]?.toUpperCase() ?? "")
        .join("")
    : "·";

  const counts = {
    base: data.baseDishes.length,
    accompagnements: data.localDishes.length,
    drinks: data.drinks.length,
  };

  return (
    <div className="catalogue-view">
      <div className="catalogue-view-top">
        <p className="catalogue-meta">
          <span className="catalogue-meta-icon" aria-hidden>
            ⏱
          </span>
          Dernière sauvegarde :{" "}
          <strong>{ready ? formatUpdatedAt(data.updatedAt) : "…"}</strong>
        </p>

        <div className="catalogue-view-top-actions">
          <div className="catalogue-view-actions">
            {user ? (
              <div className="catalogue-user-chip">
                <span className="user-avatar" aria-hidden>
                  {initials}
                </span>
                <span className="user-meta">
                  <span className="user-name">{user.name}</span>
                  <span className="user-role">
                    {roleSiteLabel(user.role, user.site)}
                  </span>
                </span>
              </div>
            ) : null}
            <ExportExcelButton
              onExport={() => exportParametresExcel(data)}
              disabled={!ready}
              className="btn btn-ghost"
            />
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onReset}
              disabled={saving}
            >
              Réinitialiser
            </button>
            <button
              type="button"
              className={`btn btn-primary${savedFlash && !dirty ? " btn-saved" : ""}`}
              onClick={onSave}
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
        </div>
      </div>

      {drinksWithoutPrice.length > 0 ? (
        <button
          type="button"
          className="catalogue-alert catalogue-alert-danger is-clickable"
          role="alert"
          onClick={() => onCatalogueSectionChange("drinks")}
        >
          <span className="catalogue-alert-icon" aria-hidden>
            !
          </span>
          <span>
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
            . Sans prix de vente, leur carte reste grisée sur la page Vente.
            Renseignez le prix dans l&apos;onglet Boissons.
          </span>
          <span className="catalogue-alert-chevron" aria-hidden>
            ›
          </span>
        </button>
      ) : null}

      {error ? (
        <div className="catalogue-alert catalogue-alert-danger" role="alert">
          <span className="catalogue-alert-icon" aria-hidden>
            !
          </span>
          <span>
            {error}
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
      ) : null}

      <div
        className="catalogue-section-tabs"
        role="tablist"
        aria-label="Catalogue"
      >
        {CATALOGUE_SECTIONS.map((s) => (
          <button
            key={s.key}
            type="button"
            role="tab"
            aria-selected={catalogueSection === s.key}
            className={`catalogue-section-tab${catalogueSection === s.key ? " is-active" : ""}`}
            onClick={() => onCatalogueSectionChange(s.key)}
          >
            {s.label}
            <span className="section-count">{counts[s.key]}</span>
          </button>
        ))}
      </div>

      <div className="catalogue-info" role="note">
        <span className="catalogue-info-mark" aria-hidden>
          i
        </span>
        <p>{sectionHint}</p>
      </div>

      {catalogueSection === "base" ? (
        <BaseDishesCatalogue
          rows={data.baseDishes}
          ready={ready}
          onChange={(baseDishes) => onUpdate({ ...data, baseDishes })}
        />
      ) : null}

      {catalogueSection === "accompagnements" ? (
        <LocalDishesCatalogue
          rows={data.localDishes}
          ready={ready}
          onChange={(localDishes) => onUpdate({ ...data, localDishes })}
        />
      ) : null}

      {catalogueSection === "drinks" ? (
        <DrinksCatalogue
          rows={data.drinks}
          ready={ready}
          onChange={(drinks) => onUpdate({ ...data, drinks })}
        />
      ) : null}
    </div>
  );
}
