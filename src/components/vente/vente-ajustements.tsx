"use client";

import { useState } from "react";
import "./vente-ajustements.css";
import type { VenteAjustements } from "@/lib/magasin-calc";
import type { FicheCaisse } from "@/lib/magasin-repo";

type Ligne = { articleId: string; qty: number };

function lire(list: Ligne[] | undefined, articleId: string): number {
  return list?.find((x) => x.articleId === articleId)?.qty ?? 0;
}

function ecrire(list: Ligne[] | undefined, articleId: string, qty: number): Ligne[] {
  const reste = (list ?? []).filter((x) => x.articleId !== articleId);
  return qty > 0 ? [...reste, { articleId, qty }] : reste;
}

function nettoyer(value: VenteAjustements): VenteAjustements | undefined {
  const out: VenteAjustements = {};
  if (value.manquants?.length) out.manquants = value.manquants;
  if (value.supplements?.length) out.supplements = value.supplements;
  if (value.portionsManquantes) out.portionsManquantes = value.portionsManquantes;
  return Object.keys(out).length ? out : undefined;
}

function Nombre({
  max,
  value,
  label,
  onChange,
}: {
  max: number;
  value: number;
  label: string;
  onChange: (n: number) => void;
}) {
  if (max <= 1) return null;
  return (
    <label className="vente-ajust-nb">
      sur
      <input
        type="number"
        min={1}
        max={max}
        aria-label={label}
        value={Math.min(value, max)}
        onChange={(e) =>
          onChange(Math.min(max, Math.max(1, Math.round(Number(e.target.value) || 1))))
        }
      />
    </label>
  );
}

/** Exceptions d'une ligne de panier : rien à faire si tout est normal. */
export function VenteAjustementsPanel({
  fiche,
  qty,
  value,
  onChange,
}: {
  fiche: FicheCaisse;
  qty: number;
  value?: VenteAjustements;
  onChange: (next: VenteAjustements | undefined) => void;
}) {
  const [ouvert, setOuvert] = useState(false);
  const courant = value ?? {};
  const maj = (patch: Partial<VenteAjustements>) =>
    onChange(nettoyer({ ...courant, ...patch }));
  const actif = Boolean(value);

  return (
    <div className="vente-ajust">
      <button
        type="button"
        className={`vente-ajust-toggle${actif ? " is-set" : ""}`}
        aria-expanded={ouvert}
        onClick={() => setOuvert((o) => !o)}
      >
        {actif ? "Manque ou supplément indiqué" : "Ingrédient manquant ou supplément"}
      </button>
      {ouvert ? (
        <div className="vente-ajust-body">
          {fiche.mode === "lot" ? (
            <div className="vente-ajust-row">
              <label>
                <input
                  type="checkbox"
                  checked={!courant.portionsManquantes}
                  onChange={(e) =>
                    maj({ portionsManquantes: e.target.checked ? 0 : qty })
                  }
                />
                Portion servie
              </label>
              {courant.portionsManquantes ? (
                <Nombre
                  max={qty}
                  label="Portions manquantes"
                  value={courant.portionsManquantes}
                  onChange={(n) => maj({ portionsManquantes: n })}
                />
              ) : null}
            </div>
          ) : null}

          {fiche.ingredients.map((i) => {
            const absent = lire(courant.manquants, i.articleId);
            return (
              <div className="vente-ajust-row" key={i.articleId}>
                <label>
                  <input
                    type="checkbox"
                    checked={absent === 0}
                    onChange={(e) =>
                      maj({
                        manquants: ecrire(
                          courant.manquants,
                          i.articleId,
                          e.target.checked ? 0 : qty,
                        ),
                      })
                    }
                  />
                  {i.name}
                </label>
                {absent ? (
                  <Nombre
                    max={qty}
                    label={`${i.name} manquant`}
                    value={absent}
                    onChange={(n) =>
                      maj({ manquants: ecrire(courant.manquants, i.articleId, n) })
                    }
                  />
                ) : null}
              </div>
            );
          })}

          {fiche.supplements.length ? (
            <p className="vente-ajust-title">Suppléments</p>
          ) : null}
          {fiche.supplements.map((s) => {
            const choisi = lire(courant.supplements, s.articleId);
            return (
              <div className="vente-ajust-row" key={s.articleId}>
                <label>
                  <input
                    type="checkbox"
                    checked={choisi > 0}
                    onChange={(e) =>
                      maj({
                        supplements: ecrire(
                          courant.supplements,
                          s.articleId,
                          e.target.checked ? qty : 0,
                        ),
                      })
                    }
                  />
                  {s.name}
                </label>
                {choisi ? (
                  <Nombre
                    max={qty}
                    label={`${s.name} en supplément`}
                    value={choisi}
                    onChange={(n) =>
                      maj({ supplements: ecrire(courant.supplements, s.articleId, n) })
                    }
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
