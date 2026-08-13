"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { BrandLoader } from "@/components/brand-loader";
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

/** Nom de client, description d'extra… sont saisis libres : jamais injectés
 *  bruts dans le ticket, un « < » suffirait à en casser la mise en page. */
function esc(value: unknown): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c] as string,
  );
}

/** Renvoie false si le navigateur a bloqué la fenêtre d'impression. */
function printTicket(
  ticket: PosTicket,
  company: { nom?: string | null; contacts?: string | null; adresse?: string | null } | null,
): boolean {
  const w = window.open("", "_blank", "width=360,height=640");
  if (!w) return false;
  // Chaque ligne porte le détail complet : produit, quantité, prix unitaire
  // et montant — la facture imprimée doit se suffire à elle-même.
  const lines = ticket.lines
    .map(
      (l) =>
        `<div class="line"><span class="nom">${esc(l.name)}</span>` +
        `<span class="qte">${l.qty} × ${l.unitPrice.toLocaleString("fr-FR")}</span>` +
        `<span class="mnt">${l.amount.toLocaleString("fr-FR")} F</span></div>`,
    )
    .join("");
  const headerBits = [
    company?.nom || "King Fish Manager",
    company?.contacts,
    company?.adresse,
  ]
    .filter(Boolean)
    .map(esc);
  w.document.write(`<!doctype html><html><head><title>${esc(ticket.numero)}</title>
    <style>
      body{font-family:monospace;font-size:13px;padding:12px;max-width:280px;margin:0 auto}
      .center{text-align:center}.bold{font-weight:700}
      .hr{border-bottom:1px dashed #000;margin:8px 0}
      .flex{display:flex;justify-content:space-between;gap:6px;margin:2px 0}
      .line{display:grid;grid-template-columns:1fr auto;gap:0 6px;margin:4px 0}
      .line .nom{grid-column:1/-1;font-weight:700}
      .line .qte{opacity:.85}
      .line .mnt{text-align:right}
      .sub{font-size:11px;opacity:.85}
    </style></head><body>
    <div class="center bold">${headerBits[0]}</div>
    ${headerBits
      .slice(1)
      .map((b) => `<div class="center sub">${b}</div>`)
      .join("")}
    <div class="center">${esc(ticket.numero)} · ${esc(ticket.saleType)}</div>
    <div class="hr"></div>
    <div class="flex"><span>Date</span><span>${new Date(ticket.at).toLocaleString("fr-FR")}</span></div>
    <div class="flex"><span>Enregistré par</span><span>${esc(ticket.userName)}</span></div>
    ${ticket.clientNom ? `<div class="flex"><span>Client</span><span>${esc(ticket.clientNom)}</span></div>` : ""}
    <div class="hr"></div>${lines}<div class="hr"></div>
    <div class="flex"><span>Sous-total</span><span>${ticket.montantBrut.toLocaleString("fr-FR")} F</span></div>
    ${ticket.reduction ? `<div class="flex"><span>Réduction</span><span>−${ticket.reduction.toLocaleString("fr-FR")} F</span></div>` : ""}
    <div class="flex bold"><span>Total</span><span>${ticket.montant.toLocaleString("fr-FR")} F</span></div>
    <div class="flex"><span>Paiement</span><span>${esc(ticket.paymentLabel) || "—"}</span></div>
    <div class="hr"></div><div class="center">Merci</div>
    </body></html>`);
  w.document.close();
  w.focus();
  w.print();
  return true;
}

export function VentePage({ canViewHistory = false }: { canViewHistory?: boolean }) {
  const pathname = usePathname();
  const [date, setDate] = useState(() => todayIsoDate());
  const [site, setSite] = useState<VenteSite>("gbegamey");
  const [allowedSites, setAllowedSites] = useState<VenteSite[]>([]);
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
  const [clientNom, setClientNom] = useState("");
  const [reduction, setReduction] = useState("0");
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [journalOpen, setJournalOpen] = useState(false);
  const [extraDesc, setExtraDesc] = useState("");
  const [extraPrice, setExtraPrice] = useState("");
  const [posBusy, setPosBusy] = useState(false);
  const [composerPlatId, setComposerPlatId] = useState("");
  const [composerAccQtys, setComposerAccQtys] = useState<Record<string, number>>({});
  const [composerQty, setComposerQty] = useState(1);
  /** Compte connecté : c'est lui qui répond de l'opération sur la facture. */
  const [operateur, setOperateur] = useState<string | null>(null);
  /** Facture du dernier ticket validé — générée systématiquement. */
  const [facture, setFacture] = useState<PosTicket | null>(null);
  /** Alerte transitoire quand un produit vient de s'épuiser (rupture). */
  const [ruptureAlert, setRuptureAlert] = useState<string | null>(null);
  /** Ruptures connues au dernier chargement (pour ne signaler que les nouvelles). */
  const prevRuptures = useRef<Set<string> | null>(null);
  const ruptureAlertTimer = useRef<number | null>(null);

  /** Produits actuellement à zéro (plats/boissons suivis). Accompagnements : jamais bloqués. */
  const ruptureCount = useMemo(
    () =>
      board?.products.filter(
        (p) =>
          p.kind !== "local" &&
          p.stockLeft !== null &&
          p.stockLeft !== undefined &&
          p.stockLeft <= 0,
      ).length ?? 0,
    [board],
  );

  useEffect(() => {
    if (!board) return;
    const ruptures = new Set(
      board.products
        .filter(
          (p) =>
            p.kind !== "local" &&
            p.stockLeft !== null &&
            p.stockLeft !== undefined &&
            p.stockLeft <= 0,
        )
        .map((p) => p.name),
    );
    if (prevRuptures.current === null) {
      prevRuptures.current = ruptures;
      return;
    }
    const nouvelles = [...ruptures].filter(
      (name) => !prevRuptures.current!.has(name),
    );
    prevRuptures.current = ruptures;
    if (nouvelles.length === 0) return;
    setRuptureAlert(
      `${nouvelles.length === 1 ? "ÉPUISÉ :" : "ÉPUISÉS :"} ${nouvelles.join(", ")}`,
    );
    if (ruptureAlertTimer.current !== null) {
      window.clearTimeout(ruptureAlertTimer.current);
    }
    ruptureAlertTimer.current = window.setTimeout(
      () => setRuptureAlert(null),
      8000,
    );
  }, [board]);

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
      setAllowedSites(
        (venteBody.allowedSites as VenteSite[] | undefined) ?? [],
      );

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
  }, [date, site, pathname]);

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

  // Compte connecté : affiché sur le panier et repris sur la facture, pour
  // qu'on sache toujours qui a enregistré l'opération.
  useEffect(() => {
    let annule = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        if (!res.ok) return;
        const body = await res.json();
        if (!annule) setOperateur(body.user?.name ?? null);
      } catch {
        /* le serveur renverra de toute façon le nom sur le ticket */
      }
    })();
    return () => {
      annule = true;
    };
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
    setComposerQty(1);
    if (!composerPlatId) {
      setComposerAccQtys({});
      return;
    }
    if (!platDefStatic) return;
    const allowed = new Set(platDefStatic.accompanimentIds);
    setComposerAccQtys((prev) =>
      Object.fromEntries(
        Object.entries(prev).filter(([id]) => allowed.has(id)),
      ),
    );
  }, [composerPlatId, platDefStatic]);

  const composerTotal = useMemo(() => {
    const plat = composerPlat;
    if (!composerPlatId || !plat) return 0;
    const accTotal = composerAccOptions.reduce(
      (s, a) => s + accPriceFor(a) * (composerAccQtys[a.productId] ?? 0),
      0,
    );
    return plat.unitPrice * composerQty + accTotal;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composerPlat, composerPlatId, composerAccQtys, composerAccOptions, composerQty]);

  function changeComposerAccQty(productId: string, delta: number) {
    setComposerAccQtys((prev) => {
      const next = { ...prev, [productId]: Math.max(0, (prev[productId] ?? 0) + delta) };
      if (next[productId] === 0) delete next[productId];
      return next;
    });
  }

  function resetComposer() {
    setComposerPlatId("");
    setComposerAccQtys({});
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
    const accLines = composerAccOptions
      .filter((a) => (composerAccQtys[a.productId] ?? 0) > 0)
      .map((a) => ({ acc: a, qty: composerAccQtys[a.productId] ?? 0 }));

    addToCart(composerPlat, undefined, composerQty);
    for (const { acc, qty } of accLines) {
      addToCart(acc, accPriceFor(acc), qty);
    }
    resetComposer();
    setError(null);
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
    // Accompagnements toujours vendables, même à stock nul.
    if (
      product.kind !== "local" &&
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
    // Référence de poste attribuée AVANT l'envoi : si la commande part mais que
    // la réponse se perd, le rejeu portera la même référence et le serveur
    // reconnaîtra la vente au lieu de l'encaisser deux fois.
    const reference = `pos-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const corps = {
      action: "validate",
      date,
      site,
      saleType,
      paymentMethodId: paymentId || undefined,
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
          headers: {
            "Content-Type": "application/json",
            "X-Vente-Locale": reference,
          },
          body: JSON.stringify(corps),
        });
      } catch {
        // Réseau coupé en plein service : la vente est mise de côté et rejouée
        // au retour de la connexion, plutôt que perdue.
        ajouterEnAttente(corps, reference);
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
      // La commande créée ouvre systématiquement sa facture : le détail complet
      // s'affiche à l'écran, l'impression n'est qu'un geste de plus.
      if (body.ticket) setFacture(body.ticket as PosTicket);
      await load();
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
    setError(null);
  }

  return (
    <AppShell
      title="Vente"
      subtitle={`${siteLabel} · panier multi-articles · ticket`}
      /* Poste de vente : tenu à hauteur d'écran, la page ne défile pas. */
      mainClassName="main-vente"
    >
      <div className="vente-page">
        <ContextBar date={date} onDateChange={setDate} siteLabel={siteLabel}>
          <ExportExcelButton
            onExport={() => exportVenteExcel(date, site)}
            disabled={loading}
          />
          {canViewHistory ? (
            <Link href="/historique-ventes" className="btn btn-ghost">
              Historique
            </Link>
          ) : null}
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setJournalOpen(true)}
          >
            Journal ({recentCount})
          </button>
        </ContextBar>

        {ruptureAlert ? (
          <div className="vente-rupture-alert" role="alert">
            <strong>{ruptureAlert}</strong>
            <span className="vente-rupture-alert-sub">
              — réapprovisionnez ou mettez à jour le comptage pour revendre.
            </span>
            <button
              type="button"
              className="vente-rupture-alert-close"
              aria-label="Fermer l'alerte"
              onClick={() => setRuptureAlert(null)}
            >
              ×
            </button>
          </div>
        ) : null}

        {ruptureCount > 0 ? (
          <div className="vente-rupture-bar" role="status">
            <strong>
              {ruptureCount} produit{ruptureCount > 1 ? "s" : ""} épuisé
              {ruptureCount > 1 ? "s" : ""}
            </strong>
            <span>— vente bloquée tant que le stock n'est pas renseigné.</span>
          </div>
        ) : null}

        <div className={`vente-hero${caisse ? " is-ready" : " is-idle"}`}>
          <div className="vente-hero-main">
            <span className="vente-hero-status">
              <span className="vente-hero-dot" aria-hidden />
              {caisse
                ? `Caisse ${siteLabel} ouverte`
                : loading
                  ? "Chargement de la caisse…"
                  : `Caisse ${siteLabel} fermée`}
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
                : loading
                  ? "Chargement de la caisse…"
                  : caisse
                    ? `Ajoutez au panier puis validez · tiroir ouvert par ${caisse.userName}`
                    : "Ouvrez la caisse de la zone pour encaisser"}
            </span>
          </div>
          <div className="vente-hero-side">
              {allowedSites.length > 1 ? (
                <div
                  className="site-switch site-switch-vente"
                  role="tablist"
                  aria-label="Site"
                >
                  {allowedSites.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={`site-btn${site === s ? " is-active" : ""}`}
                      onClick={() => setSite(s)}
                    >
                      {s === "zogbo" ? "Zogbo" : "Gbégamey"}
                    </button>
                  ))}
                </div>
              ) : null}
            {loading ? null : !caisse ? (
              <Link
                href={`/caisse?caisse=${site}`}
                className="btn btn-primary vente-hero-cta"
              >
                Ouvrir la caisse
              </Link>
            ) : (
              <Link
                href={`/caisse?caisse=${site}`}
                className="btn btn-ghost vente-hero-cta"
              >
                Voir la caisse
              </Link>
            )}
          </div>
        </div>

        {!loading && !caisse ? (
          <p className="error-banner" role="alert">
            Caisse {siteLabel} fermée.{" "}
            <Link href={`/caisse?caisse=${site}`}>
              Ouvrir la caisse de la zone
            </Link>{" "}
            pour valider des tickets.
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
              <BrandLoader variant="ligne" label="Chargement du catalogue…" />
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
                  />
                </label>
                <label className="vente-extra-field">
                  <span>Prix (FCFA)</span>
                  <input
                    className="qty-input vente-extra-price"
                    inputMode="numeric"
                    value={extraPrice}
                    onChange={(e) => setExtraPrice(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!extraDesc.trim() || !caisse}
                  onClick={() => void submitExtra()}
                >
                  Ajouter au panier
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
                    <div className="vente-meal-plat-row">
                      <label className="vente-field vente-field-plat">
                        <span>Plat</span>
                        <select
                          value={composerPlatId}
                          onChange={(e) => setComposerPlatId(e.target.value)}
                        >
                          <option value="">— Choisir —</option>
                          {plats.map((p) => {
                            const platEpuise =
                              p.stockLeft !== null &&
                              p.stockLeft !== undefined &&
                              p.stockLeft <= 0;
                            return (
                              <option
                                key={p.productId}
                                value={p.productId}
                                disabled={platEpuise}
                              >
                                {p.name}
                                {platEpuise ? " · ÉPUISÉ" : ""}
                                {p.unitPrice > 0
                                  ? ` · ${formatFcfa(p.unitPrice)}`
                                  : ""}
                              </option>
                            );
                          })}
                        </select>
                      </label>
                      <div className="vente-meal-qty">
                        <span className="vente-qty-label">Qté</span>
                        <div className="vente-meal-qty-stepper">
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
                      </div>
                    </div>
                    {composerPlat?.hint ? (
                      <p className="vente-hint">{composerPlat.hint}</p>
                    ) : null}
                    {composerAccOptions.length > 0 ? (
                      <fieldset className="vente-acc-picker">
                        <legend>Accompagnements (optionnel) — quantité par ligne</legend>
                        <ul className="vente-acc-list">
                          {composerAccOptions.map((a) => {
                            const accQty = composerAccQtys[a.productId] ?? 0;
                            const accPrice = accPriceFor(a);
                            return (
                              <li key={a.productId}>
                                <div className="vente-acc-option">
                                  <span className="vente-acc-option-name">
                                    <span>
                                      {a.name}
                                      {accPrice > 0
                                        ? ` · ${formatFcfa(accPrice)}`
                                        : ""}
                                    </span>
                                    {a.hint ? (
                                      <span className="vente-hint-inline">
                                        {" "}
                                        · {a.hint}
                                      </span>
                                    ) : null}
                                  </span>
                                  <span className="vente-acc-qty">
                                    <button
                                      type="button"
                                      className="vente-minus"
                                      aria-label={`Moins de ${a.name}`}
                                      disabled={accQty <= 0 || !!busyKey}
                                      onClick={() =>
                                        changeComposerAccQty(a.productId, -1)
                                      }
                                    >
                                      −
                                    </button>
                                    <span className="vente-qty mono">
                                      {accQty}
                                    </span>
                                    <button
                                      type="button"
                                      className="vente-plus"
                                      aria-label={`Plus de ${a.name}`}
                                      disabled={!!busyKey}
                                      onClick={() =>
                                        changeComposerAccQty(a.productId, 1)
                                      }
                                    >
                                      +
                                    </button>
                                  </span>
                                </div>
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
                      <span className="vente-meal-total mono">
                        {composerPlat ? formatFcfa(composerTotal) : "—"}
                      </span>
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={!composerPlat || !caisse}
                        onClick={() => void commitMeal()}
                      >
                        Ajouter au panier
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
                    // Accompagnements toujours vendables, même à stock nul.
                    const outOfStock =
                      p.kind !== "local" &&
                      p.stockLeft !== null &&
                      p.stockLeft !== undefined &&
                      p.stockLeft <= 0;
                    return (
                      <article
                        key={`${p.kind}-${p.productId}`}
                        className={`vente-card${disabledPv || outOfStock ? " is-disabled" : ""}${
                          p.lowStock && !outOfStock ? " is-low" : ""
                        }`}
                      >
                        <div className="vente-card-media" aria-hidden>
                          <ProductIcon kind={p.kind} name={p.name} size="lg" />
                          {outOfStock ? (
                            <span className="vente-out-badge">ÉPUISÉ</span>
                          ) : p.lowStock && !outOfStock ? (
                            <span className="vente-low-badge">
                              Bientôt épuisé
                            </span>
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
                      </article>
                    );
                  })
                )}
              </div>
              </>
            )}
          </div>

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
                {/* Ni table ni serveur à choisir : c'est le compte connecté
                    qui répond de l'opération, il n'y a rien à saisir. */}
                <div className="vente-field vente-field-static">
                  <span>Enregistré par</span>
                  <strong>{operateur ?? "…"}</strong>
                </div>
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

              <div className="pos-cart-foot">
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
              </div>

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
                                onClick={() => setFacture(t)}
                              >
                                Facture
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
                  {canViewHistory ? (
                    <Link href="/historique-ventes" className="vente-hist-link">
                      Voir tout l’historique des ventes
                    </Link>
                  ) : null}
                </div>
              ) : null}
          </aside>
        </div>
      </div>

      {/* Opération en cours : le logo occupe l'écran et absorbe les clics,
          le temps que le serveur réponde. */}
      {posBusy ? <BrandLoader variant="voile" label="Enregistrement de la commande…" /> : null}

      {/* Facture de la commande : générée à chaque validation, elle porte le
          détail complet de la transaction avant toute impression. */}
      {facture ? (
        <div
          className="facture-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={`Facture ${facture.numero}`}
        >
          <div className="facture-card">
            <header className="facture-head">
              <div>
                <h2>Facture {facture.numero}</h2>
                <p className="muted">
                  {formatLogTime(facture.at)} · {facture.saleType} ·{" "}
                  {facture.site === "zogbo" ? "Zogbo" : "Gbégamey"}
                </p>
              </div>
              <strong className="facture-total mono">
                {formatFcfa(facture.montant)}
              </strong>
            </header>

            <dl className="facture-meta">
              <div>
                <dt>Enregistré par</dt>
                <dd>{facture.userName}</dd>
              </div>
              <div>
                <dt>Paiement</dt>
                <dd>{facture.paymentLabel || "—"}</dd>
              </div>
              <div>
                <dt>Client</dt>
                <dd>{facture.clientNom || "—"}</dd>
              </div>
              <div>
                <dt>Statut</dt>
                <dd>{facture.statut === "valide" ? "Validée" : "Annulée"}</dd>
              </div>
            </dl>

            <div className="facture-lignes-scroll">
              <table className="data-table facture-lignes">
                <thead>
                  <tr>
                    <th>Produit</th>
                    <th className="col-num">Qté</th>
                    <th className="col-money">P.U.</th>
                    <th className="col-money">Montant</th>
                  </tr>
                </thead>
                <tbody>
                  {facture.lines.map((l, i) => (
                    <tr key={`${l.productId}-${i}`}>
                      <td>{l.name}</td>
                      <td className="col-num mono">{l.qty}</td>
                      <td className="col-money mono">
                        {formatFcfa(l.unitPrice)}
                      </td>
                      <td className="col-money mono">{formatFcfa(l.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th colSpan={3}>Sous-total</th>
                    <td className="col-money mono">
                      {formatFcfa(facture.montantBrut)}
                    </td>
                  </tr>
                  {facture.reduction ? (
                    <tr>
                      <th colSpan={3}>Réduction</th>
                      <td className="col-money mono">
                        −{formatFcfa(facture.reduction)}
                      </td>
                    </tr>
                  ) : null}
                  <tr className="facture-total-row">
                    <th colSpan={3}>Total</th>
                    <td className="col-money mono">
                      {formatFcfa(facture.montant)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="facture-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setFacture(null)}
              >
                Fermer
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  // Déclenchée par le clic : la fenêtre d'impression ne peut
                  // plus être bloquée comme elle l'était en automatique.
                  if (!printTicket(facture, config?.company ?? null)) {
                    setError(
                      "Impression bloquée par le navigateur — autorisez les fenêtres pop-up pour ce site.",
                    );
                  }
                }}
              >
                Imprimer la facture
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
        {canViewHistory ? (
            <Link href="/historique-ventes" className="vente-hist-link">
              Voir l’historique des ventes
            </Link>
          ) : null}
      </RegistreDrawer>
    </AppShell>
  );
}
