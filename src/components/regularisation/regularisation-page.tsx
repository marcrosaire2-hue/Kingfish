"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { BrandLoader } from "@/components/brand-loader";
import { formatFcfa } from "@/lib/format";
import type {
  Immobilisation,
  PosTicket,
  SaleType,
  VenteProduct,
  VenteSite,
} from "@/lib/types";
import { todayIsoDate } from "@/lib/zogbo-calc";
import { useSession } from "@/components/session-provider";
import {
  venteActionEnabled,
  type SiteRolesConfig,
} from "@/lib/site-roles-model";

type Board = {
  date: string;
  site: VenteSite;
  products: VenteProduct[];
  caToday: number;
};

/** Ligne en attente, avant validation groupée en une seule facture. */
type PanierLine = {
  key: string;
  kind: "plat" | "local" | "boisson" | "extra";
  productId: string;
  name: string;
  qty: number;
  unitPrice: number;
};

const SALE_TYPES: SaleType[] = ["Sur place", "Rapido"];

function formatWhen(iso: string): string {
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "Africa/Porto-Novo",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function RegularisationPage() {
  const { user: sessionUser } = useSession();
  const [date, setDate] = useState(() => todayIsoDate());
  /** Remplacé dès /api/auth/me pour coller à la zone du compte (Zogbo/Gbégamey). */
  const [site, setSite] = useState<VenteSite>("zogbo");
  const [sessionReady, setSessionReady] = useState(false);
  const [allowedSites, setAllowedSites] = useState<VenteSite[]>([]);
  const [board, setBoard] = useState<Board | null>(null);
  const [tickets, setTickets] = useState<PosTicket[]>([]);
  const [emballages, setEmballages] = useState<Immobilisation[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [sitePolicies, setSitePolicies] = useState<SiteRolesConfig | null>(null);

  const [kind, setKind] = useState<"plat" | "local" | "boisson" | "extra">(
    "extra",
  );
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("1");
  const [extraName, setExtraName] = useState("");
  /** Prix unitaire (FCFA) — articles hors catalogue ; total = PU × quantité. */
  const [extraMontant, setExtraMontant] = useState("");
  const [saleType, setSaleType] = useState<SaleType>("Sur place");
  /** Articles accumulés avant validation groupée en une seule facture. */
  const [panier, setPanier] = useState<PanierLine[]>([]);
  const [reduction, setReduction] = useState("0");

  const products = useMemo(() => {
    if (!board) return [];
    if (kind === "extra") return [];
    return board.products.filter((p) => p.kind === kind);
  }, [board, kind]);

  const selected = products.find((p) => p.productId === productId) ?? null;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [venteRes, posRes, embRes] = await Promise.all([
        fetch(
          `/api/vente?date=${encodeURIComponent(date)}&site=${site}&limit=80`,
          { cache: "no-store" },
        ),
        fetch(`/api/pos?date=${encodeURIComponent(date)}&site=${site}`, {
          cache: "no-store",
        }),
        fetch(
          `/api/immobilisations?kind=emballage&active=1&site=${encodeURIComponent(site)}`,
          { cache: "no-store" },
        ),
      ]);
      const venteBody = await venteRes.json();
      if (!venteRes.ok) throw new Error(venteBody.error || "Erreur vente");
      setBoard(venteBody as Board);
      if (venteBody.sitePolicies) {
        setSitePolicies(venteBody.sitePolicies as SiteRolesConfig);
      }
      if (venteBody.site) setSite(venteBody.site as VenteSite);
      if (Array.isArray(venteBody.allowedSites)) {
        setAllowedSites(venteBody.allowedSites as VenteSite[]);
      }

      if (posRes.ok) {
        const posBody = await posRes.json();
        setTickets((posBody.tickets as PosTicket[]) || []);
      } else {
        setTickets([]);
      }

      if (embRes.ok) {
        const embBody = await embRes.json();
        setEmballages(
          ((embBody.items as Immobilisation[]) || []).filter(
            (i) => i.active && (i.salePrice ?? 0) > 0,
          ),
        );
      } else {
        setEmballages([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement");
      setBoard(null);
      setTickets([]);
    } finally {
      setLoading(false);
    }
  }, [date, site]);

  useEffect(() => {
    let annule = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        if (!res.ok) {
          if (!annule) {
            setAllowedSites(["zogbo", "gbegamey"]);
            setSessionReady(true);
          }
          return;
        }
        const body = await res.json();
        if (annule) return;
        const userSite = body.user?.site as VenteSite | "tous" | undefined;
        if (userSite === "zogbo" || userSite === "gbegamey") {
          setSite(userSite);
          setAllowedSites([userSite]);
        } else if (Array.isArray(body.allowedSites) && body.allowedSites.length) {
          setAllowedSites(body.allowedSites as VenteSite[]);
          const first = body.allowedSites[0];
          if (first === "zogbo" || first === "gbegamey") setSite(first);
        } else {
          setAllowedSites(["zogbo", "gbegamey"]);
        }
      } catch {
        if (!annule) setAllowedSites(["zogbo", "gbegamey"]);
      } finally {
        if (!annule) setSessionReady(true);
      }
    })();
    return () => {
      annule = true;
    };
  }, []);

  useEffect(() => {
    if (!sessionReady) return;
    void load();
  }, [load, sessionReady]);

  useEffect(() => {
    if (kind === "extra") {
      setProductId("");
      return;
    }
    if (!products.some((p) => p.productId === productId)) {
      setProductId(products[0]?.productId ?? "");
    }
  }, [kind, products, productId]);

  /** Ajoute une ligne au panier en attente — ne crée pas encore de facture. */
  function ajouterLigne() {
    const q = Math.round(Number(qty) || 0);
    if (q < 1) {
      setError("Quantité invalide");
      return;
    }
    setError(null);
    setFlash(null);
    if (kind === "extra") {
      const name = extraName.trim();
      const unitPrice = Math.round(Number(extraMontant) || 0);
      if (name.length < 2) {
        setError("Indiquez le nom du produit / article.");
        return;
      }
      if (unitPrice <= 0) {
        setError("Prix unitaire invalide (FCFA).");
        return;
      }
      setPanier((prev) => [
        ...prev,
        {
          key: `extra-${Date.now()}`,
          kind: "extra",
          productId: `extra-${Date.now()}`,
          name,
          qty: q,
          unitPrice,
        },
      ]);
      setExtraName("");
      setExtraMontant("");
    } else {
      if (!selected) {
        setError("Choisissez un produit.");
        return;
      }
      setPanier((prev) => [
        ...prev,
        {
          key: `${selected.productId}-${Date.now()}`,
          kind,
          productId: selected.productId,
          name: selected.name,
          qty: q,
          unitPrice: selected.unitPrice,
        },
      ]);
    }
    setQty("1");
  }

  function retirerLigne(key: string) {
    setPanier((prev) => prev.filter((l) => l.key !== key));
  }

  const panierTotal = panier.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  const reductionN = Math.max(
    0,
    Math.min(panierTotal, Math.round(Number(reduction) || 0)),
  );
  const panierNet = panierTotal - reductionN;

  const qtyN = Math.max(0, Math.round(Number(qty) || 0));
  const lignePreview =
    kind === "extra"
      ? qtyN * Math.max(0, Math.round(Number(extraMontant) || 0))
      : selected
        ? qtyN * selected.unitPrice
        : 0;

  /** Valide toutes les lignes accumulées d'un coup, sur une seule facture. */
  async function validerFacture() {
    if (!panier.length) {
      setError("Ajoutez au moins un article avant de valider.");
      return;
    }
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      const res = await fetch("/api/pos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "validate",
          date,
          site,
          saleType,
          reduction: reductionN,
          lines: panier.map(({ kind: k, productId, name, qty: q, unitPrice }) => ({
            kind: k,
            productId,
            name,
            qty: q,
            unitPrice,
          })),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Enregistrement impossible");
      setFlash(
        `Facture enregistrée · ticket ${body.ticket?.numero ?? ""} · ${panier.length} article${panier.length > 1 ? "s" : ""}`,
      );
      setPanier([]);
      setReduction("0");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible");
    } finally {
      setBusy(false);
    }
  }

  async function annulerTicket(t: PosTicket) {
    if (
      !window.confirm(
        `Annuler ${t.numero} (${formatFcfa(t.montant)}) ? Le stock sera repris.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      const res = await fetch("/api/pos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "cancel",
          id: t.id,
          date: t.date,
          site: t.site,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Annulation impossible");
      setFlash(`Ticket ${t.numero} annulé`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Annulation impossible");
    } finally {
      setBusy(false);
    }
  }

  async function modifierLigne(t: PosTicket, line: PosTicket["lines"][number]) {
    if (!line.venteLogId) {
      setError("Cette ligne n’a pas de journal lié — actualisez la page.");
      return;
    }
    const raw = window.prompt(
      `Nouvelle quantité pour « ${line.name} » (actuelle : ${line.qty}) :`,
      String(line.qty),
    );
    if (raw === null) return;
    const next = Math.round(Number(raw));
    if (!Number.isFinite(next) || next < 1) {
      setError("Quantité invalide (minimum 1). Pour supprimer, annulez le ticket.");
      return;
    }
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      const res = await fetch("/api/vente", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "edit",
          id: line.venteLogId,
          date: t.date,
          site: t.site,
          qty: next,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Modification impossible");
      setFlash(`Quantité de « ${line.name} » mise à jour`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Modification impossible");
    } finally {
      setBusy(false);
    }
  }

  const siteLabel = site === "zogbo" ? "Zogbo" : "Gbégamey";
  const userRole = sessionUser?.role;
  const canCancelSite = venteActionEnabled(sitePolicies, userRole, site, "cancel");
  const canModifySite = venteActionEnabled(sitePolicies, userRole, site, "modify");
  const canSellSite = venteActionEnabled(sitePolicies, userRole, site, "sell");
  const isPast = date < todayIsoDate();

  return (
    <AppShell
      title="Régularisation"
      subtitle={`Corriger ou saisir des ventes d’un jour passé — ${siteLabel} (indépendant de l’autre site).`}
      actions={
        <>
          <Link href="/journal-ventes" className="btn btn-ghost">
            Journal
          </Link>
          <Link href="/vente" className="btn btn-ghost">
            ← Vente
          </Link>
        </>
      }
    >
      <div className="reg-page">
        <header className="reg-hero">
          <div className="reg-hero-main">
            <div className="reg-toolbar">
              <label className="date-field">
                <span>Jour</span>
                <input
                  type="date"
                  value={date}
                  max={todayIsoDate()}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
              <div
                className="site-switch reg-site-switch"
                role="group"
                aria-label="Site"
              >
                {allowedSites.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`site-btn${site === s ? " is-active" : ""}`}
                    disabled={allowedSites.length <= 1}
                    onClick={() => setSite(s)}
                  >
                    <span className="site-btn-label">
                      {s === "zogbo" ? "Zogbo" : "Gbégamey"}
                    </span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => void load()}
                disabled={loading || busy}
              >
                Actualiser
              </button>
            </div>
            {isPast ? (
              <p className="reg-hero-note" role="status">
                Correction du <strong>{date}</strong> · {siteLabel} — hors
                catalogue ou catalogue, même sans stock.
              </p>
            ) : (
              <p className="reg-hero-note is-warn" role="note">
                Choisissez une date <strong>passée</strong>. Pour aujourd’hui,
                utilisez la page Vente.
              </p>
            )}
          </div>
          <div className="reg-ca-pill" aria-label="Chiffre d’affaires du jour">
            <span className="reg-ca-label">CA {siteLabel}</span>
            <strong className="mono">
              {loading ? "…" : formatFcfa(board?.caToday ?? 0)}
            </strong>
          </div>
        </header>

        {error ? (
          <p className="error-banner" role="alert">
            {error}
          </p>
        ) : null}
        {flash ? (
          <p className="ui-info" role="status">
            {flash}
          </p>
        ) : null}

        {loading ? (
          <BrandLoader label="Chargement…" />
        ) : (
          <>
            <div className="reg-workspace">
              <section className="panel reg-form-panel">
                <div className="panel-head">
                  <h2 className="panel-title">1 · Saisie</h2>
                  <p className="muted">Composer les lignes de la facture</p>
                </div>

                <div
                  className="reg-kind-tabs"
                  role="tablist"
                  aria-label="Origine de l’article"
                >
                  {(
                    [
                      ["extra", "Hors catalogue"],
                      ["plat", "Plats"],
                      ["local", "Accomp."],
                      ["boisson", "Boissons"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      aria-selected={kind === id}
                      className={`reg-kind-tab${kind === id ? " is-active" : ""}`}
                      onClick={() => setKind(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className="reg-form">
                  {kind === "extra" ? (
                    <>
                      {emballages.length > 0 ? (
                        <div className="reg-emballages reg-field-full">
                          <span className="reg-emballages-label">
                            Emballages rapides
                          </span>
                          <div className="vente-emballage-chips">
                            {emballages.map((e) => (
                              <button
                                key={e.id}
                                type="button"
                                className="btn btn-ghost vente-emballage-chip"
                                disabled={busy || !isPast}
                                onClick={() => {
                                  setExtraName(e.name);
                                  setExtraMontant(String(e.salePrice ?? 0));
                                  setQty("1");
                                  setSaleType("Rapido");
                                }}
                              >
                                {e.name}
                                <span className="mono">
                                  {" "}
                                  {formatFcfa(e.salePrice ?? 0)}
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      <label className="date-field reg-field-full">
                        <span>Produit / article</span>
                        <input
                          value={extraName}
                          onChange={(e) => setExtraName(e.target.value)}
                          placeholder="Ex. brochette, chawarma…"
                          autoComplete="off"
                        />
                      </label>

                      <label className="date-field">
                        <span>Quantité</span>
                        <input
                          type="number"
                          min={1}
                          value={qty}
                          onChange={(e) => setQty(e.target.value)}
                        />
                      </label>
                      <label className="date-field">
                        <span>Prix unitaire (FCFA)</span>
                        <input
                          type="number"
                          min={0}
                          step={50}
                          value={extraMontant}
                          onChange={(e) => setExtraMontant(e.target.value)}
                          placeholder="1500"
                        />
                      </label>

                      {lignePreview > 0 ? (
                        <p className="muted reg-field-full reg-hint">
                          Total ligne :{" "}
                          <strong className="mono">
                            {formatFcfa(lignePreview)}
                          </strong>
                          {qtyN > 1 ? (
                            <span>
                              {" "}
                              ({qtyN} ×{" "}
                              {formatFcfa(
                                Math.round(Number(extraMontant) || 0),
                              )}
                              )
                            </span>
                          ) : null}
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <label className="date-field reg-field-full">
                        <span>Produit</span>
                        <select
                          className="select-input"
                          value={productId}
                          onChange={(e) => setProductId(e.target.value)}
                        >
                          {products.length === 0 ? (
                            <option value="">Aucun produit</option>
                          ) : (
                            products.map((p) => (
                              <option key={p.productId} value={p.productId}>
                                {p.name}
                                {p.stockLeft != null
                                  ? ` · reste ${p.stockLeft}`
                                  : ""}
                              </option>
                            ))
                          )}
                        </select>
                      </label>
                      <label className="date-field">
                        <span>Quantité</span>
                        <input
                          type="number"
                          min={1}
                          value={qty}
                          onChange={(e) => setQty(e.target.value)}
                        />
                      </label>
                      <div className="reg-hint muted">
                        {selected ? (
                          <>
                            Prix :{" "}
                            <strong className="mono">
                              {formatFcfa(selected.unitPrice)}
                            </strong>
                            {qtyN > 0 ? (
                              <>
                                {" "}
                                · Total :{" "}
                                <strong className="mono">
                                  {formatFcfa(lignePreview)}
                                </strong>
                                {qtyN > 1
                                  ? ` (${qtyN} × ${formatFcfa(selected.unitPrice)})`
                                  : ""}
                              </>
                            ) : null}
                            {selected.stockLeft != null
                              ? ` · stock ${selected.stockLeft}`
                              : ""}
                            {selected.stockLeft != null &&
                            selected.stockLeft <= 0
                              ? " · sans stock OK"
                              : ""}
                          </>
                        ) : (
                          "—"
                        )}
                      </div>
                    </>
                  )}

                  <label className="date-field">
                    <span>Type de vente</span>
                    <select
                      className="select-input"
                      value={saleType}
                      onChange={(e) =>
                        setSaleType(e.target.value as SaleType)
                      }
                    >
                      {SALE_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="reg-form-actions reg-field-full">
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy || !isPast}
                      onClick={ajouterLigne}
                    >
                      + Ajouter à la facture
                    </button>
                  </div>
                </div>
              </section>

              <section className="panel reg-panier-panel">
                <div className="panel-head">
                  <h2 className="panel-title">2 · Facture</h2>
                  <p className="muted">
                    {panier.length} article{panier.length > 1 ? "s" : ""}
                  </p>
                </div>

                {panier.length === 0 ? (
                  <p className="muted reg-empty">
                    Ajoutez des articles à gauche, puis validez ici pour une
                    seule facture.
                  </p>
                ) : (
                  <div className="reg-panier-body">
                    <ul className="reg-panier-list">
                      {panier.map((l) => (
                        <li key={l.key} className="reg-panier-line">
                          <span className="reg-panier-name">
                            {l.name}
                            <span className="muted"> × {l.qty}</span>
                          </span>
                          <span className="mono reg-panier-amount">
                            {formatFcfa(l.qty * l.unitPrice)}
                          </span>
                          <button
                            type="button"
                            className="btn-link"
                            disabled={busy}
                            onClick={() => retirerLigne(l.key)}
                          >
                            Retirer
                          </button>
                        </li>
                      ))}
                    </ul>
                    <div className="reg-panier-footer">
                      <label className="date-field">
                        <span>Réduction (FCFA)</span>
                        <input
                          type="number"
                          min={0}
                          max={panierTotal}
                          value={reduction}
                          onChange={(e) => setReduction(e.target.value)}
                        />
                      </label>
                      {reductionN > 0 ? (
                        <p className="reg-panier-total muted">
                          Sous-total{" "}
                          <strong className="mono">
                            {formatFcfa(panierTotal)}
                          </strong>
                          {" · "}Réduc.{" "}
                          <strong className="mono">
                            −{formatFcfa(reductionN)}
                          </strong>
                        </p>
                      ) : null}
                      <p className="reg-panier-total is-grand">
                        Total{" "}
                        <strong className="mono">{formatFcfa(panierNet)}</strong>
                      </p>
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={busy || !isPast || !canSellSite}
                        onClick={() => void validerFacture()}
                      >
                        {busy
                          ? "Enregistrement…"
                          : `Valider la facture (${panier.length})`}
                      </button>
                    </div>
                  </div>
                )}
              </section>
            </div>

            <section className="panel reg-tickets-panel">
              <div className="panel-head">
                <h2 className="panel-title">3 · Tickets du jour</h2>
                <p className="muted">
                  {tickets.length} ticket{tickets.length > 1 ? "s" : ""} · {date}
                </p>
              </div>

              {tickets.length === 0 ? (
                <p className="muted reg-empty">
                  Aucun ticket POS pour ce jour.
                </p>
              ) : (
                <div className="reg-tickets-scroll">
                  <table className="data-table hist-ventes-table">
                    <thead>
                      <tr>
                        <th scope="col">Ticket</th>
                        <th scope="col">Heure</th>
                        <th scope="col">Type</th>
                        <th scope="col" className="col-money">
                          Montant
                        </th>
                        <th scope="col">Statut</th>
                        <th scope="col">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tickets.map((t) => (
                        <tr key={t.id}>
                          <td className="cell-name">
                            <strong>{t.numero}</strong>
                            <ul className="hist-line-list">
                              {t.lines.map((l, i) => (
                                <li key={`${t.id}-${i}`}>
                                  <span>
                                    {l.name} × {l.qty}
                                  </span>
                                  {t.statut === "valide" &&
                                  l.venteLogId &&
                                  canModifySite ? (
                                    <button
                                      type="button"
                                      className="btn-link"
                                      disabled={busy}
                                      onClick={() => void modifierLigne(t, l)}
                                    >
                                      Qty
                                    </button>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                          </td>
                          <td>{formatWhen(t.at)}</td>
                          <td>{t.saleType}</td>
                          <td className="mono col-money">
                            {formatFcfa(t.montant)}
                          </td>
                          <td>
                            <span
                              className={`hist-statut hist-statut-${t.statut === "annule" ? "annule" : "valide"}`}
                            >
                              {t.statut === "annule" ? "Annulé" : "Validé"}
                            </span>
                          </td>
                          <td>
                            {t.statut === "valide" && canCancelSite ? (
                              <span className="reg-actions">
                                <button
                                  type="button"
                                  className="btn-link"
                                  disabled={busy}
                                  onClick={() => void annulerTicket(t)}
                                >
                                  Annuler
                                </button>
                              </span>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}
