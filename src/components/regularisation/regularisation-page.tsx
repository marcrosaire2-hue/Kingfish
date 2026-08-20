"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { BrandLoader } from "@/components/brand-loader";
import { formatFcfa } from "@/lib/format";
import type {
  PosTicket,
  SaleType,
  VenteProduct,
  VenteSite,
} from "@/lib/types";
import { todayIsoDate } from "@/lib/zogbo-calc";

type Board = {
  date: string;
  site: VenteSite;
  products: VenteProduct[];
  caToday: number;
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
  const [date, setDate] = useState(() => todayIsoDate());
  const [site, setSite] = useState<VenteSite>("zogbo");
  const [allowedSites, setAllowedSites] = useState<VenteSite[]>([
    "zogbo",
    "gbegamey",
  ]);
  const [board, setBoard] = useState<Board | null>(null);
  const [tickets, setTickets] = useState<PosTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const [kind, setKind] = useState<"plat" | "local" | "boisson" | "extra">(
    "plat",
  );
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("1");
  const [extraName, setExtraName] = useState("");
  const [extraPrice, setExtraPrice] = useState("");
  const [saleType, setSaleType] = useState<SaleType>("Sur place");

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
      const [venteRes, posRes] = await Promise.all([
        fetch(
          `/api/vente?date=${encodeURIComponent(date)}&site=${site}&limit=80`,
          { cache: "no-store" },
        ),
        fetch(`/api/pos?date=${encodeURIComponent(date)}&site=${site}`, {
          cache: "no-store",
        }),
      ]);
      const venteBody = await venteRes.json();
      if (!venteRes.ok) throw new Error(venteBody.error || "Erreur vente");
      setBoard(venteBody as Board);
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement");
      setBoard(null);
      setTickets([]);
    } finally {
      setLoading(false);
    }
  }, [date, site]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (kind === "extra") {
      setProductId("");
      return;
    }
    if (!products.some((p) => p.productId === productId)) {
      setProductId(products[0]?.productId ?? "");
    }
  }, [kind, products, productId]);

  async function enregistrer() {
    const q = Math.round(Number(qty) || 0);
    if (q < 1) {
      setError("Quantité invalide");
      return;
    }
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      let lines;
      if (kind === "extra") {
        const name = extraName.trim();
        const unitPrice = Math.round(Number(extraPrice) || 0);
        if (name.length < 2) throw new Error("Décrivez la vente extra.");
        if (unitPrice <= 0) throw new Error("Prix extra invalide.");
        lines = [
          {
            kind: "extra" as const,
            productId: `extra-${Date.now()}`,
            name,
            qty: q,
            unitPrice,
          },
        ];
      } else {
        if (!selected) throw new Error("Choisissez un produit.");
        lines = [
          {
            kind: selected.kind,
            productId: selected.productId,
            name: selected.name,
            qty: q,
            unitPrice: selected.unitPrice,
          },
        ];
      }

      const res = await fetch("/api/pos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "validate",
          date,
          site,
          saleType,
          lines,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Enregistrement impossible");
      setFlash(`Vente enregistrée · ticket ${body.ticket?.numero ?? ""}`);
      setQty("1");
      setExtraName("");
      setExtraPrice("");
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
      setError("Cette ligne n’a pas de journal lié.");
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
  const isPast = date < todayIsoDate();

  return (
    <AppShell
      title="Régularisation"
      subtitle="Saisir, modifier ou annuler des ventes d’un jour passé — réservé au gérant."
      actions={
        <>
          <Link href="/historique-ventes" className="btn btn-ghost">
            Historique
          </Link>
          <Link href="/vente" className="btn btn-ghost">
            ← Vente
          </Link>
        </>
      }
    >
      <div className="filters-row">
        <label className="date-field">
          <span>Jour</span>
          <input
            type="date"
            value={date}
            max={todayIsoDate()}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className="date-field">
          <span>Site</span>
          <select
            className="select-input"
            value={site}
            onChange={(e) => setSite(e.target.value as VenteSite)}
            disabled={allowedSites.length <= 1}
          >
            {allowedSites.map((s) => (
              <option key={s} value={s}>
                {s === "zogbo" ? "Zogbo" : "Gbégamey"}
              </option>
            ))}
          </select>
        </label>
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
        <p className="ui-info" role="status">
          Mode correction du <strong>{date}</strong> · {siteLabel}. Les écritures
          touchent le stock et le journal de ce jour.
        </p>
      ) : (
        <p className="ui-info" role="note">
          Choisissez une date <strong>passée</strong> pour corriger. Pour le
          service du jour, utilisez la page Vente.
        </p>
      )}

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
        <BrandLoader variant="ligne" label="Chargement…" />
      ) : (
        <div className="admin-grid">
          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">Enregistrer une vente</h2>
              <p className="muted">
                CA du jour : {formatFcfa(board?.caToday ?? 0)}
              </p>
            </div>
            <div className="admin-form">
              <label className="date-field">
                <span>Type</span>
                <select
                  className="select-input"
                  value={kind}
                  onChange={(e) =>
                    setKind(e.target.value as typeof kind)
                  }
                >
                  <option value="plat">Plat</option>
                  <option value="local">Accompagnement</option>
                  <option value="boisson">Boisson</option>
                  <option value="extra">Extra</option>
                </select>
              </label>

              {kind === "extra" ? (
                <>
                  <label className="date-field">
                    <span>Description</span>
                    <input
                      value={extraName}
                      onChange={(e) => setExtraName(e.target.value)}
                      placeholder="Ex. livraison, service…"
                    />
                  </label>
                  <label className="date-field">
                    <span>Prix unitaire (FCFA)</span>
                    <input
                      type="number"
                      min={0}
                      value={extraPrice}
                      onChange={(e) => setExtraPrice(e.target.value)}
                    />
                  </label>
                </>
              ) : (
                <label className="date-field">
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
              )}

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
                <span>Type de vente</span>
                <select
                  className="select-input"
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

              {selected && kind !== "extra" ? (
                <p className="muted">
                  Prix catalogue : {formatFcfa(selected.unitPrice)}
                  {selected.stockLeft != null
                    ? ` · stock affiché ${selected.stockLeft}`
                    : ""}
                </p>
              ) : null}

              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !isPast}
                onClick={() => void enregistrer()}
              >
                {busy ? "Enregistrement…" : "Enregistrer sur ce jour"}
              </button>
            </div>
          </section>

          <section className="panel panel-wide">
            <div className="panel-head">
              <h2 className="panel-title">
                Tickets du {date} · {siteLabel}
              </h2>
              <p className="muted">
                {tickets.length} ticket{tickets.length > 1 ? "s" : ""}
              </p>
            </div>

            {tickets.length === 0 ? (
              <p className="muted">Aucun ticket POS pour ce jour.</p>
            ) : (
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
                              {t.statut === "valide" && l.venteLogId ? (
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
                        {t.statut === "valide" ? (
                          <button
                            type="button"
                            className="btn-link"
                            disabled={busy}
                            onClick={() => void annulerTicket(t)}
                          >
                            Annuler
                          </button>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      )}
    </AppShell>
  );
}
