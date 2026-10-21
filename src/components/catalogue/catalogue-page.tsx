"use client";

import { AppShell } from "@/components/app-shell";
import { ParametresEditor } from "@/components/parametres/parametres-editor";
import "@/components/parametres/parametres-catalogue.css";

export function CataloguePage() {
  return (
    <AppShell
      title="Catalogue & paramètres"
      subtitle="Gérez vos produits, matières et recettes."
      mainClassName="main-catalogue"
    >
      <div className="catalogue-view">
        <ParametresEditor mode="catalogue" />
      </div>
    </AppShell>
  );
}
