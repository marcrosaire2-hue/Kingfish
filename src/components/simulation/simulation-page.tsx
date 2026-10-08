"use client";

import { useCallback, useEffect, useState } from "react";
import { AchatsPage } from "@/components/achats/achats-page";
import { BrandLoader } from "@/components/brand-loader";
import { CompteurPage } from "@/components/compteur/compteur-page";
import { DepensesPage } from "@/components/depenses/depenses-page";
import { FondsCaissePage } from "@/components/fonds-caisse/fonds-caisse-page";
import { PertesPage } from "@/components/pertes/pertes-page";
import { RattrapageVentesPage } from "@/components/rattrapage-ventes/rattrapage-ventes-page";
import { TestsPlatsPage } from "@/components/tests-plats/tests-plats-page";
import { VentePage } from "@/components/vente/vente-page";
import { setOfflineQueueSimulation } from "@/lib/offline-queue";
import { SIM_REQUEST_HEADER } from "@/lib/simulation-shared";
import type { VenteSite } from "@/lib/types";
import "./simulation-page.css";

type OngletId =
  | "vente"
  | "rattrapage"
  | "achats"
  | "depenses"
  | "pertes"
  | "compteur"
  | "fonds"
  | "tests";

const ONGLETS: { id: OngletId; label: string; adminSeul?: boolean }[] = [
  { id: "vente", label: "Vente" },
  { id: "rattrapage", label: "Ventes passées", adminSeul: true },
  { id: "achats", label: "Achats" },
  { id: "depenses", label: "Dépenses" },
  { id: "pertes", label: "Pertes" },
  { id: "compteur", label: "Compteur" },
  { id: "fonds", label: "Fonds de caisse" },
  { id: "tests", label: "Tests de plats" },
];

/** Routes d'API qui ne passent jamais par le bac à sable. */
function estExclue(url: string): boolean {
  return url.startsWith("/api/auth/") || url.startsWith("/api/simulation");
}

/**
 * Tant que la page est ouverte, tout appel `fetch` vers l'API des écrans
 * simulés porte l'en-tête de simulation : le serveur l'exécute sur une base
 * jetable, jamais sur la vraie. Le patch est retiré en quittant la page.
 */
function installerFetchSimulation(): () => void {
  const original = window.fetch;
  window.fetch = (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.pathname + input.search
          : input.url;
    const relative = url.startsWith(window.location.origin)
      ? url.slice(window.location.origin.length)
      : url;
    if (relative.startsWith("/api/") && !estExclue(relative)) {
      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined),
      );
      headers.set(SIM_REQUEST_HEADER, "1");
      return original(input, { ...init, headers });
    }
    return original(input, init);
  };
  return () => {
    window.fetch = original;
  };
}

/** Les appels reset/drop sont rejoués dans l'ordre : un « drop » tardif ne doit jamais couper un « reset ». */
let fileSimulation: Promise<unknown> = Promise.resolve();

function appelBacASable(action: "reset" | "drop"): Promise<Response> {
  const appel = fileSimulation.then(() =>
    fetch("/api/simulation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
      keepalive: action === "drop",
    }),
  );
  fileSimulation = appel.catch(() => {});
  return appel;
}

export function SimulationPage({
  initialSite,
  peutRattraper,
}: {
  initialSite: VenteSite;
  peutRattraper: boolean;
}) {
  const [onglet, setOnglet] = useState<OngletId>("vente");
  const [etat, setEtat] = useState<"prepare" | "pret" | "erreur">("prepare");
  const [erreur, setErreur] = useState<string | null>(null);
  /** Change à chaque remise à zéro : remonte l'écran affiché. */
  const [generation, setGeneration] = useState(0);

  const charger = useCallback(async () => {
    try {
      const res = await appelBacASable("reset");
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error || "Préparation impossible.");
      setGeneration((g) => g + 1);
      setEtat("pret");
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Préparation impossible.");
      setEtat("erreur");
    }
  }, []);

  /** Relance à la demande (bouton) : repasse d'abord en « préparation ». */
  const preparer = useCallback(() => {
    setEtat("prepare");
    setErreur(null);
    void charger();
  }, [charger]);

  useEffect(() => {
    // Le patch est posé avant que le moindre écran simulé ne soit monté.
    setOfflineQueueSimulation(true);
    const retirer = installerFetchSimulation();
    // État mis à jour seulement après la réponse du serveur.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void charger();
    return () => {
      retirer();
      setOfflineQueueSimulation(false);
      // Meilleur effort : on jette le bac à sable en quittant la page.
      void appelBacASable("drop").catch(() => {});
    };
  }, [charger]);

  const onglets = ONGLETS.filter((o) => !o.adminSeul || peutRattraper);

  return (
    <div className="sim-page">
      <div className="sim-banner" role="status">
        <div>
          <strong>Mode simulation — formation</strong>
          <span>
            Tout ce que vous saisissez ici est fictif : rien n&apos;est
            enregistré dans les vraies données et tout disparaît quand vous
            quittez ou rechargez la page.
          </span>
        </div>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={etat === "prepare"}
          onClick={preparer}
        >
          Tout remettre à zéro
        </button>
      </div>

      <div className="sim-tabs" role="tablist" aria-label="Écrans de simulation">
        {onglets.map((o) => (
          <button
            key={o.id}
            type="button"
            role="tab"
            aria-selected={onglet === o.id}
            className={`sim-tab${onglet === o.id ? " is-active" : ""}`}
            onClick={() => setOnglet(o.id)}
          >
            {o.label}
          </button>
        ))}
      </div>

      {etat === "prepare" ? (
        <div className="sim-state">
          <BrandLoader />
          <p>Préparation du bac à sable…</p>
        </div>
      ) : null}
      {etat === "erreur" ? (
        <div className="error-banner" role="alert">
          {erreur}{" "}
          <button type="button" className="btn btn-ghost" onClick={preparer}>
            Réessayer
          </button>
        </div>
      ) : null}
      {etat === "pret" ? (
        <div className="sim-body" key={`${onglet}-${generation}`}>
          {onglet === "vente" ? (
            <VentePage canViewHistory={false} initialSite={initialSite} />
          ) : null}
          {onglet === "rattrapage" ? <RattrapageVentesPage /> : null}
          {onglet === "achats" ? <AchatsPage /> : null}
          {onglet === "depenses" ? <DepensesPage /> : null}
          {onglet === "pertes" ? <PertesPage /> : null}
          {onglet === "compteur" ? <CompteurPage /> : null}
          {onglet === "fonds" ? <FondsCaissePage /> : null}
          {onglet === "tests" ? <TestsPlatsPage /> : null}
        </div>
      ) : null}
    </div>
  );
}
