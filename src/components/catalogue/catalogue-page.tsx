"use client";

import { AppShell } from "@/components/app-shell";
import { ParametresEditor } from "@/components/parametres/parametres-editor";
import type { VenteSite } from "@/lib/types";
import "@/components/parametres/parametres-catalogue.css";

const TITRES: Record<VenteSite, string> = {
  zogbo: "Catalogue Zogbo",
  gbegamey: "Catalogue Gbégamey",
};

/**
 * Sans `site` : page historique, avec choix du site (ou site du gérant).
 * Avec `site` : catalogue dédié à un site, sans bascule possible.
 */
export function CataloguePage({ site }: { site?: VenteSite } = {}) {
  return (
    <AppShell
      title={site ? TITRES[site] : "Catalogue & paramètres"}
      subtitle={
        site
          ? "Produits, prix et ordre de vente propres à ce site."
          : "Gérez vos produits, matières et recettes."
      }
      mainClassName="main-catalogue"
    >
      <div className="catalogue-view">
        <ParametresEditor mode="catalogue" site={site} />
      </div>
    </AppShell>
  );
}
