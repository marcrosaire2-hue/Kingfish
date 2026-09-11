"use client";

import { AppShell } from "@/components/app-shell";
import { ParametresEditor } from "@/components/parametres/parametres-editor";

export function ParametresPage() {
  return (
    <AppShell
      title="Paramètres"
      subtitle="Catalogues classés par point — Zogbo et Gbégamey. Les boissons sont partagées ; les ventes restent séparées."
    >
      <ParametresEditor />
    </AppShell>
  );
}
