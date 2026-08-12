"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ContextBar } from "@/components/context-bar";
import { ExportExcelButton } from "@/components/export-excel-button";
import { ProductIcon } from "@/components/product-icon";
import { RegistreDrawer } from "@/components/registre-drawer";
import { formatFcfa, parseMoneyInput } from "@/lib/format";
import {
  ajouterEnAttente,
  installerSupportHorsLigne,
  nombreEnAttente,
} from "@/lib/offline-queue";
import { exportVenteExcel } from "@/lib/page-exports";
import {
  accompanimentUnitPrice,
  getZogboPlat,
} from "@/lib/catalog-zogbo";
import type {
  CaisseSession,
  PosConfig,
  PosTicket,
  SaleType,
  VenteLogEntry,
  VenteProduct,
  VenteSite,
} from "@/lib/types";
import { todayIsoDate } from "@/lib/zogbo-calc";

type Board = {
  date: string;
  site: VenteSite;
  caParEquipe?: Record<string, number>;
  products: VenteProduct[];
  recent: VenteLogEntry[];
  caToday: number;
};

type CartLine = {
  key: string;
  kind: VenteProduct["kind"];
  productId: string;
  name: string;
  unitPrice: number;
  qty: number;
};

type CatKey = "plat" | "accompagnement" | "boisson" | "extra";

/** Onglet UI → kind API (`extra` = saisie libre). */
const CAT_KIND: Record<Exclude<CatKey, "extra">, VenteProduct["kind"]> = {
  plat: "plat",
  accompagnement: "local",
  boisson: "boisson",
};

const CAT_LABELS: Record<CatKey, string> = {
  plat: "Plats",
  accompagnement: "Accompagnements",
  boisson: "Boissons",
  extra: "Extra",
};

const SALE_TYPES: SaleType[] = ["Sur place", "Rapido"];

function formatLogTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "short",
      timeStyle: "medium",
      timeZone: "Africa/Porto-Novo",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function printTicket(
  ticket: PosTicket,
  company: { nom?: string | null; contacts?: string | null; adresse?: string | null } | null,
) {
  const w = window.open("", "_blank", "width=360,height=640");
  if (!w) return;
  const lines = ticket.lines
    .map(
      (l) =>
        `<div class="flex"><span>${l.name}</span><span>x${l.qty}</span><span>${l.amount.toLocaleString("fr-FR")} F</span></div>`,
    )
    .join("");
  const headerBits = [
    company?.nom || "King Fish Manager",
    company?.contacts,
    company?.adresse,
  ].filter(Boolean);
  w.document.write(`<!doctype html><html><head><title>${ticket.numero}</title>
    <style>
      body{font-family:monospace;font-size:13px;padding:12px;max-width:280px;margin:0 auto}
      .center{text-align:center}.bold{font-weight:700}
      .hr{border-bottom:1px dashed #000;margin:8px 0}
      .flex{display:flex;justify-content:space-between;gap:6px;margin:2px 0}
      .sub{font-size:11px;opacity:.85}
    </style></head><body>
    <div class="center bold">${headerBits[0]}</div>
    ${headerBits
      .slice(1)
      .map((b) => `<div class="center sub">${b}</div>`)
      .join("")}
    <div class="center">${ticket.numero} · ${ticket.saleType}</div>
    <div class="hr"></div>
    <div class="flex"><span>Date</span><span>${new Date(ticket.at).toLocaleString("fr-FR")}</span></div>
    ${ticket.tableLabel ? `<div class="flex"><span>Table</span><span>${ticket.tableLabel}</span></div>` : ""}
    ${ticket.serveurNom ? `<div class="flex"><span>Serveur</span><span>${ticket.serveurNom}</span></div>` : ""}
    ${ticket.clientNom ? `<div class="flex"><span>Client</span><span>${ticket.clientNom}</span></div>` : ""}
    <div class="hr"></div>${lines}<div class="hr"></div>
    ${ticket.reduction ? `<div class="flex"><span>Réduction</span><span>−${ticket.reduction.toLocaleString("fr-FR")} F</span></div>` : ""}
    <div class="flex bold"><span>Total</span><span>${ticket.montant.toLocaleString("fr-FR")} F</span></div>
    <div class="flex"><span>Paiement</span><span>${ticket.paymentLabel || "—"}</span></div>
    <div class="hr"></div><div class="center">Merci</div>
    </body></html>`);
  w.document.close();
  w.focus();
  w.print();
}

export function VentePage() {
  const [date, setDate] = useState(() => todayIsoDate());
  const [site, setSite] = useState<VenteSite>("gbegamey");
  const [lockedSite, setLockedSite] = useState(false);
  const [mode, setMode] = useState<"pos" | "rapide">("pos");
  /** Ventes encaissées hors ligne, en attente d'envoi au serveur. */
  const [enAttente, setEnAttente] = useState(0);
  const [cat, setCat] = useState<CatKey>("plat");
  const [board, setBoard] = useState<Board | null>(null);
  const [config, setConfig] = useState<PosConfig | null>(null);
  const [caisse, setCaisse] = useState<CaisseSession | null>(null);
  const [tickets, setTickets] = useState<PosTicket[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [saleType, setSaleType] = useState<SaleType>("Sur place");
  const [paymentId, setPaymentId] = useState("");
  const [tableId, setTableId] = useState("");
  const [serveurId, setServeurId] = useState("");
  const [clientNom, setClientNom] = useState("");
  const [reduction, setReduction] = useState("0");
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [journalOpen, setJournalOpen] = useState(false);
  const [extraDesc, setExtraDesc] = useState("");
  const [extraPrice, setExtraPrice] = useState("");
  const [extraBusy, setExtraBusy] = useState(false);
  const [posBusy, setPosBusy] = useState(false);
  const [composerPlatId, setComposerPlatId] = useState("");
  const [composerAccIds, setComposerAccIds] = useState<string[]>([]);
  const [composerQty, setComposerQty] = useState(1);

  async function load(nextDate = date, nextSite = site) {
    setLoading(true);
    setError(null);
    try {
      const [venteRes, posRes] = await Promise.all([
        fetch(
          `/api/vente?date=${encodeURIComponent(nextDate)}&site=${nextSite}`,
          { cache: "no-store" },
        ),
        fetch(
          `/api/pos?date=${encodeURIComponent(nextDate)}&site=${nextSite}`,
          { cache: "no-store" },
        ),
      ]);
      const venteBody = await venteRes.json();
      if (!venteRes.ok) throw new Error(venteBody.error || "Erreur vente");
      setBoard(venteBody as Board);
      if (venteBody.site) setSite(venteBody.site as VenteSite);
      setLockedSite(!!venteBody.lockedSite);

      if (posRes.ok) {
        const posBody = await posRes.json();
        setConfig(posBody.config as PosConfig);
        setCaisse(posBody.caisse as CaisseSession | null);
        setTickets((posBody.tickets as PosTicket[]) || []);
        if (!paymentId && posBody.config?.paymentMethods?.[0]?.id) {
          setPaymentId(posBody.config.paymentMethods[0].id);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(date, site);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, site]);

  const plats = useMemo(
    () => board?.products.filter((p) => p.kind === "plat") ?? [],
    [board],
  );

  const accompagnements = useMemo(
    () => board?.products.filter((p) => p.kind === "local") ?? [],
    [board],
  );

  const products = useMemo(() => {
    if (!board || cat === "extra") return [];
    if (cat === "plat") return plats;
    if (cat === "accompagnement") return accompagnements;
    const kind = CAT_KIND[cat];
    return board.products.filter((p) => p.kind === kind);
  }, [board, cat, plats, accompagnements]);

  const categories = useMemo(() => {
    const keys: CatKey[] = ["plat", "accompagnement", "boisson", "extra"];
    return keys.map((key) => ({
      key,
      label: CAT_LABELS[key],
      count:
        key === "extra"
          ? (board?.recent.filter((e) => e.kind === "extra").length ?? 0)
          : key === "plat"
            ? plats.length
            : key === "accompagnement"
              ? accompagnements.length
              : (board?.products.filter((p) => p.kind === CAT_KIND[key]).length ??
                0),
    }));
  }, [board, plats.length, accompagnements.length]);

  // Service worker + rejeu des ventes encaissées pendant une coupure.
  useEffect(() => {
    return installerSupportHorsLigne((file) => setEnAttente(file.length));
  }, []);

  const composerPlat = useMemo(
    () => plats.find((p) => p.productId === composerPlatId) ?? null,
    [plats, composerPlatId],
  );

  const platDefStatic = useMemo(
    () => (composerPlatId ? getZogboPlat(composerPlatId) : null),
    [composerPlatId],
  );

  const composerAccOptions = useMemo(() => {
    if (!composerPlatId) return [];
    // Les plats réels (paramètres) n'ont pas de liste d'accompagnements :
    // on propose tous ceux du jour. Seuls les plats du catalogue statique
    // restreignent à leur liste.
    const plat = platDefStatic;
    if (!plat) return accompagnements;
    const allowed = new Set(plat.accompanimentIds);
    return accompagnements.filter((p) => allowed.has(p.productId));
  }, [composerPlatId, platDefStatic, accompagnements]);

  /** Prix d'un accompagnement : grille « plat + accompagnement » si le plat
   *  est au catalogue statique, sinon son prix du jour. */
  function accPriceFor(acc: VenteProduct): number {
    if (!composerPlatId || !platDefStatic) return acc.unitPrice;
    return accompanimentUnitPrice(composerPlatId, acc.productId);
  }

  useEffect(() => {
    if (!composerPlatId) {
      setComposerAccIds([]);
      return;
    }
    if (!platDefStatic) return;
    const allowed = new Set(platDefStatic.accompanimentIds);
    setComposerAccIds((prev) => prev.filter((id) => allowed.has(id)));
  }, [composerPlatId, platDefStatic]);

  const composerTotal = useMemo(() => {
    const plat = composerPlat;
    if (!composerPlatId || !plat) return 0;
    const selected = composerAccOptions.filter((a) =>
      composerAccIds.includes(a.productId),
    );
    return (
      plat.unitPrice +
      selected.reduce((s, a) => s + accPriceFor(a), 0)
    ) * composerQty;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composerPlat, composerPlatId, composerAccIds, composerAccOptions, composerQty]);

  function toggleComposerAcc(productId: string) {
    setComposerAccIds((prev) =>
      prev.includes(productId)
        ? prev.filter((id) => id !== productId)
        : [...prev, productId],
    );
  }

  function resetComposer() {
    setComposerPlatId("");
    setComposerAccIds([]);
    setComposerQty(1);
  }

  async function commitMeal() {
    if (!composerPlat) {
      setError("Choisissez un plat.");
      return;
    }
    if (
      composerPlat.stockLeft !== null &&
      composerPlat.stockLeft !== undefined &&
      composerPlat.stockLeft <= 0
    ) {
      setError(`Stock épuisé : ${composerPlat.name}`);
      return;
    }
    if (
      composerPlat.stockLeft !== null &&
      composerPlat.stockLeft !== undefined &&
      composerQty > composerPlat.stockLeft
    ) {
      setError(
        `Stock insuffisant : reste ${composerPlat.stockLeft} ${composerPlat.name}`,
      );
      return;
    }
    const accLines = composerAccIds
      .map((id) => composerAccOptions.find((a) => a.productId === id))
      .filter((a): a is VenteProduct => !!a);
    for (const acc of accLines) {
      if (
        acc.stockLeft !== null &&
        acc.stockLeft !== undefined &&
        acc.stockLeft <= 0
      ) {
        setError(`Stock épuisé : ${acc.name}`);
        return;
      }
      if (
        acc.stockLeft !== null &&
        acc.stockLeft !== undefined &&
        composerQty > acc.stockLeft
      ) {
        setError(
          `Stock insuffisant : reste ${acc.stockLeft} ${acc.name}`,
        );
        return;
      }
    }

    if (mode === "pos") {
      addToCart(composerPlat, undefined, composerQty);
      for (const acc of accLines) {
        addToCart(acc, accPriceFor(acc), composerQty);
      }
      resetComposer();
      setError(null);
      return;
    }

    setBusyKey("meal");
    setError(null);
    try {
      await sell(composerPlat, composerQty);
      for (const acc of accLines) {
        await sell(acc, composerQty, accPriceFor(acc));
      }
      resetComposer();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de vente");
    } finally {
      setBusyKey(null);
    }
  }

  const siteLabel = site === "zogbo" ? "Zogbo" : "Gbégamey";
  const recentCount = board?.recent.length ?? 0;
  const cartTotal = cart.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  const reductionN = Math.max(
    0,
    Math.min(cartTotal, Math.round(Number(reduction) || 0)),
  );
  const cartNet = cartTotal - reductionN;

  function addToCart(
    product: VenteProduct,
    unitPriceOverride?: number,
    qty = 1,
  ) {
    if (product.kind === "boisson" && product.unitPrice <= 0) return;
    if (
      product.stockLeft !== null &&
      product.stockLeft !== undefined &&
      product.stockLeft <= 0
    ) {
      return;
    }
    const unitPrice = unitPriceOverride ?? product.unitPrice;
    setCart((prev) => {
      const key = `${product.kind}:${product.productId}:${unitPrice}`;
      const existing = prev.find((l) => l.key === key);
      if (existing) {
        return prev.map((l) =>
          l.key === key ? { ...l, qty: l.qty + qty } : l,
        );
      }
      return [
        ...prev,
        {
          key,
          kind: product.kind,
          productId: product.productId,
          name: product.name,
          unitPrice,
          qty,
        },
      ];
    });
  }

  function changeCartQty(key: string, delta: number) {
    setCart((prev) =>
      prev
        .map((l) => (l.key === key ? { ...l, qty: l.qty + delta } : l))
        .filter((l) => l.qty > 0),
    );
  }

  async function validateCart() {
    if (!cart.length) {
      setError("Panier vide");
      return;
    }
    if (!caisse) {
      setError("Ouvrez une caisse avant de valider.");
      return;
    }
    setPosBusy(true);
    setError(null);
    const corps = {
      action: "validate",
      date,
      site,
      saleType,
      paymentMethodId: paymentId || undefined,
      tableId: saleType === "Sur place" ? tableId || undefined : undefined,
      serveurId: serveurId || undefined,
      clientNom: clientNom || undefined,
      reduction: reductionN,
      lines: cart.map((l) => ({
        kind: l.kind,
        productId: l.productId,
        name: l.name,
        qty: l.qty,
        unitPrice: l.unitPrice,
      })),
    };
    try {
      let res: Response;
      try {
        res = await fetch("/api/pos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(corps),
        });
      } catch {
        // Réseau coupé en plein service : la vente est mise de côté et rejouée
        // au retour de la connexion, plutôt que perdue.
        ajouterEnAttente(corps);
        setEnAttente(nombreEnAttente());
        setCart([]);
        setClientNom("");
        setReduction("0");
        setFlash("Hors ligne — vente enregistrée, elle partira au retour du réseau");
        window.setTimeout(() => setFlash(null), 3500);
        return;
      }
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Validation impossible");
      setBoard(body.board as Board);
      setCart([]);
      setClientNom("");
      setReduction("0");
      setFlash(`Ticket ${body.ticket.numero} · ${formatFcfa(body.ticket.montant)}`);
      window.setTimeout(() => setFlash(null), 2000);
      await load();
      if (body.ticket) {
        printTicket(body.ticket as PosTicket, config?.company ?? null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Validation impossible");
    } finally {
      setPosBusy(false);
    }
  }

  async function cancelTicket(ticket: PosTicket) {
    if (ticket.statut !== "valide") return;
    if (
      !window.confirm(
        `Annuler le ticket ${ticket.numero} (${formatFcfa(ticket.montant)}) ?`,
      )
    ) {
      return;
    }
    setBusyKey(`ticket:${ticket.id}`);
    setError(null);
    try {
      const res = await fetch("/api/pos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "cancel",
          id: ticket.id,
          date,
          site,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Annulation impossible");
      if (body.board) setBoard(body.board as Board);
      setFlash(`Ticket ${ticket.numero} annulé`);
      window.setTimeout(() => setFlash(null), 1600);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Annulation impossible");
    } finally {
      setBusyKey(null);
    }
  }

  async function sell(product: VenteProduct, qty: number, unitPrice?: number) {
    const key = `${product.kind}:${product.productId}:${qty}`;
    setBusyKey(key);
    setError(null);
    try {
      const res = await fetch("/api/vente", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "sell",
          date,
          site,
          kind: product.kind,
          productId: product.productId,
          qty,
          unitPrice,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Erreur de vente");
      setBoard(body.board as Board);
      setFlash(qty > 0 ? `${product.name} +${qty}` : `${product.name} ${qty}`);
      window.setTimeout(() => setFlash(null), 1200);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de vente");
    } finally {
      setBusyKey(null);
    }
  }

  async function undo(entry: VenteLogEntry) {
    setBusyKey(`undo:${entry.id}`);
    setError(null);
    try {
      const res = await fetch("/api/vente", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "undo",
          id: entry.id,
          date,
          site,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Annulation impossible");
      setBoard(body.board as Board);
      setFlash(`Annulé : ${entry.name}`);
      window.setTimeout(() => setFlash(null), 1200);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Annulation impossible");
    } finally {
      setBusyKey(null);
    }
  }

  async function submitExtra() {
    const unitPrice = parseMoneyInput(extraPrice);
    if (unitPrice === null || unitPrice <= 0) {
      setError("Indiquez un prix en FCFA.");
      return;
    }
    if (mode === "pos") {
      setCart((prev) => [
        ...prev,
        {
          key: `extra:${Date.now()}`,
          kind: "extra",
          productId: `extra-${Date.now()}`,
          name: extraDesc.trim() || "Extra",
          unitPrice,
          qty: 1,
        },
      ]);
      setExtraDesc("");
      setExtraPrice("");
      return;
    }
    setExtraBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/vente", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "extra",
          date,
          site,
          description: extraDesc,
          unitPrice,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Enregistrement impossible");
      setBoard(body.board as Board);
      setExtraDesc("");
      setExtraPrice("");
      setFlash(`Extra · ${formatFcfa(unitPrice)}`);
      window.setTimeout(() => setFlash(null), 1400);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible");
    } finally {
      setExtraBusy(false);
    }
  }

  return (
    <AppShell
      title="Vente"
      subtitle={
        mode === "pos"
          ? `${siteLabel} · panier multi-articles · ticket`
          : `${siteLabel} · mode rapide +1 / −1`
      }
    >
      <div className="vente-page">
        <ContextBar date={date} onDateChange={setDate} siteLabel={siteLabel}>
          <div className="site-switch" role="tablist" aria-label="Mode">
            <button
              type="button"
              className={`site-btn${mode === "pos" ? " is-active" : ""}`}
              onClick={() => setMode("pos")}
            >
              POS
            </button>
            <button
              type="button"
              className={`site-btn${mode === "rapide" ? " is-active" : ""}`}
              onClick={() => setMode("rapide")}
            >
              Rapide
            </button>
          </div>
          <ExportExcelButton
            onExport={() => exportVenteExcel(date, site)}
            disabled={loading}
          />
          <Link href="/historique-ventes" className="btn btn-ghost">
            Historique
          </Link>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setJournalOpen(true)}
          >
            Journal ({recentCount})
          </button>
        </ContextBar>

        <div className={`vente-hero${caisse ? " is-ready" : " is-idle"}`}>
          <div className="vente-hero-main">
            <span className="vente-hero-status">
              <span className="vente-hero-dot" aria-hidden />
              {mode === "pos"
                ? caisse
                  ? "Caisse ouverte"
                  : "Caisse fermée"
                : "Mode rapide"}
            </span>
            <span className="vente-hero-label">
              CA validé · {siteLabel}
              {board?.caParEquipe &&
              (board.caParEquipe.jour > 0 || board.caParEquipe.nuit > 0) ? (
                <span className="vente-equipes">
                  Jour {formatFcfa(board.caParEquipe.jour ?? 0)} · Nuit{" "}
                  {formatFcfa(board.caParEquipe.nuit ?? 0)}
                </span>
              ) : null}
              {enAttente > 0 ? (
                <span className="vente-attente" role="status">
                  {enAttente} vente{enAttente > 1 ? "s" : ""} en attente d’envoi
                </span>
              ) : null}
            </span>
            <strong className="vente-hero-value mono">
              {loading && !board ? "…" : formatFcfa(board?.caToday ?? 0)}
            </strong>
            <span className="vente-hero-meta">
              {flash
                ? flash
                : mode === "pos"
                  ? caisse
                    ? "Ajoutez au panier puis validez le ticket"
                    : "Ouvrez la caisse pour encaisser"
                  : "Un appui = une unité vendue"}
            </span>
          </div>
          <div className="vente-hero-side">
            <div
              className="site-switch site-switch-vente"
              role="tablist"
              aria-label="Site"
            >
              <button
                type="button"
                className={`site-btn${site === "zogbo" ? " is-active" : ""}`}
                onClick={() => setSite("zogbo")}
                disabled={lockedSite && site !== "zogbo"}
              >
                Zogbo
              </button>
              <button
                type="button"
                className={`site-btn${site === "gbegamey" ? " is-active" : ""}`}
                onClick={() => setSite("gbegamey")}
                disabled={lockedSite && site !== "gbegamey"}
              >
                Gbégamey
              </button>
            </div>
            {mode === "pos" && !caisse ? (
              <Link href="/caisse" className="btn btn-primary vente-hero-cta">
                Ouvrir la caisse
              </Link>
            ) : (
              <Link href="/caisse" className="btn btn-ghost vente-hero-cta">
                Voir la caisse
              </Link>
            )}
          </div>
        </div>

        {mode === "pos" && !caisse ? (
          <p className="error-banner" role="alert">
            Aucune caisse ouverte.{" "}
            <Link href="/caisse">Ouvrir la caisse</Link> pour valider des
            tickets.
          </p>
        ) : null}

        {error ? (
          <p className="error-banner" role="alert">
            {error}
          </p>
        ) : null}

        <div className="vente-workspace">
          <div className="vente-catalog">
            <div
              className="section-tabs vente-cats"
              role="tablist"
              aria-label="Catégories"
            >
              {categories.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  role="tab"
                  aria-selected={cat === c.key}
                  className={`section-tab${cat === c.key ? " is-active" : ""}`}
                  onClick={() => setCat(c.key)}
                >
                  {c.label}
                  <span className="section-count">{c.count}</span>
                </button>
              ))}
            </div>

            {loading && !board ? (
              <p className="muted vente-empty">Chargement…</p>
            ) : cat === "extra" ? (
              <div className="vente-extra vente-panel">
                <header className="vente-panel-head">
                  <h2>Vente extraordinaire</h2>
                  <p>Hors catalogue · prix libre</p>
                </header>
                <label className="vente-extra-field">
                  <span>Description</span>
                  <textarea
                    rows={3}
                    value={extraDesc}
                    onChange={(e) => setExtraDesc(e.target.value)}
                    disabled={extraBusy}
                  />
                </label>
                <label className="vente-extra-field">
                  <span>Prix (FCFA)</span>
                  <input
                    className="qty-input vente-extra-price"
                    inputMode="numeric"
                    value={extraPrice}
                    onChange={(e) => setExtraPrice(e.target.value)}
                    disabled={extraBusy}
                  />
                </label>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={extraBusy || !extraDesc.trim()}
                  onClick={() => void submitExtra()}
                >
                  {mode === "pos" ? "Ajouter au panier" : "Enregistrer la vente"}
                </button>
              </div>
            ) : cat === "plat" ? (
              <section className="vente-meal-composer vente-panel">
                <header className="vente-panel-head">
                  <h2>Vente plat + accompagnements</h2>
                  <p>
                    Choisissez le plat, puis les accompagnements souhaités
                    (optionnels). Chaque ligne part séparément au panier.
                  </p>
                </header>
                {plats.length === 0 ? (
                  <p className="muted vente-empty">Aucun plat au catalogue.</p>
                ) : (
                  <>
                    <label className="vente-field">
                      <span>Plat</span>
                      <select
                        value={composerPlatId}
                        onChange={(e) => setComposerPlatId(e.target.value)}
                      >
                        <option value="">— Choisir —</option>
                        {plats.map((p) => (
                          <option
                            key={p.productId}
                            value={p.productId}
                            disabled={
                              p.stockLeft !== null &&
                              p.stockLeft !== undefined &&
                              p.stockLeft <= 0
                            }
                          >
                            {p.name}
                            {p.unitPrice > 0
                              ? ` · ${formatFcfa(p.unitPrice)}`
                              : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    {composerPlat?.hint ? (
                      <p className="vente-hint">{composerPlat.hint}</p>
                    ) : null}
                    {composerAccOptions.length > 0 ? (
                      <fieldset className="vente-acc-picker">
                        <legend>Accompagnements (optionnel)</legend>
                        <ul className="vente-acc-list">
                          {composerAccOptions.map((a) => {
                            const out =
                              a.stockLeft !== null &&
                              a.stockLeft !== undefined &&
                              a.stockLeft <= 0;
                            const checked = composerAccIds.includes(a.productId);
                            const accPrice = accPriceFor(a);
                            return (
                              <li key={a.productId}>
                                <label
                                  className={`vente-acc-option${out ? " is-disabled" : ""}`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    disabled={out}
                                    onChange={() =>
                                      toggleComposerAcc(a.productId)
                                    }
                                  />
                                  <span>
                                    {a.name}
                                    {accPrice > 0
                                      ? ` · ${formatFcfa(accPrice)}`
                                      : ""}
                                    {a.hint ? (
                                      <span className="vente-hint-inline">
                                        {" "}
                                        · {a.hint}
                                      </span>
                                    ) : null}
                                  </span>
                                </label>
                              </li>
                            );
                          })}
                        </ul>
                      </fieldset>
                    ) : (
                      <p className="muted vente-acc-empty">
                        Aucun accompagnement — Paramètres → Accompagnements.
                      </p>
                    )}
                    <div className="vente-meal-actions">
                      <div className="vente-meal-qty">
                        <span className="vente-qty-label">Qté</span>
                        <button
                          type="button"
                          className="vente-minus"
                          aria-label="Moins de plats"
                          disabled={
                            !composerPlat ||
                            composerQty <= 1 ||
                            !!busyKey
                          }
                          onClick={() =>
                            setComposerQty((q) => Math.max(1, q - 1))
                          }
                        >
                          −
                        </button>
                        <span className="vente-qty mono">{composerQty}</span>
                        <button
                          type="button"
                          className="vente-plus"
                          aria-label="Plus de plats"
                          disabled={
                            !composerPlat ||
                            !!busyKey ||
                            (composerPlat.stockLeft !== null &&
                              composerPlat.stockLeft !== undefined &&
                              composerQty >= composerPlat.stockLeft)
                          }
                          onClick={() => setComposerQty((q) => q + 1)}
                        >
                          +
                        </button>
                      </div>
                      <span className="vente-meal-total mono">
                        {composerPlat ? formatFcfa(composerTotal) : "—"}
                      </span>
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={
                          !composerPlat ||
                          (mode === "pos" && !caisse) ||
                          busyKey === "meal"
                        }
                        onClick={() => void commitMeal()}
                      >
                        {busyKey === "meal"
                          ? "Enregistrement…"
                          : mode === "pos"
                            ? "Ajouter au panier"
                            : `Enregistrer${composerQty > 1 ? ` (${composerQty} plats)` : ""}`}
                      </button>
                    </div>
                  </>
                )}
              </section>
            ) : (
              <>
                {cat === "accompagnement" && accompagnements.length > 0 ? (
                  <p className="ui-info vente-acc-banner">
                    Vente à l&apos;unité — chaque + ajoute une portion au
                    panier.
                  </p>
                ) : null}

                <div className="vente-grid">
                {products.length === 0 ? (
                  <p className="muted vente-empty">Aucun produit.</p>
                ) : (
                  products.map((p) => {
                    const disabledPv =
                      p.kind === "boisson" && p.unitPrice <= 0;
                    const outOfStock =
                      p.stockLeft !== null &&
                      p.stockLeft !== undefined &&
                      p.stockLeft <= 0;
                    const plusBusy = busyKey === `${p.kind}:${p.productId}:1`;
                    const minusBusy =
                      busyKey === `${p.kind}:${p.productId}:-1`;
                    return (
                      <article
                        key={`${p.kind}-${p.productId}`}
                        className={`vente-card${disabledPv || outOfStock ? " is-disabled" : ""}${
                          p.lowStock && !outOfStock ? " is-low" : ""
                        }`}
                      >
                        <div className="vente-card-media" aria-hidden>
                          <ProductIcon kind={p.kind} name={p.name} size="lg" />
                          {p.lowStock && !outOfStock ? (
                            <span className="vente-low-badge">Bientôt épuisé</span>
                          ) : null}
                        </div>
                        <div className="vente-card-body">
                          <h3>{p.name}</h3>
                          <span className="vente-price mono">
                            {p.unitPrice > 0 ? formatFcfa(p.unitPrice) : "—"}
                          </span>
                          {p.hint ? (
                            <p className="vente-hint">{p.hint}</p>
                          ) : null}
                        </div>
                        {mode === "pos" ? (
                          <div className="vente-card-actions is-single">
                            <button
                              type="button"
                              className="vente-plus"
                              disabled={disabledPv || outOfStock || !caisse}
                              onClick={() => addToCart(p)}
                            >
                              +
                            </button>
                          </div>
                        ) : (
                          <div className="vente-card-actions">
                            <button
                              type="button"
                              className="vente-minus"
                              disabled={
                                !!busyKey || p.soldToday <= 0 || disabledPv
                              }
                              onClick={() => void sell(p, -1)}
                            >
                              {minusBusy ? "…" : "−"}
                            </button>
                            <span className="vente-qty mono">
                              {p.soldToday}
                            </span>
                            <button
                              type="button"
                              className="vente-plus"
                              disabled={!!busyKey || disabledPv || outOfStock}
                              onClick={() => void sell(p, 1)}
                            >
                              {plusBusy ? "…" : "+"}
                            </button>
                          </div>
                        )}
                      </article>
                    );
                  })
                )}
              </div>
              </>
            )}
          </div>

          {mode === "pos" ? (
            <aside className="pos-cart vente-panel">
              <header className="vente-panel-head">
                <h2>Panier</h2>
                <p>
                  {cart.length
                    ? `${cart.reduce((s, l) => s + l.qty, 0)} article${cart.reduce((s, l) => s + l.qty, 0) > 1 ? "s" : ""}`
                    : "Vide — touchez + sur un produit"}
                </p>
              </header>

              {!cart.length ? (
                <p className="muted vente-cart-empty">
                  Le panier apparaîtra ici.
                </p>
              ) : (
                <ul className="pos-cart-list">
                  {cart.map((l) => (
                    <li key={l.key}>
                      <div>
                        <strong>{l.name}</strong>
                        <div className="muted mono">
                          {formatFcfa(l.unitPrice)} × {l.qty}
                        </div>
                      </div>
                      <div className="vente-card-actions">
                        <button
                          type="button"
                          className="vente-minus"
                          onClick={() => changeCartQty(l.key, -1)}
                        >
                          −
                        </button>
                        <span className="vente-qty mono">{l.qty}</span>
                        <button
                          type="button"
                          className="vente-plus"
                          onClick={() => changeCartQty(l.key, 1)}
                        >
                          +
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <div className="pos-meta">
                <label className="vente-field">
                  <span>Type de vente</span>
                  <select
                    value={saleType}
                    onChange={(e) => setSaleType(e.target.value as SaleType)}
                  >
                    {SALE_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="vente-field">
                  <span>Paiement</span>
                  <select
                    value={paymentId}
                    onChange={(e) => setPaymentId(e.target.value)}
                  >
                    {(config?.paymentMethods || []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.libelle}
                      </option>
                    ))}
                  </select>
                </label>
                {saleType === "Sur place" ? (
                  <label className="vente-field">
                    <span>Table</span>
                    <select
                      value={tableId}
                      onChange={(e) => setTableId(e.target.value)}
                    >
                      <option value="">—</option>
                      {(config?.tables || []).map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.reference} · {t.emplacement}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <label className="vente-field">
                  <span>Serveur</span>
                  <select
                    value={serveurId}
                    onChange={(e) => setServeurId(e.target.value)}
                  >
                    <option value="">—</option>
                    {(config?.serveurs || []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.nom}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="vente-field">
                  <span>Client</span>
                  <input
                    value={clientNom}
                    onChange={(e) => setClientNom(e.target.value)}
                    placeholder="Nom client"
                  />
                </label>
                <label className="vente-field">
                  <span>Réduction (FCFA)</span>
                  <input
                    type="number"
                    min={0}
                    value={reduction}
                    onChange={(e) => setReduction(e.target.value)}
                  />
                </label>
              </div>

              <div className="pos-total">
                <span>Total</span>
                <strong className="mono">{formatFcfa(cartNet)}</strong>
              </div>
              <button
                type="button"
                className="btn btn-primary"
                disabled={posBusy || !cart.length || !caisse}
                onClick={() => void validateCart()}
              >
                {posBusy ? "Validation…" : "Créer la commande"}
              </button>

              {tickets.length > 0 ? (
                <div className="pos-tickets">
                  <h3 className="vente-tickets-title">
                    Tickets du jour · {tickets.length}
                  </h3>
                  <ul className="vente-log pos-tickets-scroll">
                    {tickets.map((t) => (
                      <li key={t.id}>
                        <div>
                          <strong>
                            {t.numero} · {t.saleType}
                          </strong>
                          <span className="muted mono">
                            {" "}
                            · {formatFcfa(t.montant)}
                          </span>
                          <div className="muted">
                            {t.statut === "valide"
                              ? "Validé"
                              : t.statut === "annule"
                                ? "Annulé"
                                : t.statut}
                          </div>
                        </div>
                        <div className="pos-ticket-actions">
                          {t.statut === "valide" ? (
                            <>
                              <button
                                type="button"
                                className="btn-link"
                                onClick={() =>
                                  printTicket(t, config?.company ?? null)
                                }
                              >
                                Imprimer
                              </button>
                              <button
                                type="button"
                                className="btn-link"
                                disabled={!!busyKey}
                                onClick={() => void cancelTicket(t)}
                              >
                                Annuler
                              </button>
                            </>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                  <Link href="/historique-ventes" className="vente-hist-link">
                    Voir tout l’historique des ventes
                  </Link>
                </div>
              ) : null}
            </aside>
          ) : null}
        </div>
      </div>

      <RegistreDrawer
        open={journalOpen}
        onClose={() => setJournalOpen(false)}
        title="Dernières ventes"
        subtitle={`${siteLabel} · montants en FCFA`}
      >
        {board?.recent.length ? (
          <ul className="vente-log">
            {board.recent.map((entry) => (
              <li key={entry.id}>
                <div>
                  <strong>
                    {entry.kind === "extra" ? "Extra · " : ""}
                    {entry.qty > 0 && entry.kind !== "extra" ? "+" : ""}
                    {entry.kind !== "extra" ? `${entry.qty} ` : ""}
                    {entry.name}
                  </strong>
                  <span className="muted mono">
                    {" "}
                    · {formatFcfa(entry.amount)}
                  </span>
                  <div className="vente-log-time muted">
                    {formatLogTime(entry.at)}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-link"
                  disabled={!!busyKey}
                  onClick={() => void undo(entry)}
                >
                  Annuler
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Aucune vente.</p>
        )}
        <Link href="/historique-ventes" className="vente-hist-link">
          Voir l’historique des ventes
        </Link>
      </RegistreDrawer>
    </AppShell>
  );
}
