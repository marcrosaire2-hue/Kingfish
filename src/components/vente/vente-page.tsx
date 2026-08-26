"use client";

import Link from "next/link";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  marquerRejetsTraites,
  nombreEnAttente,
  rejetsEnAttente,
  setOfflineQueueUser,
  surRejet,
  type VenteRejetee,
} from "@/lib/offline-queue";
import { exportVenteExcel } from "@/lib/page-exports";
import {
  accompanimentUnitPrice,
  getZogboPlat,
} from "@/lib/catalog-zogbo";
import type {
  CaisseSession,
  Immobilisation,
  PosConfig,
  PosTicket,
  SaleType,
  VenteLogEntry,
  VenteProduct,
  VenteSite,
} from "@/lib/types";
import { previousIsoDate, shiftIsoDate, todayIsoDate } from "@/lib/zogbo-calc";

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
  extra: "Hors catalogue",
};

const SALE_TYPES: SaleType[] = ["Sur place", "Rapido"];

/** Instance unique : construire un Intl.DateTimeFormat par ligne de journal
 *  et à chaque render coûtait cher sur mobile. */
const LOG_TIME_FORMAT = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "short",
  timeStyle: "medium",
  timeZone: "Africa/Porto-Novo",
});

function formatLogTime(iso: string): string {
  try {
    return LOG_TIME_FORMAT.format(new Date(iso));
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
  company: {
    nom?: string | null;
    contacts?: string | null;
    adresse?: string | null;
  } | null,
): boolean {
  const w = window.open("", "_blank", "width=360,height=680");
  if (!w) return false;
  // HTML pur (pas de JSX) : sinon les lignes deviennent « [object Object] »
  // et les noms d'articles disparaissent à l'impression.
  const rows = ticket.lines
    .map(
      (l) =>
        `<tr>` +
        `<td class="prod">${esc(l.name)}</td>` +
        `<td class="qte">${l.qty}</td>` +
        `<td class="puni">${l.unitPrice.toLocaleString("fr-FR")} F</td>` +
        `<td class="mnt">${l.amount.toLocaleString("fr-FR")} F</td>` +
        `</tr>`,
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
      body{font-family:monospace;font-size:12px;padding:8px;max-width:280px;margin:0 auto;line-height:1.35}
      .center{text-align:center}.bold{font-weight:700}
      .hr{border-bottom:1px dashed #000;margin:6px 0}
      .flex{display:flex;justify-content:space-between;gap:4px;margin:2px 0}
      .sub{font-size:10px;opacity:.85}
      table{border-collapse:collapse;width:100%;margin:4px 0 8px}
      th,td{border-bottom:1px dotted #999;padding:3px 2px;vertical-align:top}
      th{text-align:left;font-size:10px;border-bottom:1px solid #000}
      td.prod{font-size:11px;font-weight:700;text-align:left}
      td.qte{font-size:10px;text-align:center;white-space:nowrap}
      td.puni,td.mnt{font-size:10px;text-align:right;white-space:nowrap}
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
    <div class="hr"></div>
    <table>
      <thead>
        <tr>
          <th>Produit</th>
          <th>Qté</th>
          <th>P.U.</th>
          <th>Montant</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
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

/* ---------------------------------------------------------------- *
 * Sous-composants mémoïsés : une frappe dans les champs du panier ne
 * re-rend plus la grille produit ni les listes, sur mobile c'est ce
 * qui faisait saccader le défilement.
 * ---------------------------------------------------------------- */

type ProductGridProps = {
  products: VenteProduct[];
  canSell: boolean;
  /** Correction gérant : vente possible même sans stock. */
  ignoreStock?: boolean;
  onAdd: (product: VenteProduct) => void;
};

const ProductGrid = memo(function ProductGrid({
  products,
  canSell,
  ignoreStock = false,
  onAdd,
}: ProductGridProps) {
  if (products.length === 0) {
    return <p className="muted vente-empty">Aucun produit.</p>;
  }
  return (
    <div className="vente-grid">
      {products.map((p) => {
        const disabledPv = p.kind === "boisson" && p.unitPrice <= 0;
        // Accompagnements toujours vendables, même à stock nul.
        const outOfStock =
          !ignoreStock &&
          p.kind !== "local" &&
          p.stockLeft !== null &&
          p.stockLeft !== undefined &&
          p.stockLeft <= 0;
        const blocked = disabledPv || outOfStock || !canSell;
        const reason = !canSell
          ? "Ouvrez la caisse pour vendre"
          : disabledPv
            ? p.blockReason || "Prix de vente manquant"
            : outOfStock
              ? p.blockReason || p.hint || "Stock insuffisant"
              : null;
        const badgeLabel =
          outOfStock && p.blockReason?.toLowerCase().includes("pas encore reçu")
            ? "PAS REÇU"
            : outOfStock && p.blockReason?.toLowerCase().includes("pas encore préparé")
              ? "À PRÉPARER"
              : outOfStock
                ? "ÉPUISÉ"
                : null;
        return (
          <article
            key={`${p.kind}-${p.productId}`}
            className={`vente-card${blocked ? " is-disabled" : ""}${
              p.lowStock && !outOfStock ? " is-low" : ""
            }`}
            title={reason ?? p.hint ?? undefined}
          >
            <div className="vente-card-media" aria-hidden>
              <ProductIcon kind={p.kind} name={p.name} size="lg" />
              {badgeLabel ? (
                <span
                  className={`vente-out-badge${
                    badgeLabel === "PAS REÇU" || badgeLabel === "À PRÉPARER"
                      ? " is-wait"
                      : ""
                  }`}
                >
                  {badgeLabel}
                </span>
              ) : p.lowStock && !outOfStock ? (
                <span className="vente-low-badge">Bientôt épuisé</span>
              ) : null}
            </div>
            <div className="vente-card-body">
              <h3>{p.name}</h3>
              <span className="vente-price mono">
                {p.unitPrice > 0 ? formatFcfa(p.unitPrice) : "—"}
              </span>
              {reason ? (
                <p className="vente-unavailable-reason">{reason}</p>
              ) : p.hint ? (
                <p className="vente-hint">{p.hint}</p>
              ) : null}
            </div>
            <div className="vente-card-actions is-single">
              <button
                type="button"
                className="vente-plus"
                disabled={blocked}
                aria-label={
                  reason ? `${p.name} — ${reason}` : `Ajouter ${p.name}`
                }
                onClick={() => onAdd(p)}
              >
                +
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
});

type MealComposerProps = {
  plats: VenteProduct[];
  canSell: boolean;
  /** Correction gérant : vente possible même sans stock. */
  ignoreStock?: boolean;
  busyKey: string | null;
  composerPlatId: string;
  composerPlat: VenteProduct | null;
  composerQty: number;
  composerAccOptions: VenteProduct[];
  composerAccQtys: Record<string, number>;
  composerTotal: number;
  onSelectPlat: (id: string) => void;
  onQtyChange: (delta: number) => void;
  onAccQtyChange: (productId: string, delta: number) => void;
  onCommit: () => void;
  accPriceFor: (acc: VenteProduct) => number;
};

const MealComposer = memo(function MealComposer({
  plats,
  canSell,
  ignoreStock = false,
  busyKey,
  composerPlatId,
  composerPlat,
  composerQty,
  composerAccOptions,
  composerAccQtys,
  composerTotal,
  onSelectPlat,
  onQtyChange,
  onAccQtyChange,
  onCommit,
  accPriceFor,
}: MealComposerProps) {
  return (
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
                onChange={(e) => onSelectPlat(e.target.value)}
              >
                <option value="">— Choisir —</option>
                {plats.map((p) => {
                  const platEpuise =
                    !ignoreStock &&
                    p.stockLeft !== null &&
                    p.stockLeft !== undefined &&
                    p.stockLeft <= 0;
                  const suffix = platEpuise
                    ? ` · ${p.blockReason || "ÉPUISÉ"}`
                    : !ignoreStock
                      ? ""
                      : p.stockLeft != null && p.stockLeft <= 0
                        ? " · sans stock (correction)"
                        : "";
                  return (
                    <option
                      key={p.productId}
                      value={p.productId}
                      disabled={platEpuise}
                    >
                      {p.name}
                      {suffix}
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
                  onClick={() => onQtyChange(-1)}
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
                    (!ignoreStock &&
                      composerPlat.stockLeft !== null &&
                      composerPlat.stockLeft !== undefined &&
                      composerQty >= composerPlat.stockLeft)
                  }
                  onClick={() => onQtyChange(1)}
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
                              onAccQtyChange(a.productId, -1)
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
                              onAccQtyChange(a.productId, 1)
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
              disabled={!composerPlat || !canSell}
              onClick={() => onCommit()}
            >
              Ajouter au panier
            </button>
          </div>
        </>
      )}
    </section>
  );
});

type CartLinesProps = {
  cart: CartLine[];
  onChangeQty: (key: string, delta: number) => void;
};

const CartLines = memo(function CartLines({
  cart,
  onChangeQty,
}: CartLinesProps) {
  return (
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
              onClick={() => onChangeQty(l.key, -1)}
            >
              −
            </button>
            <span className="vente-qty mono">{l.qty}</span>
            <button
              type="button"
              className="vente-plus"
              onClick={() => onChangeQty(l.key, 1)}
            >
              +
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
});

type TicketsListProps = {
  tickets: PosTicket[];
  busyKey: string | null;
  canViewHistory: boolean;
  canPurge: boolean;
  onFacture: (ticket: PosTicket) => void;
  onCancel: (ticket: PosTicket) => void;
  onDeletePermanent: (ticket: PosTicket) => void;
};

const TicketsList = memo(function TicketsList({
  tickets,
  busyKey,
  canViewHistory,
  canPurge,
  onFacture,
  onCancel,
  onDeletePermanent,
}: TicketsListProps) {
  return (
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
                    onClick={() => onFacture(t)}
                  >
                    Facture
                  </button>
                  <button
                    type="button"
                    className="btn-link"
                    disabled={!!busyKey}
                    onClick={() => onCancel(t)}
                  >
                    Annuler
                  </button>
                  {canPurge ? (
                    <button
                      type="button"
                      className="btn-link btn-link-danger"
                      disabled={!!busyKey}
                      onClick={() => onDeletePermanent(t)}
                    >
                      Suppr. déf.
                    </button>
                  ) : null}
                </>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {canViewHistory ? (
        <Link href="/journal-ventes" className="vente-hist-link">
          Voir le journal des ventes
        </Link>
      ) : null}
    </div>
  );
});

export function VentePage({ canViewHistory = false }: { canViewHistory?: boolean }) {
  const pathname = usePathname();
  const [date, setDate] = useState(() => todayIsoDate());
  /** Remplacé dès /api/auth/me : évite un premier fetch Zogbo→gbegamey. */
  const [site, setSite] = useState<VenteSite>("gbegamey");
  const [sessionReady, setSessionReady] = useState(false);
  const [allowedSites, setAllowedSites] = useState<VenteSite[]>([]);
  /** Ventes encaissées hors ligne, en attente d'envoi au serveur. */
  const [enAttente, setEnAttente] = useState(0);
  const [rejets, setRejets] = useState<VenteRejetee[]>([]);
  const [cat, setCat] = useState<CatKey>("plat");
  const [board, setBoard] = useState<Board | null>(null);
  const [config, setConfig] = useState<PosConfig | null>(null);
  const [caisse, setCaisse] = useState<CaisseSession | null>(null);
  const [caisseActive, setCaisseActive] = useState<CaisseSession | null>(null);
  const [backdateMode, setBackdateMode] = useState(false);
  const [openingCaisse, setOpeningCaisse] = useState(false);
  const [tickets, setTickets] = useState<PosTicket[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [saleType, setSaleType] = useState<SaleType>("Sur place");
  const [emballages, setEmballages] = useState<Immobilisation[]>([]);
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
  const [canManagePast, setCanManagePast] = useState(false);
  const [canPurge, setCanPurge] = useState(false);
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

  /** Compteur : ignore les réponses d’un chargement plus ancien (changement
   *  rapide de date dans le calendrier). */
  const loadSeq = useRef(0);

  async function load(nextDate = date, nextSite = site) {
    const seq = ++loadSeq.current;
    // Rechargement silencieux quand la page affiche déjà des données : pas de
    // gel sur un loader, les produits restent sous le doigt pendant la mise
    // à jour. Seul le premier chargement (ou changement de jour/site) fige.
    if (!board) setLoading(true);
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
      if (seq !== loadSeq.current) return;

      const venteBody = await venteRes.json();
      if (!venteRes.ok) throw new Error(venteBody.error || "Erreur vente");
      if (seq !== loadSeq.current) return;

      setBoard(venteBody as Board);
      setCanManagePast(Boolean(venteBody.canManagePast));
      setCanPurge(Boolean(venteBody.canPurge));
      if (venteBody.site) setSite(venteBody.site as VenteSite);
      setAllowedSites(
        (venteBody.allowedSites as VenteSite[] | undefined) ?? [],
      );

      if (posRes.ok) {
        const posBody = await posRes.json();
        if (seq !== loadSeq.current) return;
        setConfig(posBody.config as PosConfig);
        setCaisse(posBody.caisse as CaisseSession | null);
        setCaisseActive(
          (posBody.caisseActive as CaisseSession | null) ??
            (posBody.caisse as CaisseSession | null),
        );
        setBackdateMode(Boolean(posBody.backdate));
        setTickets((posBody.tickets as PosTicket[]) || []);
        if (!paymentId && posBody.config?.paymentMethods?.[0]?.id) {
          setPaymentId(posBody.config.paymentMethods[0].id);
        }
        // Aligner la date sur le POS (date de caisse ou jour de correction).
        // Gérant sur un jour passé : on garde la date demandée (filtre calendrier).
        const resolved =
          typeof posBody.date === "string"
            ? posBody.date
            : typeof venteBody.date === "string"
              ? venteBody.date
              : null;
        const managerPast =
          Boolean(posBody.canManagePast ?? venteBody.canManagePast) &&
          nextDate < todayIsoDate();
        if (resolved && resolved !== nextDate && !managerPast) {
          setDate(resolved);
          setFlash(
            `Jour ramené au ${resolved.slice(8)}/${resolved.slice(5, 7)} (caisse ouverte). Pour un autre jour, choisissez une date passée.`,
          );
        }
      } else if (
        typeof venteBody.date === "string" &&
        venteBody.date !== nextDate
      ) {
        const managerPast =
          Boolean(venteBody.canManagePast) && nextDate < todayIsoDate();
        if (!managerPast) {
          setDate(venteBody.date);
        }
      }
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setError(e instanceof Error ? e.message : "Erreur de chargement");
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }

  /** Ouvre la caisse de la zone sans quitter l'écran de vente. */
  async function openCaisseHere() {
    setOpeningCaisse(true);
    setError(null);
    try {
      const res = await fetch("/api/caisse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "open",
          date,
          caisse: site,
          soldeInitial: 0,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        const msg = String(body.error || "Ouverture caisse impossible");
        // Tiroir déjà ouvert ailleurs : on se rattache au lieu d'afficher
        // « fermée » + erreur contradictoire.
        if (/déjà ouverte/i.test(msg)) {
          await load(date, site);
          setFlash(msg.replace(/\.$/, "") + " — session reprise.");
          return;
        }
        throw new Error(msg);
      }
      await load(date, site);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ouverture caisse impossible");
    } finally {
      setOpeningCaisse(false);
    }
  }

  /** Revenir au jour de la caisse ouverte (souvent le service en cours). */
  async function rejoindreCaisseActive() {
    if (!caisseActive?.date) return;
    setDate(caisseActive.date);
  }

  useEffect(() => {
    if (!sessionReady) return;
    void load(date, site);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, site, pathname, sessionReady]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/immobilisations?kind=emballage&active=1&site=${encodeURIComponent(site)}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const body = await res.json();
        if (cancelled) return;
        const list = ((body.items as Immobilisation[]) || []).filter(
          (i) => i.active && (i.salePrice ?? 0) > 0,
        );
        setEmballages(list);
      } catch {
        if (!cancelled) setEmballages([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [site]);

  /** Encaissement possible : caisse du jour, ou correction gérant (backdate). */
  const canSell = Boolean(caisse) || backdateMode;

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
  // Les refus définitifs au rejeu (stock épuisé entre-temps, caisse fermée…)
  // remontent en alerte : une vente perdue ne doit jamais rester silencieuse.
  useEffect(() => {
    const desabonnerRejet = surRejet((liste) => setRejets(liste));
    const desabonnerFile = installerSupportHorsLigne((file) =>
      setEnAttente(file.length),
    );
    // Lecture initiale des rejets déjà connus, hors du corps synchrone de
    // l'effet (un setState direct ici provoquerait un rendu en cascade).
    let lu = false;
    void Promise.resolve().then(() => {
      if (!lu) setRejets(rejetsEnAttente());
    });
    return () => {
      lu = true;
      desabonnerRejet();
      desabonnerFile();
    };
  }, []);

  // Compte connecté : zone POS avant le premier chargement + opérateur facture.
  useEffect(() => {
    let annule = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        if (!res.ok) {
          if (!annule) setSessionReady(true);
          return;
        }
        const body = await res.json();
        if (annule) return;
        setOperateur(body.user?.name ?? null);
        if (typeof body.user?.id === "string") {
          setOfflineQueueUser(body.user.id);
        }
        const userSite = body.user?.site as VenteSite | "tous" | undefined;
        if (userSite === "zogbo" || userSite === "gbegamey") {
          setSite(userSite);
          setAllowedSites([userSite]);
        } else if (Array.isArray(body.allowedSites) && body.allowedSites.length) {
          setAllowedSites(body.allowedSites as VenteSite[]);
          const first = body.allowedSites[0];
          if (first === "zogbo" || first === "gbegamey") setSite(first);
        }
      } catch {
        /* le serveur renverra de toute façon le nom sur le ticket */
      } finally {
        if (!annule) setSessionReady(true);
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
  const accPriceFor = useCallback(
    (acc: VenteProduct): number => {
      if (!composerPlatId || !platDefStatic) return acc.unitPrice;
      return accompanimentUnitPrice(composerPlatId, acc.productId);
    },
    [composerPlatId, platDefStatic],
  );

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

  const changeComposerAccQty = useCallback((productId: string, delta: number) => {
    setComposerAccQtys((prev) => {
      const next = { ...prev, [productId]: Math.max(0, (prev[productId] ?? 0) + delta) };
      if (next[productId] === 0) delete next[productId];
      return next;
    });
  }, []);

  const changeComposerQty = useCallback(
    (delta: number) => setComposerQty((q) => Math.max(1, q + delta)),
    [],
  );

  const resetComposer = useCallback(() => {
    setComposerPlatId("");
    setComposerAccQtys({});
    setComposerQty(1);
  }, []);

  const addToCart = useCallback(
    (product: VenteProduct, unitPriceOverride?: number, qty = 1) => {
      if (product.kind === "boisson" && product.unitPrice <= 0) return;
      // Accompagnements toujours vendables, même à stock nul.
      // Correction gérant (jour passé) : stock non bloquant.
      if (
        !backdateMode &&
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
    },
    [backdateMode],
  );

  const addEmballage = useCallback(
    (item: Immobilisation) => {
      const unitPrice = Math.round(Number(item.salePrice) || 0);
      if (unitPrice <= 0) return;
      setCart((prev) => {
        const key = `extra:${item.id}:${unitPrice}`;
        const existing = prev.find((l) => l.key === key);
        if (existing) {
          return prev.map((l) =>
            l.key === key ? { ...l, qty: l.qty + 1 } : l,
          );
        }
        return [
          ...prev,
          {
            key,
            kind: "extra",
            productId: item.id,
            name: item.name,
            unitPrice,
            qty: 1,
          },
        ];
      });
    },
    [],
  );

  const changeCartQty = useCallback((key: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((l) => (l.key === key ? { ...l, qty: l.qty + delta } : l))
        .filter((l) => l.qty > 0),
    );
  }, []);

  const commitMeal = useCallback(() => {
    if (!composerPlat) {
      setError("Choisissez un plat.");
      return;
    }
    if (
      !backdateMode &&
      composerPlat.stockLeft !== null &&
      composerPlat.stockLeft !== undefined &&
      composerPlat.stockLeft <= 0
    ) {
      setError(`Stock épuisé : ${composerPlat.name}`);
      return;
    }
    if (
      !backdateMode &&
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
  }, [
    composerPlat,
    composerQty,
    composerAccOptions,
    composerAccQtys,
    addToCart,
    accPriceFor,
    resetComposer,
    backdateMode,
  ]);

  const siteLabel = site === "zogbo" ? "Zogbo" : "Gbégamey";
  const recentCount = board?.recent.length ?? 0;
  const cartTotal = cart.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  const reductionN = Math.max(
    0,
    Math.min(cartTotal, Math.round(Number(reduction) || 0)),
  );
  const cartNet = cartTotal - reductionN;

  const validateCart = useCallback(async () => {
    if (!cart.length) {
      setError("Panier vide");
      return;
    }
    if (!canSell) {
      setError(
        backdateMode
          ? "Correction de jour passé impossible pour le moment."
          : "Ouvrez une caisse avant de valider.",
      );
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
      // s'affiche à l'écran, l'impression n'est qu'un geste de plus. La réponse
      // porte déjà le board ET le ticket : la page n'est plus re-téléchargée
      // (avant : 3 fetchs et un gel complet après chaque encaissement).
      if (body.ticket) {
        const ticket = body.ticket as PosTicket;
        setFacture(ticket);
        setTickets((prev) => [
          ticket,
          ...prev.filter((t) => t.id !== ticket.id),
        ]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Validation impossible");
    } finally {
      setPosBusy(false);
    }
  }, [cart, canSell, backdateMode, date, site, saleType, paymentId, clientNom, reductionN]);

  const cancelTicket = useCallback(
    async (ticket: PosTicket) => {
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
        // Le board annule l'historique ; le ticket passe à « annulé » en
        // local, sans re-télécharger la page.
        setTickets((prev) =>
          prev.map((t) =>
            t.id === ticket.id ? { ...t, statut: "annule" } : t,
          ),
        );
        setFlash(`Ticket ${ticket.numero} annulé`);
        window.setTimeout(() => setFlash(null), 1600);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Annulation impossible");
      } finally {
        setBusyKey(null);
      }
    },
    [date, site],
  );

  const deleteTicketPermanent = useCallback(
    async (ticket: PosTicket) => {
      if (
        !window.confirm(
          `Supprimer définitivement le ticket ${ticket.numero} (${formatFcfa(ticket.montant)}) ?\nCette action est irréversible.`,
        )
      ) {
        return;
      }
      const reason = window.prompt(
        "Motif d'audit (obligatoire, 8 caractères minimum) :",
      );
      if (!reason || reason.trim().length < 8) {
        setError("Motif d'audit requis pour une suppression définitive.");
        return;
      }
      setBusyKey(`del:${ticket.id}`);
      setError(null);
      try {
        const res = await fetch("/api/pos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "delete",
            id: ticket.id,
            date,
            site,
            reason: reason.trim(),
          }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Suppression impossible");
        if (body.board) setBoard(body.board as Board);
        setTickets((prev) => prev.filter((t) => t.id !== ticket.id));
        setFlash(`Ticket ${ticket.numero} supprimé définitivement`);
        window.setTimeout(() => setFlash(null), 1600);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Suppression impossible");
      } finally {
        setBusyKey(null);
      }
    },
    [date, site],
  );

  const deleteVenteLine = useCallback(
    async (entry: VenteLogEntry) => {
      if (
        !window.confirm(
          `Supprimer définitivement « ${entry.name} × ${entry.qty} » ?\nCette action est irréversible.`,
        )
      ) {
        return;
      }
      const reason = window.prompt(
        "Motif d'audit (obligatoire, 8 caractères minimum) :",
      );
      if (!reason || reason.trim().length < 8) {
        setError("Motif d'audit requis pour une suppression définitive.");
        return;
      }
      setBusyKey(`del:${entry.id}`);
      setError(null);
      try {
        const res = await fetch("/api/vente", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "delete",
            id: entry.id,
            date,
            site,
            reason: reason.trim(),
          }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Suppression impossible");
        if (body.board) setBoard(body.board as Board);
        setFlash(`« ${entry.name} » supprimé définitivement`);
        window.setTimeout(() => setFlash(null), 1200);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Suppression impossible");
      } finally {
        setBusyKey(null);
      }
    },
    [date, site],
  );

  const undo = useCallback(
    async (entry: VenteLogEntry) => {
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
    },
    [date, site],
  );

  const openFacture = useCallback((ticket: PosTicket) => {
    setFacture(ticket);
  }, []);

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
        <ContextBar
          date={date}
          onDateChange={(v) => {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
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
                if (prev) {
                  setFlash(null);
                  setDate(prev);
                }
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
                if (next && next <= todayIsoDate()) {
                  setFlash(null);
                  setDate(next);
                }
              }}
            >
              →
            </button>
          </div>
          <ExportExcelButton
            onExport={() => exportVenteExcel(date, site)}
            disabled={loading}
          />
          {canViewHistory ? (
            <Link href="/journal-ventes" className="btn btn-ghost">
              Journal
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
              {ruptureCount} produit{ruptureCount > 1 ? "s" : ""} non vendable
              {ruptureCount > 1 ? "s" : ""}
            </strong>
            <span>
              {site === "gbegamey"
                ? "— souvent : pas encore reçu de Zogbo, ou stock épuisé. Voyez le motif sous chaque article."
                : "— souvent : pas encore préparé, ou stock épuisé. Voyez le motif sous chaque article."}
            </span>
          </div>
        ) : null}

        <div className={`vente-hero${canSell ? " is-ready" : " is-idle"}`}>
          <div className="vente-hero-main">
            <span className="vente-hero-status">
              <span className="vente-hero-dot" aria-hidden />
              {caisse
                ? `Caisse ${siteLabel} ouverte`
                : backdateMode
                  ? `Correction · ${date}`
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
                    : backdateMode
                      ? "Correction de jour passé — validez sans rouvrir la caisse"
                      : caisseActive
                        ? `Caisse déjà ouverte le ${caisseActive.date} par ${caisseActive.userName}`
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
            {loading ? null : caisse ? (
              <Link
                href={`/caisse?caisse=${site}`}
                className="btn btn-ghost vente-hero-cta"
              >
                Voir la caisse
              </Link>
            ) : backdateMode ? (
              caisseActive && caisseActive.date !== date ? (
                <button
                  type="button"
                  className="btn btn-primary vente-hero-cta"
                  onClick={() => void rejoindreCaisseActive()}
                >
                  Rejoindre la caisse du {caisseActive.date.slice(8)}/
                  {caisseActive.date.slice(5, 7)}
                </button>
              ) : null
            ) : caisseActive ? (
              <button
                type="button"
                className="btn btn-primary vente-hero-cta"
                disabled={openingCaisse}
                onClick={() => void openCaisseHere()}
              >
                {openingCaisse ? "Reprise…" : "Reprendre la caisse ouverte"}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary vente-hero-cta"
                disabled={openingCaisse}
                onClick={() => void openCaisseHere()}
              >
                {openingCaisse
                  ? "Ouverture…"
                  : `Ouvrir la caisse ${siteLabel}`}
              </button>
            )}
          </div>
        </div>

        {rejets.length > 0 ? (
          <div className="error-banner" role="alert">
            <p>
              <strong>
                {rejets.length} vente{rejets.length > 1 ? "s" : ""} enregistrée
                {rejets.length > 1 ? "s" : ""} hors ligne refusée
                {rejets.length > 1 ? "s" : ""} par le serveur.
              </strong>{" "}
              {rejets[0]?.raison} — à ressaisir ou à vérifier en caisse, elle
              n&apos;est pas comptabilisée.
            </p>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                marquerRejetsTraites();
                setRejets([]);
              }}
            >
              J&apos;ai pris en charge
            </button>
          </div>
        ) : null}

        {!loading &&
        caisseActive &&
        caisseActive.date < todayIsoDate() &&
        caisse?.date === caisseActive.date ? (
          <p className="ui-info" role="status">
            Caisse du {caisseActive.date.slice(8)}/{caisseActive.date.slice(5, 7)}{" "}
            encore ouverte (ouverte par {caisseActive.userName}). Pour démarrer
            aujourd&apos;hui, fermez-la sur{" "}
            <Link href={`/caisse?caisse=${site}`}>Caisse</Link>.
          </p>
        ) : null}

        {!loading && !canSell && !backdateMode ? (
          <p className="error-banner" role="alert">
            {caisseActive
              ? `Caisse ${siteLabel} déjà ouverte par ${caisseActive.userName} (jour ${caisseActive.date}). `
              : `Caisse ${siteLabel} fermée — ouvrez-la pour encaisser. `}
            <button
              type="button"
              className="btn-link"
              disabled={openingCaisse}
              onClick={() =>
                caisseActive
                  ? void rejoindreCaisseActive()
                  : void openCaisseHere()
              }
            >
              {openingCaisse
                ? "…"
                : caisseActive
                  ? "Afficher ce jour"
                  : "Ouvrir maintenant"}
            </button>
            {" · "}
            <Link href={`/caisse?caisse=${site}`}>Fond de caisse détaillé</Link>
          </p>
        ) : null}

        {!loading && backdateMode ? (
          <p className="ui-info" role="status">
            Mode correction du {date.slice(8)}/{date.slice(5, 7)} — la caisse du
            jour n&apos;est pas requise et le stock n&apos;est pas bloquant
            (régularisation).
            {caisseActive ? (
              <>
                {" "}
                Une caisse est ouverte le {caisseActive.date.slice(8)}/
                {caisseActive.date.slice(5, 7)} par {caisseActive.userName}.{" "}
                <button
                  type="button"
                  className="btn-link"
                  onClick={() => void rejoindreCaisseActive()}
                >
                  Y revenir
                </button>
              </>
            ) : null}
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
                  <h2>Vente hors catalogue</h2>
                  <p>Article libre + montant — pour produits absents du catalogue</p>
                </header>
                <label className="vente-extra-field">
                  <span>Produit / article</span>
                  <textarea
                    rows={3}
                    value={extraDesc}
                    onChange={(e) => setExtraDesc(e.target.value)}
                    placeholder="Ex. brochette, article vendu hors catalogue…"
                  />
                </label>
                <label className="vente-extra-field">
                  <span>Montant (FCFA)</span>
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
                  disabled={!extraDesc.trim() || !canSell}
                  onClick={() => void submitExtra()}
                >
                  Ajouter au panier
                </button>
              </div>
            ) : cat === "plat" ? (
              <MealComposer
                plats={plats}
                canSell={canSell}
                ignoreStock={backdateMode}
                busyKey={busyKey}
                composerPlatId={composerPlatId}
                composerPlat={composerPlat}
                composerQty={composerQty}
                composerAccOptions={composerAccOptions}
                composerAccQtys={composerAccQtys}
                composerTotal={composerTotal}
                onSelectPlat={setComposerPlatId}
                onQtyChange={changeComposerQty}
                onAccQtyChange={changeComposerAccQty}
                onCommit={commitMeal}
                accPriceFor={accPriceFor}
              />
            ) : (
              <>
                {cat === "accompagnement" && accompagnements.length > 0 ? (
                  <p className="ui-info vente-acc-banner">
                    Vente à l&apos;unité — chaque + ajoute une portion au
                    panier.
                  </p>
                ) : null}

                <ProductGrid
                  products={products}
                  canSell={canSell}
                  ignoreStock={backdateMode}
                  onAdd={addToCart}
                />
              </>
            )}
          </div>

          <aside
            className={`pos-cart vente-panel${cart.length === 0 ? " is-empty" : ""}`}
          >
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
                <CartLines cart={cart} onChangeQty={changeCartQty} />
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

                {emballages.length > 0 ? (
                  <div
                    className={`vente-emballages${
                      saleType === "Rapido" ? " is-rapido" : ""
                    }`}
                  >
                    <span className="vente-field">
                      <span>
                        Emballages
                        {saleType === "Rapido" ? " · emporté" : ""}
                      </span>
                    </span>
                    <div className="vente-emballage-chips">
                      {emballages.map((e) => (
                        <button
                          key={e.id}
                          type="button"
                          className="btn btn-ghost vente-emballage-chip"
                          disabled={!canSell}
                          title={`Ajouter ${e.name}`}
                          onClick={() => addEmballage(e)}
                        >
                          + {e.name}
                          <span className="mono">
                            {" "}
                            {formatFcfa(e.salePrice ?? 0)}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

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
                  <span>Réduction commerciale (FCFA)</span>
                  <input
                    type="number"
                    min={0}
                    max={cartTotal}
                    value={reduction}
                    onChange={(e) => setReduction(e.target.value)}
                  />
                </label>
              </div>

              <div className="pos-cart-foot">
                {reductionN > 0 ? (
                  <div className="pos-total pos-total-sub">
                    <span>Sous-total</span>
                    <strong className="mono">{formatFcfa(cartTotal)}</strong>
                  </div>
                ) : null}
                {reductionN > 0 ? (
                  <div className="pos-total pos-total-sub">
                    <span>Réduction</span>
                    <strong className="mono">−{formatFcfa(reductionN)}</strong>
                  </div>
                ) : null}
                <div className="pos-total">
                  <span>Total</span>
                  <strong className="mono">{formatFcfa(cartNet)}</strong>
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={posBusy || !cart.length || !canSell}
                  onClick={() => void validateCart()}
                >
                  {posBusy ? "Validation…" : "Créer la commande"}
                </button>
              </div>

              {tickets.length > 0 ? (
                <TicketsList
                  tickets={tickets}
                  busyKey={busyKey}
                  canViewHistory={canViewHistory}
                  canPurge={canPurge}
                  onFacture={openFacture}
                  onCancel={cancelTicket}
                  onDeletePermanent={deleteTicketPermanent}
                />
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
                <span className="reg-actions">
                  <button
                    type="button"
                    className="btn-link"
                    disabled={!!busyKey}
                    onClick={() => void undo(entry)}
                  >
                    Annuler
                  </button>
                  {canPurge ? (
                    <button
                      type="button"
                      className="btn-link btn-link-danger"
                      disabled={!!busyKey}
                      onClick={() => void deleteVenteLine(entry)}
                    >
                      Suppr. déf.
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Aucune vente.</p>
        )}
        {canViewHistory ? (
            <Link href="/journal-ventes" className="vente-hist-link">
              Voir le journal des ventes
            </Link>
          ) : null}
      </RegistreDrawer>
    </AppShell>
  );
}
