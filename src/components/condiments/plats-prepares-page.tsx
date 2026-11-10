"use client";

import { AppShell } from "@/components/app-shell";
import { BrandLoader } from "@/components/brand-loader";
import { useSession } from "@/components/session-provider";
import { canWriteStock } from "@/lib/auth-types";
import { useMagasin, VueProduction } from "./condiments-panel";

export function PlatsPreparesPage() {
  const { user } = useSession();
  const readOnly = Boolean(user && !canWriteStock(user.role));
  const { etat, busy, error, action } = useMagasin();

  return (
    <AppShell
      title="Plats préparés"
      subtitle="Le nombre de plats préparés à Gbégamey."
    >
      <div className="mag-page">
        {error ? (
          <p className="error-banner" role="alert">
            {error}
          </p>
        ) : null}
        {!etat && !error ? <BrandLoader label="Chargement des plats…" /> : null}
        {etat ? (
          <VueProduction etat={etat} readOnly={readOnly} busy={busy} onAction={action} />
        ) : null}
      </div>
    </AppShell>
  );
}
