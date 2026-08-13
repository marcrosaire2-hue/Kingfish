"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ContextBar } from "@/components/context-bar";
import { ExportExcelButton } from "@/components/export-excel-button";
import { formatFcfa } from "@/lib/format";
import { computeMatieresDay } from "@/lib/matieres-calc";
import { exportPertesExcel } from "@/lib/page-exports";
import { PERTE_MOTIF_LABELS } from "@/lib/types";
import type {
  MatieresDay,
  PerteEntry,
  PerteKind,
  PerteMotif,
  RawMaterial,
  VenteProduct,
  VenteSite,
} from "@/lib/types";
import { todayIsoDate } from "@/lib/zogbo-calc";
import { BrandLoader } from "@/components/brand-loader";

type Famille = { key: PerteKind; label: string };

const FAMILLES: Famille[] = [
  { key: "plat", label: "Plats" },
  { key: "local", label: "Sur place" },
  { key: "boisson", label: "Boissons" },
  { key: "matiere", label: "Matières" },
];

const MOTIFS = Object.entries(PERTE_MOTIF_LABELS) as [PerteMotif, string][];

type Candidat = { productId: string; name: string; stock: number | null };

export function PertesPage() {
  const [date, setDate] = useState(() => todayIsoDate());
  const [site, setSite] = useState<VenteSite>("gbegamey");
  /** Périmètre du compte (« tous » = les deux sites ; sinon sa zone unique). */
  const [userSite, setUserSite] = useState<VenteSite | "tous" | null>(null);
  const [famille, setFamille] = useState<PerteKind>("plat");

  const [produits, setProduits] = useState<VenteProduct[]>([]);
  const [matieres, setMatieres] = useState<Candidat[]>([]);
  const [pertes, setPertes] = useState<PerteEntry[]>([]);

  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("");
  const [motif, setMotif] = useState<PerteMotif>("gate");
  const [commentaire, setCommentaire] = useState("");

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const chargerJournal = useCallback(async (jour: string) => {
    const res = await fetch(`/api/pertes?date=${encodeURIComponent(jour)}`, {
      cache: "no-store",
    });
    if (!res.ok) return;
    const body = (await res.json()) as {
      pertes: PerteEntry[];
      site?: VenteSite | "tous";
    };
    setPertes(body.pertes ?? []);
    setUserSite(body.site ?? "tous");
  }, []);

  const charger = useCallback(
    async (jour: string, point: VenteSite) => {
      setLoading(true);
      setError(null);
      try {
        // Le journal renvoie le périmètre réel du compte. Compte rattaché à
        // une zone : le point est verrouillé sur cette zone, jamais sur ce
        // que l'utilisateur tenterait de choisir.
        const journalRes = await fetch(
          `/api/pertes?date=${encodeURIComponent(jour)}`,
          { cache: "no-store" },
        );
        if (journalRes.ok) {
          const journal = (await journalRes.json()) as {
            pertes: PerteEntry[];
            site?: VenteSite | "tous";
          };
          setPertes(journal.pertes ?? []);
          const scope = journal.site ?? "tous";
          setUserSite(scope);
          if (scope === "zogbo" || scope === "gbegamey") {
            setSite(scope);
          }
        }
        const effectivePoint: VenteSite =
          userSite === "zogbo" || userSite === "gbegamey"
            ? userSite
            : point;
        const [vente, mat] = await Promise.all([
          fetch(
            `/api/vente?date=${encodeURIComponent(jour)}&site=${effectivePoint}`,
            { cache: "no-store" },
          ),
          fetch(`/api/matieres?date=${encodeURIComponent(jour)}`, {
            cache: "no-store",
          }),
        ]);

        if (vente.ok) {
          const body = (await vente.json()) as { products: VenteProduct[] };
          setProduits(body.products ?? []);
        }
        if (mat.ok) {
          const body = (await mat.json()) as {
            day: MatieresDay;
            materials: RawMaterial[];
          };
          const calcule = computeMatieresDay(body.day, body.materials);
          setMatieres(
            calcule.lines.map((l) => ({
              productId: l.productId,
              name: l.name,
              stock: l.stock,
            })),
          );
        }
        await chargerJournal(jour);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erreur de chargement");
      } finally {
        setLoading(false);
      }
    },
    [chargerJournal, userSite],
  );

  useEffect(() => {
    void charger(date, site);
  }, [date, site, userSite, charger]);

  /** Produits déclarables dans la famille choisie, avec leur reste. */
  const candidats = useMemo<Candidat[]>(() => {
    if (famille === "matiere") return matieres;
    return produits
      .filter((p) => p.kind === famille)
      .map((p) => ({
        productId: p.productId,
        name: p.name,
        stock: p.stockLeft ?? null,
      }));
  }, [famille, produits, matieres]);

  const choisi = candidats.find((c) => c.productId === productId) ?? null;
  const enBouteilles = famille === "boisson";

  async function declarer(e: React.FormEvent) {
    e.preventDefault();
    const quantite = Number(String(qty).replace(",", "."));
    if (!productId || !Number.isFinite(quantite) || quantite <= 0) {
      setError("Choisissez un produit et une quantité.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/pertes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "declare",
          date,
          site,
          kind: famille,
          productId,
          qty: quantite,
          motif,
          commentaire,
        }),
      });
      const body = (await res.json()) as { entry?: PerteEntry; error?: string };
      if (!res.ok) throw new Error(body.error || "Déclaration impossible");
      setQty("");
      setCommentaire("");
      setFlash(
        `Perte enregistrée : ${body.entry?.qty} × ${body.entry?.name}`,
      );
      window.setTimeout(() => setFlash(null), 2500);
      await charger(date, site);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Déclaration impossible");
    } finally {
      setBusy(false);
    }
  }

  async function annuler(entry: PerteEntry) {
    if (
      !window.confirm(
        `Annuler cette perte ?\n\n${entry.qty} × ${entry.name}\nLe stock sera repris.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/pertes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel", id: entry.id }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error || "Annulation impossible");
      await charger(date, site);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Annulation impossible");
    } finally {
      setBusy(false);
    }
  }

  const coutDuJour = pertes
    .filter((p) => !p.cancelledAt)
    .reduce((s, p) => s + p.cost, 0);

  return (
    <AppShell
      title="Pertes"
      subtitle="Sortie de stock sans vente — produit gâté, casse, test. Le motif est obligatoire."
      actions={
        pertes.length > 0 ? (
          <ExportExcelButton
            label="Exporter Excel"
            onExport={() =>
              exportPertesExcel({ date, site: userSite ?? site, pertes })
            }
          />
        ) : undefined
      }
    >
      <ContextBar
        date={date}
        onDateChange={setDate}
        siteLabel={site === "zogbo" ? "Zogbo" : "Gbégamey"}
      >
        {userSite === "tous" ? (
          <div className="site-switch" role="tablist" aria-label="Point de vente">
            <button
              type="button"
              className={`site-btn${site === "zogbo" ? " is-active" : ""}`}
              onClick={() => setSite("zogbo")}
            >
              Zogbo
            </button>
            <button
              type="button"
              className={`site-btn${site === "gbegamey" ? " is-active" : ""}`}
              onClick={() => setSite("gbegamey")}
            >
              Gbégamey
            </button>
          </div>
        ) : null}
      </ContextBar>

      {error ? (
        <p className="error-banner" role="alert">
          {error}
        </p>
      ) : null}
      {flash ? <p className="login-hint">{flash}</p> : null}

      <div className="section-tabs" role="tablist" aria-label="Famille">
        {FAMILLES.filter((f) => !(f.key === "local" && site === "zogbo")).map(
          (f) => (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={famille === f.key}
              className={`section-tab${famille === f.key ? " is-active" : ""}`}
              onClick={() => {
                setFamille(f.key);
                setProductId("");
              }}
            >
              {f.label}
            </button>
          ),
        )}
      </div>

      <form className="panel stack-form" onSubmit={declarer}>
        <label>
          Produit
          <select
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            required
          >
            <option value="">— choisir —</option>
            {candidats.map((c) => (
              <option key={c.productId} value={c.productId}>
                {c.name}
                {c.stock !== null ? ` (reste ${c.stock})` : ""}
              </option>
            ))}
          </select>
        </label>

        <label>
          Quantité {enBouteilles ? "(en bouteilles)" : ""}
          <input
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            required
          />
        </label>
        {choisi && choisi.stock !== null ? (
          <p className="muted">
            Stock actuel : {choisi.stock}
            {enBouteilles ? " bouteille(s)" : ""}
          </p>
        ) : null}

        <label>
          Motif
          <select
            value={motif}
            onChange={(e) => setMotif(e.target.value as PerteMotif)}
          >
            {MOTIFS.map(([cle, libelle]) => (
              <option key={cle} value={cle}>
                {libelle}
              </option>
            ))}
          </select>
        </label>

        <label>
          Commentaire {motif === "autre" ? "(obligatoire)" : "(facultatif)"}
          <input
            type="text"
            maxLength={300}
            placeholder="Ce qui s'est passé"
            value={commentaire}
            onChange={(e) => setCommentaire(e.target.value)}
            required={motif === "autre"}
          />
        </label>

        <button
          type="submit"
          className="btn btn-primary"
          disabled={busy || loading || !productId || !qty}
        >
          {busy ? "Enregistrement…" : "Déclarer la perte"}
        </button>
      </form>

      <section className="panel">
        <h2 className="panel-title">
          Pertes du jour
          {coutDuJour > 0 ? (
            <span className="muted"> · {formatFcfa(coutDuJour)}</span>
          ) : null}
        </h2>
        {loading ? (
          <BrandLoader variant="ligne" label="Chargement des pertes…" />
        ) : pertes.length === 0 ? (
          <p className="muted">Aucune perte déclarée ce jour.</p>
        ) : (
          <ul className="vente-log">
            {pertes.map((p) => (
              <li key={p.id} className={p.cancelledAt ? "is-cancelled" : undefined}>
                <div>
                  <strong>
                    −{p.qty} × {p.name}
                  </strong>
                  <span className="muted"> · {PERTE_MOTIF_LABELS[p.motif]}</span>
                  {p.cost > 0 ? (
                    <span className="muted"> · {formatFcfa(p.cost)}</span>
                  ) : null}
                  <div className="vente-log-time muted">
                    {p.commentaire ? `${p.commentaire} · ` : ""}
                    {p.actorName ?? "—"}
                    {p.cancelledAt
                      ? ` · annulé par ${p.cancelledByName ?? "—"}`
                      : ""}
                  </div>
                </div>
                {!p.cancelledAt ? (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={busy}
                    onClick={() => void annuler(p)}
                  >
                    Annuler
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </AppShell>
  );
}
