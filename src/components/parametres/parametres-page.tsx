"use client";

import { AppShell } from "@/components/app-shell";
import { ParametresEditor } from "@/components/parametres/parametres-editor";

export function ParametresPage() {
  return (
    <AppShell
      title="Paramètres"
      subtitle="Chaque point — Zogbo et Gbégamey — a son propre catalogue, ses matières et ses recettes."
    >
      <ParametresEditor />
    </AppShell>
  );
}
