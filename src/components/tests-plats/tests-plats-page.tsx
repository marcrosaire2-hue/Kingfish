"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import "@/components/vente/vente-pos.css";
import { AppShell } from "@/components/app-shell";
import { BrandLoader } from "@/components/brand-loader";
import { ContextBar } from "@/components/context-bar";
import { ExportExcelButton } from "@/components/export-excel-button";
import { ProductIcon } from "@/components/product-icon";
import { RegistreDrawer } from "@/components/registre-drawer";
import {
  CartLines,
  MealComposer,
  ProductGrid,
} from "@/components/vente/vente-page";
import { formatFcfa } from "@/lib/format";
import { exportTestsPlatsExcel } from "@/lib/page-exports";
import type {
  TestPlatEntry,
  TestPlatKind,
  TestPlatProduct,
} from "@/lib/tests-plats-types";
import type { VenteProduct, VenteSite } from "@/lib/types";
import { previousIsoDate, shiftIsoDate, todayIsoDate } from "@/lib/zogbo-calc";

/** Même forme que les lignes du panier de la page Vente (unitPrice = coût matière). */
type CartLine = {
  key: string;
  kind: TestPlatKind;
  productId: string;
  name: string;
  unitPrice: number;
  qty: number;
};

/** Un produit de test présenté comme un article de vente : le prix affiché est le prix de revient. */
function enArticle(p: TestPlatProduct): VenteProduct {
  return {
    kind: p.kind,
    productId: p.productId,
    name: p.name,
    unitPrice: p.unitCost,
    soldToday: 0,
    stockLeft: null,
  };
}

const CATS: { key: TestPlatKind; label: string; short: string; icon: string }[] =
  [
    { key: "plat", label: "Plats", short: "Plats", icon: "Plat" },
    { key: "local", label: "Accompagnements", short: "Acc.", icon: "Accompagnement" },
    { key: "boisson", label: "Boissons", short: "Boissons", icon: "Boisson" },
  ];

const SITE_LABEL: Record<VenteSite, string> = {
  zogbo: "Zogbo",
  gbegamey: "Gbégamey",
};

const TIME_FORMAT = new Intl.DateTimeFormat("fr-FR", {
  timeStyle: "short",
  timeZone: "Africa/Porto-Novo",
});

function heure(iso: string): string {
  try {
    return TIME_FORMAT.format(new Date(iso));
  } catch {
    return iso;
  }
}

export function TestsPlatsPage() {
  const [date, setDate] = useState(todayIsoDate());
  const [site, setSite] = useState<VenteSite>("zogbo");
  const [allowedSites, setAllowedSites] = useState<VenteSite[]>([]);
  const [products, setProducts] = useState<TestPlatProduct[]>([]);
  const [tests, setTests] = useState<TestPlatEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [cat, setCat] = useState<TestPlatKind>("plat");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [objet, setObjet] = useState("");
  const [testeur, setTesteur] = useState("");
  const [observations, setObservations] = useState("");
  const [cartSheetOpen, setCartSheetOpen] = useState(false);
  const [journalOpen, setJournalOpen] = useState(false);
  const [composerPlatId, setComposerPlatId] = useState("");
  const [composerQty, setComposerQty] = useState(1);
  const [composerAccQtys, setComposerAccQtys] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/tests-plats?date=${date}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Chargement impossible");
      setProducts(data.products);
      setTests(data.tests);
      const sites: VenteSite[] = data.allowedSites ?? [];
      setAllowedSites(sites);
      setSite((s) => (sites.length && !sites.includes(s) ? sites[0] : s));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chargement impossible");
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleTests = useMemo(
    () => tests.filter((t) => t.site === site),
    [tests, site],
  );
  const activeTests = visibleTests.filter((t) => !t.cancelledAt);
  const dayCost = activeTests.reduce((s, t) => s + t.cost, 0);

  const counts = useMemo(() => {
    const c: Record<TestPlatKind, number> = { plat: 0, local: 0, boisson: 0 };
    for (const p of products) c[p.kind] += 1;
    return c;
  }, [products]);

  const cartCount = cart.reduce((s, l) => s + l.qty, 0);
  const cartCost = cart.reduce((s, l) => s + l.qty * l.unitPrice, 0);

  const articles = useMemo(() => products.map(enArticle), [products]);
  const gridProducts = useMemo(
    () => articles.filter((a) => a.kind === cat),
    [articles, cat],
  );
  const plats = useMemo(
    () => articles.filter((a) => a.kind === "plat"),
    [articles],
  );
  const accompagnements = useMemo(
    () => articles.filter((a) => a.kind === "local"),
    [articles],
  );
  const composerPlat = useMemo(
    () => plats.find((p) => p.productId === composerPlatId) ?? null,
    [plats, composerPlatId],
  );
  const composerTotal = composerPlat
    ? composerPlat.unitPrice * composerQty +
      accompagnements.reduce(
        (s, a) => s + a.unitPrice * (composerAccQtys[a.productId] ?? 0),
        0,
      )
    : 0;

  function changeQty(key: string, delta: number) {
    const next = cart
      .map((l) => (l.key === key ? { ...l, qty: l.qty + delta } : l))
      .filter((l) => l.qty > 0);
    setCart(next);
    if (!next.length) setCartSheetOpen(false);
  }

  function addToCart(a: VenteProduct, qty = 1) {
    const key = `${a.kind}-${a.productId}`;
    setFlash(null);
    setCart((cur) =>
      cur.some((l) => l.key === key)
        ? cur.map((l) => (l.key === key ? { ...l, qty: l.qty + qty } : l))
        : [
            ...cur,
            {
              key,
              kind: a.kind as TestPlatKind,
              productId: a.productId,
              name: a.name,
              unitPrice: a.unitPrice,
              qty,
            },
          ],
    );
  }

  function selectPlat(id: string) {
    setComposerPlatId(id);
    setComposerQty(1);
    setComposerAccQtys({});
  }

  function commitMeal() {
    if (!composerPlat) {
      setError("Choisissez un plat.");
      return;
    }
    addToCart(composerPlat, composerQty);
    for (const a of accompagnements) {
      const qty = composerAccQtys[a.productId] ?? 0;
      if (qty > 0) addToCart(a, qty);
    }
    selectPlat("");
    setError(null);
  }

  async function validate() {
    if (!cart.length || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tests-plats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          date,
          site,
          lines: cart.map((l) => ({
            kind: l.kind,
            productId: l.productId,
            qty: l.qty,
          })),
          objet,
          testeur,
          observations,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Enregistrement impossible");
      setFlash(`Test ${data.entry.numero} enregistré (hors ventes).`);
      setCart([]);
      setObjet("");
      setTesteur("");
      setObservations("");
      setCartSheetOpen(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible");
    } finally {
      setBusy(false);
    }
  }

  async function cancel(t: TestPlatEntry) {
    if (busy || !window.confirm(`Annuler le test ${t.numero} ?`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tests-plats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel", id: t.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Annulation impossible");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Annulation impossible");
    } finally {
      setBusy(false);
    }
  }

  const siteLabel = SITE_LABEL[site];

  return (
    <AppShell
      title="Tests de plats"
      subtitle={`${siteLabel} · essais et dégustations · hors ventes`}
      mainClassName="main-vente"
    >
      <div
        className={`vente-page${cart.length ? " has-mobile-cart" : ""}${
          cartSheetOpen ? " is-cart-open" : ""
        }`}
      >
        <header className="vente-banner">
          <span className="vente-banner-ico" aria-hidden>
            <svg viewBox="0 0 24 24" focusable="false">
              <path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3M8 15h8" />
            </svg>
          </span>
          <div className="vente-banner-copy">
            <h2>Tests de plats</h2>
            <p>{`${siteLabel} · panier multi-articles · hors ventes`}</p>
          </div>
          <svg className="vente-banner-art" viewBox="0 0 120 80" aria-hidden focusable="false">
            <rect x="14" y="48" width="16" height="26" rx="3" fill="#1d6fd6" />
            <rect x="40" y="34" width="16" height="40" rx="3" fill="#2a7ec8" />
            <rect x="66" y="20" width="16" height="54" rx="3" fill="#075ea8" />
            <path d="M12 38 44 20l22 8 36-22" fill="none" stroke="#f5b400" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </header>

        <div className="vente-context-wrap">
          <ContextBar
            date={date}
            onDateChange={(v) => {
              setFlash(null);
              setDate(v);
            }}
            siteLabel={siteLabel}
          >
            <div className="vente-date-stepper" role="group" aria-label="Changer de jour">
              <button
                type="button"
                className="btn btn-ghost"
                title="Jour précédent"
                onClick={() => {
                  const prev = previousIsoDate(date);
                  if (prev) setDate(prev);
                }}
              >
                ←
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                title="Jour suivant"
                disabled={date >= todayIsoDate()}
                onClick={() => {
                  const next = shiftIsoDate(date, 1);
                  if (next && next <= todayIsoDate()) setDate(next);
                }}
              >
                →
              </button>
            </div>
            <ExportExcelButton
              onExport={() =>
                exportTestsPlatsExcel({ date, site, tests: visibleTests })
              }
              disabled={loading}
            />
            <button
              type="button"
              className="btn btn-ghost vente-journal-btn"
              onClick={() => setJournalOpen(true)}
            >
              Journal ({visibleTests.length})
            </button>
          </ContextBar>
        </div>

        <section className="vente-cash-card is-open" aria-label="Récapitulatif des tests">
          <div className="vente-cash-card-body">
            <span className="vente-cash-badge">
              <span className="vente-cash-badge-dot" aria-hidden />
              Hors ventes — aucun encaissement
            </span>
            <p className="vente-cash-site">Tests {siteLabel}</p>
            <p className="vente-cash-amount mono">
              {loading && !tests.length ? "…" : activeTests.length}
            </p>
            <p className="vente-cash-meta">
              test{activeTests.length > 1 ? "s" : ""} du jour · coût matière{" "}
              {formatFcfa(dayCost)} · jamais compté dans le chiffre d&apos;affaires
            </p>
            {allowedSites.length > 1 ? (
              <div className="vente-cash-actions">
                <div className="site-switch site-switch-vente" role="tablist" aria-label="Site">
                  {allowedSites.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={`site-btn${site === s ? " is-active" : ""}`}
                      onClick={() => setSite(s)}
                    >
                      {SITE_LABEL[s]}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
          <div className="vente-cash-card-deco" aria-hidden />
        </section>

        {flash ? (
          <p className="ui-info" role="status">
            {flash}
          </p>
        ) : null}
        {error ? (
          <p className="error-banner" role="alert">
            {error}
          </p>
        ) : null}

        <div className="vente-workspace">
          <div className="vente-catalog">
            <div className="vente-cat-pills" role="tablist" aria-label="Catégories">
              {CATS.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  role="tab"
                  aria-selected={cat === c.key}
                  className={`vente-cat-pill${cat === c.key ? " is-active" : ""}`}
                  onClick={() => setCat(c.key)}
                >
                  <span className="vente-cat-pill-icon">
                    <ProductIcon kind={c.key} name={c.icon} size="md" />
                  </span>
                  <span className="vente-cat-pill-label">
                    <span className="vente-cat-pill-label-long">{c.label}</span>
                    <span className="vente-cat-pill-label-short">{c.short}</span>
                  </span>
                  <span className="vente-cat-pill-count">{counts[c.key]}</span>
                </button>
              ))}
            </div>

            {loading && !products.length ? (
              <BrandLoader variant="ligne" label="Chargement du catalogue…" />
            ) : cat === "plat" ? (
              <MealComposer
                plats={plats}
                canSell
                ignoreStock
                busyKey={null}
                composerPlatId={composerPlatId}
                composerPlat={composerPlat}
                composerQty={composerQty}
                composerAccOptions={accompagnements}
                composerAccQtys={composerAccQtys}
                composerTotal={composerTotal}
                onSelectPlat={selectPlat}
                onQtyChange={(d) => setComposerQty((q) => Math.max(1, q + d))}
                onAccQtyChange={(id, d) =>
                  setComposerAccQtys((prev) => ({
                    ...prev,
                    [id]: Math.max(0, (prev[id] ?? 0) + d),
                  }))
                }
                onCommit={commitMeal}
                accPriceFor={(acc) => acc.unitPrice}
              />
            ) : (
              <ProductGrid
                products={gridProducts}
                canSell
                ignoreStock
                onAdd={(p) => addToCart(p)}
              />
            )}
          </div>

          <aside
            className={`pos-cart vente-panel${cart.length === 0 ? " is-empty" : ""}${
              cartSheetOpen ? " is-sheet-open" : ""
            }`}
          >
            <header className="vente-panel-head vente-cart-head">
              <div>
                <h2>Test en cours</h2>
                <p>
                  {cart.length
                    ? `${cartCount} article${cartCount > 1 ? "s" : ""}`
                    : "Vide — touchez + sur un produit"}
                </p>
              </div>
              <button
                type="button"
                className="vente-cart-close"
                aria-label="Fermer le panier"
                onClick={() => setCartSheetOpen(false)}
              >
                ×
              </button>
            </header>

            {!cart.length ? (
              <div className="vente-cart-empty-state">
                <span className="vente-cart-empty-ico" aria-hidden>
                  <svg viewBox="0 0 24 24" focusable="false">
                    <path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3M8 15h8" />
                  </svg>
                </span>
                <strong>Aucun article dans le test</strong>
                <span>Les articles testés apparaîtront ici.</span>
              </div>
            ) : (
              <CartLines cart={cart} onChangeQty={changeQty} />
            )}

            <div className="pos-meta">
              <label className="vente-field">
                <span>Objet du test</span>
                <input
                  value={objet}
                  maxLength={120}
                  onChange={(e) => setObjet(e.target.value)}
                  placeholder="Nouvelle recette, dégustation…"
                />
              </label>
              <label className="vente-field">
                <span>Testeur</span>
                <input
                  value={testeur}
                  maxLength={80}
                  onChange={(e) => setTesteur(e.target.value)}
                  placeholder="Qui goûte / valide"
                />
              </label>
              <label className="vente-field">
                <span>Observations</span>
                <input
                  value={observations}
                  maxLength={600}
                  onChange={(e) => setObservations(e.target.value)}
                  placeholder="Goût, portion, décision…"
                />
              </label>
            </div>

            <div className="pos-cart-foot">
              <div className="pos-total">
                <span>Coût matière</span>
                <strong className="mono">{formatFcfa(cartCost)}</strong>
              </div>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !cart.length}
                onClick={() => void validate()}
              >
                {busy ? "Enregistrement…" : "Enregistrer le test"}
              </button>
            </div>

            {visibleTests.length > 0 ? (
              <div className="pos-tickets">
                <h3 className="vente-tickets-title">
                  Tests du jour · {visibleTests.length}
                </h3>
                <ul className="vente-log pos-tickets-scroll">
                  {visibleTests.map((t) => (
                    <li key={t.id}>
                      <div>
                        <strong>
                          {t.numero} · {heure(t.at)}
                        </strong>
                        <span className="muted mono"> · {formatFcfa(t.cost)}</span>
                        <div className="muted">
                          {t.cancelledAt
                            ? `Annulé par ${t.cancelledByName ?? "—"}`
                            : t.lines.map((l) => `${l.qty} × ${l.name}`).join(", ")}
                        </div>
                        {t.objet || t.testeur || t.observations ? (
                          <div className="muted">
                            {[t.objet, t.testeur && `par ${t.testeur}`, t.observations]
                              .filter(Boolean)
                              .join(" · ")}
                          </div>
                        ) : null}
                      </div>
                      <div className="pos-ticket-actions">
                        {t.cancelledAt ? null : (
                          <button
                            type="button"
                            className="btn-link"
                            disabled={busy}
                            onClick={() => void cancel(t)}
                          >
                            Annuler
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </aside>
        </div>

        {cart.length > 0 ? (
          <>
            <button
              type="button"
              className="vente-cart-backdrop"
              aria-label="Fermer le panier"
              tabIndex={cartSheetOpen ? 0 : -1}
              onClick={() => setCartSheetOpen(false)}
            />
            <div className="vente-mobile-cart-bar" role="region" aria-label="Résumé du test">
              <button
                type="button"
                className="vente-mobile-cart-summary"
                aria-expanded={cartSheetOpen}
                onClick={() => setCartSheetOpen(true)}
              >
                <span className="vente-mobile-cart-count">
                  {cartCount} article{cartCount > 1 ? "s" : ""}
                </span>
                <strong className="vente-mobile-cart-total mono">
                  {formatFcfa(cartCost)}
                </strong>
              </button>
              <button
                type="button"
                className="btn btn-ghost vente-mobile-cart-details"
                onClick={() => setCartSheetOpen((open) => !open)}
              >
                {cartSheetOpen ? "Fermer" : "Détails"}
              </button>
              <button
                type="button"
                className="btn btn-primary vente-mobile-cart-validate"
                disabled={busy}
                onClick={() => void validate()}
              >
                {busy ? "…" : "Enregistrer"}
              </button>
            </div>
          </>
        ) : null}
      </div>

      {busy ? (
        <BrandLoader variant="voile" label="Enregistrement du test…" />
      ) : null}

      <RegistreDrawer
        open={journalOpen}
        onClose={() => setJournalOpen(false)}
        title="Derniers tests"
        subtitle={`${siteLabel} · coût matière en FCFA`}
      >
        {visibleTests.length ? (
          <ul className="vente-log">
            {visibleTests.map((t) => (
              <li key={t.id}>
                <div>
                  <strong>
                    {t.numero} · {heure(t.at)}
                  </strong>
                  <span className="muted mono"> · {formatFcfa(t.cost)}</span>
                  <div className="muted">
                    {t.cancelledAt
                      ? `Annulé par ${t.cancelledByName ?? "—"}`
                      : t.lines.map((l) => `${l.qty} × ${l.name}`).join(", ")}
                  </div>
                </div>
                <span className="reg-actions">
                  {t.cancelledAt ? null : (
                    <button
                      type="button"
                      className="btn-link"
                      disabled={busy}
                      onClick={() => void cancel(t)}
                    >
                      Annuler
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Aucun test.</p>
        )}
      </RegistreDrawer>
    </AppShell>
  );
}
