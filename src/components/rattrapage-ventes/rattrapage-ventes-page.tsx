"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { BrandLoader } from "@/components/brand-loader";
import { formatFcfa } from "@/lib/format";
import type {
  PosPaymentMethod,
  PosTicket,
  SaleType,
  VenteKind,
  VenteProduct,
  VenteSite,
} from "@/lib/types";
import { previousIsoDate, todayIsoDate } from "@/lib/zogbo-calc";
import "./rattrapage-ventes-page.css";

type Ligne = {
  kind: VenteKind;
  productId: string;
  name: string;
  qty: number;
  unitPrice: number;
};

type Categorie = "plat" | "local" | "boisson";

const CATEGORIES: { key: Categorie; label: string }[] = [
  { key: "plat", label: "Plats" },
  { key: "local", label: "Accompagnements" },
  { key: "boisson", label: "Boissons" },
];

const SITES: { key: VenteSite; label: string }[] = [
  { key: "zogbo", label: "Zogbo" },
  { key: "gbegamey", label: "Gbégamey" },
];

const SALE_TYPES: SaleType[] = ["Sur place", "Rapido"];

function formatDateFr(iso: string) {
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
}

/** Saisie, par l'administrateur, des ventes d'un jour passé pour Zogbo et Gbégamey. */
export function RattrapageVentesPage() {
  const hier = previousIsoDate(todayIsoDate()) ?? todayIsoDate();
  const [site, setSite] = useState<VenteSite>("gbegamey");
  const [date, setDate] = useState(hier);
  const [produits, setProduits] = useState<VenteProduct[]>([]);
  const [paiements, setPaiements] = useState<PosPaymentMethod[]>([]);
  const [tickets, setTickets] = useState<PosTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Ticket en cours de modification : il est remplacé à l'enregistrement. */
  const [aRemplacer, setARemplacer] = useState<PosTicket | null>(null);

  const [cat, setCat] = useState<Categorie>("plat");
  const [recherche, setRecherche] = useState("");
  const [lignes, setLignes] = useState<Ligne[]>([]);
  const [saleType, setSaleType] = useState<SaleType>("Sur place");
  const [paymentId, setPaymentId] = useState("");
  const [clientNom, setClientNom] = useState("");
  const [reduction, setReduction] = useState("0");

  const dateValide = /^\d{4}-\d{2}-\d{2}$/.test(date) && date < todayIsoDate();

  const charger = useCallback(async () => {
    if (!dateValide) return;
    setLoading(true);
    setError(null);
    try {
      const qs = `date=${encodeURIComponent(date)}&site=${site}`;
      const [venteRes, posRes] = await Promise.all([
        fetch(`/api/vente?${qs}`, { cache: "no-store" }),
        fetch(`/api/pos?${qs}`, { cache: "no-store" }),
      ]);
      const vente = await venteRes.json();
      if (!venteRes.ok) throw new Error(vente.error || "Catalogue indisponible.");
      setProduits((vente.products as VenteProduct[]) ?? []);
      const pos = await posRes.json();
      if (!posRes.ok) throw new Error(pos.error || "Tickets indisponibles.");
      const moyens = (pos.config?.paymentMethods as PosPaymentMethod[]) ?? [];
      setPaiements(moyens);
      setPaymentId((cur) => cur || moyens[0]?.id || "");
      setTickets((pos.tickets as PosTicket[]) ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, [date, site, dateValide]);

  useEffect(() => {
    void charger();
  }, [charger]);

  // Changer de site ou de jour recompose le ticket : les prix peuvent différer.
  function choisirSite(s: VenteSite) {
    setSite(s);
    setLignes([]);
  }
  function choisirDate(d: string) {
    setDate(d);
    setLignes([]);
  }

  const catalogue = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return produits.filter(
      (p) =>
        p.kind === cat && (!q || p.name.toLowerCase().includes(q)),
    );
  }, [produits, cat, recherche]);

  const compteParCat = useMemo(() => {
    const r: Record<Categorie, number> = { plat: 0, local: 0, boisson: 0 };
    for (const p of produits) {
      if (p.kind === "plat" || p.kind === "local" || p.kind === "boisson") {
        r[p.kind] += 1;
      }
    }
    return r;
  }, [produits]);

  function ajouter(p: VenteProduct) {
    setLignes((prev) => {
      const i = prev.findIndex((l) => l.productId === p.productId && l.kind === p.kind);
      if (i >= 0) {
        return prev.map((l, k) => (k === i ? { ...l, qty: l.qty + 1 } : l));
      }
      return [
        ...prev,
        {
          kind: p.kind,
          productId: String(p.productId),
          name: p.name,
          qty: 1,
          unitPrice: p.unitPrice,
        },
      ];
    });
  }

  function changerQte(i: number, delta: number) {
    setLignes((prev) =>
      prev
        .map((l, k) => (k === i ? { ...l, qty: l.qty + delta } : l))
        .filter((l) => l.qty > 0),
    );
  }

  function changerPrix(i: number, valeur: string) {
    const prix = Math.max(0, Math.round(Number(valeur) || 0));
    setLignes((prev) => prev.map((l, k) => (k === i ? { ...l, unitPrice: prix } : l)));
  }

  const total = lignes.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  const reductionN = Math.min(total, Math.max(0, Math.round(Number(reduction) || 0)));
  const net = total - reductionN;

  function demanderMotif(action: string): string | null {
    const motif = window.prompt(
      `Motif de ${action} (obligatoire, 8 caractères minimum) :`,
    );
    if (motif === null) return null;
    if (motif.trim().length < 8) {
      setError("Motif d'audit requis (au moins 8 caractères).");
      return null;
    }
    return motif.trim();
  }

  async function supprimerTicket(t: PosTicket, motifDonne?: string) {
    const motif = motifDonne ?? demanderMotif("suppression");
    if (!motif) return false;
    if (
      motifDonne === undefined &&
      !window.confirm(
        `Supprimer définitivement le ticket ${t.numero} (${formatFcfa(t.montant)}) ?\nCette action est irréversible.`,
      )
    ) {
      return false;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/pos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete",
          id: t.id,
          date: t.date,
          site: t.site,
          reason: motif,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Suppression impossible.");
      setTickets((prev) => prev.filter((x) => x.id !== t.id));
      if (motifDonne === undefined) {
        setFlash(`Ticket ${t.numero} supprimé définitivement.`);
      }
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Suppression impossible.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function modifierTicket(t: PosTicket) {
    setARemplacer(t);
    setLignes(
      t.lines.map((l) => ({
        kind: l.kind,
        productId: String(l.productId),
        name: l.name,
        qty: l.qty,
        unitPrice: l.unitPrice,
      })),
    );
    setSaleType(t.saleType);
    setPaymentId(t.paymentMethodId ?? "");
    setClientNom(t.clientNom ?? "");
    setReduction(String(t.reduction ?? 0));
    setFlash(null);
    setError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function abandonnerModification() {
    setARemplacer(null);
    setLignes([]);
    setClientNom("");
    setReduction("0");
  }

  async function enregistrer() {
    if (busy || !lignes.length || !dateValide) return;
    let motifRemplacement: string | undefined;
    if (aRemplacer) {
      const m = demanderMotif("modification");
      if (!m) return;
      motifRemplacement = m;
    }
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      const res = await fetch("/api/pos", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Vente-Locale": `passe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        },
        body: JSON.stringify({
          action: "validate",
          date,
          site,
          saleType,
          paymentMethodId: paymentId || undefined,
          clientNom: clientNom || undefined,
          reduction: reductionN,
          lines: lignes.map((l) => ({
            kind: l.kind,
            productId: l.productId,
            name: l.name,
            qty: l.qty,
            unitPrice: l.unitPrice,
          })),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Enregistrement impossible.");
      const t = body.ticket as PosTicket;
      setTickets((prev) => [t, ...prev.filter((x) => x.id !== t.id)]);
      let message = `Ticket ${t.numero} enregistré le ${formatDateFr(date)} · ${formatFcfa(t.montant)}`;
      if (aRemplacer && motifRemplacement) {
        // Le nouveau ticket existe : on retire l'ancien, motif d'audit à l'appui.
        setBusy(false);
        const retire = await supprimerTicket(
          aRemplacer,
          `Remplacé par ${t.numero} : ${motifRemplacement}`,
        );
        message = retire
          ? `Ticket ${aRemplacer.numero} remplacé par ${t.numero} · ${formatFcfa(t.montant)}`
          : `Ticket ${t.numero} créé, mais l'ancien ${aRemplacer.numero} n'a pas pu être supprimé : supprimez-le depuis la liste.`;
        setARemplacer(null);
      }
      setFlash(message);
      setLignes([]);
      setClientNom("");
      setReduction("0");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }

  const caJour = tickets
    .filter((t) => t.statut === "valide")
    .reduce((s, t) => s + t.montant, 0);

  return (
    <AppShell
      title="Ventes passées"
      subtitle="Enregistrez les ventes d'un jour passé pour Zogbo et Gbégamey — administrateur uniquement."
      mainClassName="main-rattrapage"
    >
      <div className="rv-page">
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

        <section className="rv-card" aria-label="Site et jour">
          <h3 className="rv-card-title">Où et quand</h3>
          <div className="rv-where">
            <div className="rv-seg" role="tablist" aria-label="Site">
              {SITES.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  role="tab"
                  aria-selected={site === s.key}
                  className={`rv-seg-btn${site === s.key ? " is-active" : ""}`}
                  disabled={aRemplacer !== null}
                  onClick={() => choisirSite(s.key)}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <label className="rv-field">
              <span>Jour des ventes</span>
              <input
                type="date"
                value={date}
                max={hier}
                disabled={aRemplacer !== null}
                onChange={(e) => choisirDate(e.target.value)}
              />
            </label>
            <div className="rv-day-kpi">
              <span>Déjà enregistré ce jour</span>
              <strong>
                {tickets.filter((t) => t.statut === "valide").length} ticket
                {tickets.filter((t) => t.statut === "valide").length > 1 ? "s" : ""}
                {" · "}
                {formatFcfa(caJour)}
              </strong>
            </div>
          </div>
          {!dateValide ? (
            <p className="rv-hint">
              Choisissez un jour passé (avant aujourd&apos;hui). Pour aujourd&apos;hui,
              utilisez la page Vente.
            </p>
          ) : null}
        </section>

        <div className="rv-workspace">
          <section className="rv-card" aria-label="Catalogue">
            <h3 className="rv-card-title">Articles vendus</h3>
            <div className="rv-cats" role="tablist" aria-label="Catégories">
              {CATEGORIES.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  role="tab"
                  aria-selected={cat === c.key}
                  className={`rv-cat${cat === c.key ? " is-active" : ""}`}
                  onClick={() => setCat(c.key)}
                >
                  {c.label}
                  <i>{compteParCat[c.key]}</i>
                </button>
              ))}
            </div>
            <label className="rv-field">
              <span className="sr-only">Rechercher un article</span>
              <input
                type="search"
                placeholder="Rechercher un article…"
                value={recherche}
                onChange={(e) => setRecherche(e.target.value)}
              />
            </label>
            {loading ? (
              <BrandLoader variant="ligne" label="Chargement du catalogue…" />
            ) : catalogue.length === 0 ? (
              <p className="rv-hint">Aucun article dans cette catégorie.</p>
            ) : (
              <ul className="rv-products">
                {catalogue.map((p) => (
                  <li key={`${p.kind}-${p.productId}`}>
                    <button
                      type="button"
                      className="rv-product"
                      disabled={!dateValide}
                      onClick={() => ajouter(p)}
                    >
                      <span className="rv-product-name">{p.name}</span>
                      <span className="rv-product-price mono">
                        {formatFcfa(p.unitPrice)}
                      </span>
                      <span className="rv-product-add" aria-hidden>
                        +
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <aside className="rv-card rv-ticket" aria-label="Ticket">
            <h3 className="rv-card-title">
              {aRemplacer
                ? `Modification du ticket ${aRemplacer.numero}`
                : `Ticket du ${formatDateFr(date)} · ${site === "zogbo" ? "Zogbo" : "Gbégamey"}`}
            </h3>
            {aRemplacer ? (
              <p className="rv-edit-note">
                Le ticket sera remplacé par la nouvelle version à
                l&apos;enregistrement.{" "}
                <button
                  type="button"
                  className="rv-link-btn"
                  onClick={abandonnerModification}
                >
                  Abandonner
                </button>
              </p>
            ) : null}
            {lignes.length === 0 ? (
              <p className="rv-hint">
                Touchez un article pour l&apos;ajouter. Un ticket peut mélanger plats,
                accompagnements et boissons.
              </p>
            ) : (
              <ul className="rv-lines">
                {lignes.map((l, i) => (
                  <li key={`${l.kind}-${l.productId}`}>
                    <div className="rv-line-head">
                      <strong>{l.name}</strong>
                      <span className="mono">{formatFcfa(l.qty * l.unitPrice)}</span>
                    </div>
                    <div className="rv-line-ctrl">
                      <div className="rv-stepper">
                        <button
                          type="button"
                          aria-label={`Retirer un ${l.name}`}
                          onClick={() => changerQte(i, -1)}
                        >
                          −
                        </button>
                        <span className="mono">{l.qty}</span>
                        <button
                          type="button"
                          aria-label={`Ajouter un ${l.name}`}
                          onClick={() => changerQte(i, 1)}
                        >
                          +
                        </button>
                      </div>
                      <label className="rv-price">
                        <span className="sr-only">Prix unitaire de {l.name}</span>
                        <input
                          type="number"
                          min={0}
                          value={l.unitPrice}
                          onChange={(e) => changerPrix(i, e.target.value)}
                        />
                        <em>FCFA</em>
                      </label>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div className="rv-info">
              <label className="rv-field">
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
              <label className="rv-field">
                <span>Paiement</span>
                <select
                  value={paymentId}
                  onChange={(e) => setPaymentId(e.target.value)}
                >
                  {paiements.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.libelle}
                    </option>
                  ))}
                </select>
              </label>
              <label className="rv-field">
                <span>Client</span>
                <input
                  value={clientNom}
                  onChange={(e) => setClientNom(e.target.value)}
                  placeholder="Nom client (facultatif)"
                />
              </label>
              <label className="rv-field">
                <span>Réduction (FCFA)</span>
                <input
                  type="number"
                  min={0}
                  max={total}
                  value={reduction}
                  onChange={(e) => setReduction(e.target.value)}
                />
              </label>
            </div>

            <div className="rv-total">
              {reductionN > 0 ? (
                <div className="rv-total-sub">
                  <span>Sous-total</span>
                  <strong className="mono">{formatFcfa(total)}</strong>
                </div>
              ) : null}
              <div className="rv-total-main">
                <span>Total</span>
                <strong className="mono">{formatFcfa(net)}</strong>
              </div>
            </div>
            <button
              type="button"
              className="rv-submit"
              disabled={busy || !lignes.length || !dateValide}
              onClick={() => void enregistrer()}
            >
              {busy
                ? "Enregistrement…"
                : aRemplacer
                  ? "Enregistrer la modification"
                  : `Enregistrer le ticket du ${formatDateFr(date)}`}
            </button>
          </aside>
        </div>

        <section className="rv-card" aria-label="Tickets du jour">
          <header className="rv-card-head">
            <h3 className="rv-card-title">
              Tickets du {formatDateFr(date)} · {site === "zogbo" ? "Zogbo" : "Gbégamey"}
            </h3>
            <Link
              href={`/journal-ventes?from=${date}&to=${date}&site=${site}`}
              className="rv-link"
            >
              Ouvrir dans le journal →
            </Link>
          </header>
          {tickets.length === 0 ? (
            <p className="rv-hint">Aucun ticket enregistré ce jour.</p>
          ) : (
            <div className="table-scroll">
              <table className="data-table rv-table">
                <thead>
                  <tr>
                    <th>N° ticket</th>
                    <th>Articles</th>
                    <th className="num">Montant</th>
                    <th>Statut</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.map((t) => (
                    <tr key={t.id}>
                      <td className="mono">{t.numero}</td>
                      <td>
                        {t.lines
                          .map((l) => (l.qty > 1 ? `${l.name} ×${l.qty}` : l.name))
                          .join(" · ")}
                      </td>
                      <td className="num mono">{formatFcfa(t.montant)}</td>
                      <td>
                        <span className={`hist-statut hist-statut-${t.statut}`}>
                          {t.statut === "valide" ? "Validé" : "Annulé"}
                        </span>
                      </td>
                      <td className="rv-actions">
                        {t.statut === "valide" ? (
                          <button
                            type="button"
                            className="rv-mini"
                            disabled={busy}
                            onClick={() => modifierTicket(t)}
                          >
                            Modifier
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="rv-mini rv-mini-danger"
                          disabled={busy}
                          onClick={() => void supprimerTicket(t)}
                        >
                          Supprimer
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
